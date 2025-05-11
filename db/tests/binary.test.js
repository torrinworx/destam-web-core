import database from '../index.js';
import dummy from '../driver/dummy.js';

import OObject from 'destam/Object.js';
import OArray from 'destam/Array.js';
import UUID from 'destam/UUID.js';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from '../driver/fs.js';
import memory from '../driver/memory.js';
import mongodb from '../driver/mongodb.js';
import indexeddb from '../driver/indexeddb.js';
import nodefs from 'node:fs/promises';

import mapTable from '../util/mapTable.js';

import { MongoMemoryServer } from 'mongodb-memory-server';
import 'fake-indexeddb/auto';

const persistentDriver = (name, driver, cleanup) => cb => {
	let counter = 0;

	describe(name, async () => {
		let count = 0;
		let current = 0;

		const ok = () => {
			if (count === ++current) {
				cleanup();
			}
		};

		cb((name, cb) => {
			count++;

			it(name, () => {
				return Promise.resolve(cb()).then(v => (ok(), v)).catch(v => { ok(); throw v });
			});
		}, async () => {
			const count = counter++;
			return mapTable(await driver, table => count + ' ' + table);
		});
	});
};

[
	(cb) => {
		describe('binaryDriver memory', () => {
			cb(it, memory);
		});
	},
	(() => {
		const mongod = MongoMemoryServer.create();
		const driver = mongod.then(mongo => mongodb(mongo.getUri(), "db"));
		return persistentDriver('binaryDriver mongoDB', driver, () => {
			mongod.then(mongo => mongo.stop());
			driver.then(driver => driver.close());
		});
	})(),
	(() => {
		const tmp = nodefs.mkdtemp('/tmp/fstest');
		const driver = tmp.then(loc => fs(loc));

		return persistentDriver('binaryDriver fs', driver, () => {
			tmp.then(tmp => nodefs.rm(tmp, { recursive: true }));
		});
	})(),
	(() => {
		const driver = Promise.resolve(indexeddb('binaryDriverTest', 'db'));
		return persistentDriver('binaryDriver indexedDB', driver, () => {
			driver.then(d => d.close());
		});
	})(),
].forEach(cb => cb((test, driver) => {
	test('retrieve empty', async () => {
		const store = await driver();
		assert.deepStrictEqual(null, await database(store)('table', {}));
	});

	test('retrieve nothing', async () => {
		const store = await driver();

		const result = store('table', {});
		await result.return();
	});

	test('retrieve nothing with non-empty db', async () => {
		const store = await driver();

		const create = async () => {
			const result = store('table');
			await (await result.next()).value.flush();
			await result.return();
		};

		await create();
		await create();
		await create();

		const result = store('table', {});
		await result.return();
	});

	test('retrieve empty query', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');

		await db.flush(thing);
		assert.deepStrictEqual(thing, await database(store)('table', {}));
	});

	test('retrieve from query', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.query = 1;

		await db.flush(thing);
		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
		assert.deepStrictEqual(null, await database(store)('table', { query: 2 }));
	});

	test('retrieve from query with uuid', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.value = 1;

		await db.flush(thing);
		assert.deepStrictEqual(thing, await database(store)('table', { uuid: thing.query.uuid, value: 1 }));
		assert.deepStrictEqual(null, await database(store)('table', { uuid: thing.query.uuid, value: 2 }));
	});

	test('retrieve from query uuid', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');

		await db.flush(thing);
		assert.deepStrictEqual(thing, await database(store)('table', { uuid: thing.query.uuid }));
		assert.deepStrictEqual(null, await database(store)('table', { uuid: "hello world" }));
		assert.deepStrictEqual(null, await database(store)('table', { uuid: UUID().toHex() }));
	});

	test('retrieve from query twice and mess up', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.content = OObject();
		await db.flush(thing);

		const db2 = database(store);
		const one = db2('table', { uuid: thing.query.uuid });
		const two = await db2('table', { uuid: thing.query.uuid });
		two.content = OObject();

		assert.deepStrictEqual((await one).content, two.content);

		await db2.flush(two);
	});

	test('retrieve from query with content', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.query = 1;

		thing.content = 2;

		await db.flush(thing);
		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	test('flush content', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.query = 1;

		thing.content = 2;

		await db.flush(thing);

		thing.content = 3;
		await db.flush(thing);

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	// designed to test building a cache
	test('flush long content', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.query = 1;

		thing.content = 2;

		for (let i = 0; i < 1500; i++) {
			thing.content++;
			await db.flush(thing);
		}

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	test('flush long content 2', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.query = 1;

		thing.content = OArray();

		for (let i = 0; i < 1500; i++) {
			thing.content.push(i);
			await db.flush(thing);
		}

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	test('flush content concurrently', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.query = 1;

		thing.content = 2;

		for (let i = 1; i < 1000; i++) {
			thing.content++;

			if (i % 100 === 0) {
				await db.flush(thing);
			} else {
				db.flush(thing);
			}
		}

		await db.flush(thing);

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	test('flush content concurrently 2', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.query = 1;

		thing.content = OArray();

		for (let i = 1; i < 200; i++) {
			thing.content.push(i);

			if (i % 100 === 0) {
				await db.flush(thing);
			} else {
				db.flush(thing);
			}
		}

		await db.flush(thing);

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	test('preserve duplicate oobjects', async () => {
		const store = await driver();

		const db = database(store);
		const thing = await db('table');
		thing.query.query = 1;
		thing.content = OArray();
		thing.object = OObject();

		for (let i = 0; i < 3; i++) {
			thing.content.push(thing.object);
			await db.flush(thing);
		}

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	test('modify queried', async () => {
		const store = await driver();

		let db = database(store);
		let thing = await db('table');
		thing.query.query = 1;

		await db.flush(thing);

		db = database(store);
		thing = await db('table', { query: 1 });
		thing.val = 1;
		await db.flush(thing);

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	test('modify queried multiple', async () => {
		const store = await driver();

		const db = database(store);
		let thing = await db('table');
		thing.query.query = 1;

		await db.flush(thing);

		for (let i = 0; i < 10; i++) {
			const db = database(store);
			thing = await db('table', { query: 1 });
			thing.val = i;
			await db.flush(thing);
		}

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
	});

	test('dont save special', async () => {
		const store = await driver();

		const db = database(store)
		let thing = await db('table');
		thing.query.query = 1;

		thing._hidden = true;
		thing.$hidden = true;

		await db.flush(thing);

		const rem = Object.fromEntries(Object.entries(thing)
			.filter(([key]) => key[0] !== '_' && key[0] !== '$'));
		assert.deepStrictEqual(rem, { ...await database(store)('table', { query: 1 }) });
	});

	test('multiple tables', async () => {
		const store = await driver();

		const db = database(store);
		let thing = await db('table');
		thing.query.query = 1;

		let thing2 = await db('table2');
		thing2.query.query = 1;


		await db.flush(thing);
		await db.flush(thing2);

		assert.deepStrictEqual(thing, await database(store)('table', { query: 1 }));
		assert.deepStrictEqual(thing2, await database(store)('table2', { query: 1 }));
	});

	test('query single mutate', async () => {
		const store = await driver();
		const db = database(store);

		await db('Table');

		const thing = await db.query('Table', {});
		thing.thing = 1;
		await db.flush(thing);

		assert.deepStrictEqual(await database(store).query('Table', { thing: 1 }), thing);
	});

	test('retrieve multiple', async () => {
		const store = await driver();
		const db = database(store);

		const thing = await db('Table');

		thing.query.thing = [1, 2];
		await db.flush(thing);

		const db2 = database(store);
		assert(await db2('Table', { thing: 1 }) != null);
		assert.equal(await db2('Table', { thing: 1 }), await db2('Table', { thing: 2 }));
	});

	test('retrieve multiple none match', async () => {
		const store = await driver();
		const db = database(store);

		const thing = await db('Table');

		thing.query.thing = [1, 2];
		await db.flush(thing);

		const db2 = database(store);
		assert.equal(await db2('Table', { thing: 3 }), null);
	});

	test('retrieve multiple entries', async () => {
		const store = await driver();
		const db = database(store);

		const flushes = [];

		for (let i = 0; i < 10; i++) {
			const thing = await db('Table');
			thing.query.thing = i;
			flushes.push(db.flush(thing));
		}

		await Promise.all(flushes);

		const readdb = database(store);

		for (let i = 0; i < 10; i++) {
			assert.equal((await readdb('Table', { thing: i })).query.thing, i);
		}
	});

	test('query multiple entries', async () => {
		const store = await driver();
		const db = database(store);

		const flushes = [];

		for (let i = 0; i < 10; i++) {
			const thing = await db('Table');
			thing.query.thing = i;
			thing.query.thing2 = i < 5 ? 1 : 2;
			flushes.push(db.flush(thing));
		}

		await Promise.all(flushes);

		const stuff = await database(store).queryAll('Table', { thing2: 1 });
		assert.equal(stuff.length, 5);
		assert.deepStrictEqual(new Set(stuff.map(e => e.thing)), new Set([0, 1, 2, 3, 4]));
	});

	test('query multiple entries empty query', async () => {
		const store = await driver();
		const db = database(store);

		const flushes = [];

		for (let i = 0; i < 10; i++) {
			const thing = await db('Table');
			thing.query.thing = i;
			flushes.push(db.flush(thing));
		}

		await Promise.all(flushes);

		const stuff = await database(store).queryAll('Table', {});
		assert.equal(stuff.length, 10);
		assert.deepStrictEqual(new Set(stuff.map(e => e.thing)), new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
	});
}));

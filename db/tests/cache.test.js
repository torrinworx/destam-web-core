// test suite that tests basic db features through a in-memory database.
// Mostly for API compliance and sanity testing of the caching.

import database from '../index.js';
import dummy from '../driver/dummy.js';
import memory from '../driver/memory.js';

import {describe, it} from 'node:test';
import assert from 'node:assert';

const assertRecent = (date, spread = 1000) => {
	const current = Date.now();

	assert(current - 1000 < date && date < current + 1000);
};

[
	(cb) => {
		describe('cache dummy', () => {
			cb(it, dummy);
		});
	},
	(cb) => {
		describe('cache memory', () => {
			cb(it, memory);
		});
	}
].forEach(cb => cb((test, driver) => {
	test('retrieve nothing', async () => {
		const db = database(driver());

		const thing = await db('Table', {});
		assert.equal(thing, null);
	});

	test('db close', async () => {
		const db = database(driver());

		await db.close();
	});

	test('create', async () => {
		const db = database(driver());

		const thing = await db('Table');
		await db.flush(thing);
		assert(thing);
	});

	test('createdAt', async () => {
		const db = database(driver());

		const thing = await db('Table');
		await db.flush(thing);

		assertRecent(thing.query.createdAt);
	});

	test('modifiedAt no modify', async () => {
		const db = database(driver());

		const thing = await db('Table');
		await db.flush(thing);

		assert(!thing.query.modifiedAt);
	});

	test('modifiedAt modify only query', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		await db.flush(thing);

		assert(!thing.query.modifiedAt);
	});

	test('modifiedAt', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.modify = 1;
		await db.flush(thing);

		assertRecent(thing.query.modifiedAt);
	});

	test('deletedAt', async () => {
		const db = database(driver());

		const thing = await db('Table');
		await db.delete(thing);

		assertRecent(thing.query.deletedAt);
	});

	test('retrieve', async () => {
		const db = database(driver());

		const thing = await db('Table');

		thing.query.thing = 1;
		await db.flush(thing);

		assert.equal(thing, await db('Table', {thing: 1}));
	});

	test('reuse', async () => {
		const db = database(driver());

		const thing = await db.reuse('Table', {thing: 1});
		await db.flush(thing);

		assert.equal(thing.query.thing, 1);
		assert.equal(thing, await db.reuse('Table', {thing: 1}));
	});

	test('reuse deep object', async () => {
		const db = database(driver());

		const thing = await db.reuse('Table', {'deep.thing': 1});
		await db.flush(thing);

		assert.equal(thing.query.deep.thing, 1);
		assert.equal(thing, await db.reuse('Table', {'deep.thing': 1}));
	});

	test('retrieve 2 tables', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		await db.flush(thing);

		const thing2 = await db('Table2');
		thing2.query.thing = 1;
		await db.flush(thing2);

		assert.equal(thing, await db('Table', {thing: 1}));
		assert.equal(thing2, await db('Table2', {thing: 1}));
	});

	test('retrieve twice', async () => {
		const db = database(driver());

		const thing = await db('Table');

		thing.query.thing = 1;
		await db.flush(thing);

		const one = db('Table', {thing: 1});
		const two = db('Table', {thing: 1});

		assert.equal(thing, await one);
		assert.equal(thing, await two);
	});

	test('retrieve after mumate', async () => {
		const db = database(driver());

		const thing = await db('Table');

		thing.query.thing = 1;
		thing.query.thing = 2;
		await db.flush(thing);

		assert.equal(null, await db('Table', {thing: 1}));
		assert.equal(thing, await db('Table', {thing: 2}));
	});

	test('retrieve array', async () => {
		const db = database(driver());

		const thing = await db('Table');

		thing.query.thing = [1];
		await db.flush(thing);

		assert.equal(thing, await db('Table', {thing: 1}));
	});

	test('retrieve multiple', async () => {
		const db = database(driver());

		const thing = await db('Table');

		thing.query.thing = [1, 2];
		await db.flush(thing);

		assert.equal(thing, await db('Table', {thing: 1}));
		assert.equal(thing, await db('Table', {thing: 2}));
	});

	test('retrieve multiple none match', async () => {
		const db = database(driver());

		const thing = await db('Table');

		thing.query.thing = [1, 2];
		await db.flush(thing);

		assert.equal(await db('Table', {thing: 3}), null);
	});

	test('retrieve everything', async () => {
		const db = database(driver());

		const thing = await db('Table');
		await db.flush(thing);

		assert.equal(thing, await db('Table', {}));
	});

	test('retrieve everything with multiple queries', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		thing.query.thing2 = 2;
		await db.flush(thing);

		assert.equal(thing, await db('Table', {}));
	});

	test('query single none', async () => {
		const db = database(driver());

		assert(!(await db.query('Table', {thing: 1})));
	});

	test('query single', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		await db.flush(thing);

		assert.equal(await db.query('Table', {thing: 1}), thing.query);
	});

	test('query single get instance', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		thing.content = 'hello';
		await db.flush(thing);

		assert.equal(await db.instance(await db.query('Table', {thing: 1})), thing);
	});

	test('query single mutate', async () => {
		const db = database(driver());

		await db('Table');

		const thing = await db.query('Table', {});
		thing.thing = 1;
		await db.flush(thing);

		assert.equal(await db.query('Table', {thing: 1}), thing);
	});

	test('query two constraints', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		thing.query.thing2 = 1;
		await db.flush(thing);

		assert.equal(await db('Table', {thing: 1}), thing);
		assert.equal(await db('Table', {thing2: 1}), thing);
		assert.equal(await db('Table', {thing: 1, thing2: 1}), thing);
	});

	test('query multiple', async () => {
		const db = database(driver());

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			await db.flush(thing);

			stuff.add(thing.query);
		}

		const array = await db.queryAll('Table', {thing: 1});
		assert.deepEqual(stuff, new Set(array));
	});

	test('queryAll nothing', async () => {
		let thrown = false;
		try {
			const db = database(driver());

			const array = await db.queryAll('Table');
		} catch (e) {
			thrown = true;
		}

		assert(thrown);
	});

	test('query nothing', async () => {
		let thrown = false;
		try {
			const db = database(driver());

			const array = await db.query('Table');
		} catch (e) {
			thrown = true;
		}

		assert(thrown);
	});

	test('invalid table', async () => {
		let thrown = false;
		try {
			const db = database(driver());

			const array = await db({}, {});
		} catch (e) {
			thrown = true;
		}

		assert(thrown);
	});

	test('invalid table query', async () => {
		let thrown = false;
		try {
			const db = database(driver());

			const array = await db.query({}, {});
		} catch (e) {
			thrown = true;
		}

		assert(thrown);
	});

	test('invalid table query', async () => {
		let thrown = false;
		try {
			const db = database(driver());

			const array = await db.queryAll({}, {});
		} catch (e) {
			thrown = true;
		}

		assert(thrown);
	});

	test('query multiple reactive', async () => {
		const db = database(driver());

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			await db.flush(thing);

			stuff.add(thing.query);
		}

		const array = db.queryAll('Table', {thing: 1}, true);

		await array;

		const thing = await db('Table');
		thing.query.thing = 1;
		await db.flush(thing);

		stuff.add(thing.query);

		assert.deepEqual(stuff, new Set(await array));
		array.remove();
	});

	test('query multiple reactive 2', async () => {
		const db = database(driver());

		const array = db.queryAll('Table', {thing: 1}, true);

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			await db.flush(thing);

			stuff.add(thing.query);
		}

		await array;

		assert.deepEqual(stuff, new Set(await array));
		array.remove();
	});

	test('query multiple reactive delete', async () => {
		const db = database(driver());

		const stuff = [];
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			await db.flush(thing);

			stuff.push(thing);
		}

		const array = db.queryAll('Table', {thing: 1}, true);

		await array;
		const last = stuff.pop();
		await db.delete(last);

		assert.deepEqual(new Set(stuff.map(db => db.query)), new Set(await array));
		array.remove();
	});

	test('query multiple reactive delete new item', async () => {
		const db = database(driver());

		const stuff = [];
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			await db.flush(thing);

			stuff.push(thing);
		}

		const array = db.queryAll('Table', {thing: 1}, true);

		await array;

		const thing = await db('Table');
		thing.query.thing = 1;
		await db.delete(thing);

		assert.deepEqual(new Set(stuff.map(db => db.query)), new Set(await array));
		array.remove();
	});

	test('retrieve everything with multiple queries', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		thing.query.thing2 = 2;

		await db.flush(thing);

		const array = await db.queryAll('Table', {});

		assert.deepEqual(new Set([thing.query]), new Set(array));
	});

	test('retrieve everything with multiple queries 2', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		thing.query.thing2 = 2;

		const thing2 = await db('Table');
		thing2.query.thing = 1;
		thing2.query.thing2 = 2;

		await db.flush(thing);
		await db.flush(thing2);

		const array = await db.queryAll('Table', {});

		assert.deepEqual(new Set([thing.query, thing2.query]), new Set(array));
	});

	test('retrieve everything with multiple queries reactive', async () => {
		const db = database(driver());

		const thing = await db('Table');
		thing.query.thing = 1;
		thing.query.thing2 = 2;
		await db.flush(thing);

		const array = db.queryAll('Table', {}, true);
		await array;

		const thing2 = await db('Table');
		thing2.query.thing = 1;
		thing2.query.thing2 = 2;

		await db.flush(thing2);

		array.remove();

		assert.deepEqual(new Set([thing.query, thing2.query]), new Set(array.array));
	});

	test('query multiple reactive two queries', async () => {
		const db = database(driver());

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			thing.query.thing2 = 1;
			await db.flush(thing);

			stuff.add(thing.query);
		}

		const array = db.queryAll('Table', {thing: 1, thing2: 1}, true);

		const thing = await db('Table');
		thing.query.thing = 1;
		await db.flush(thing);

		assert.deepEqual(stuff, new Set(await array));
		array.remove();
	});

	test('query multiple reactive two queries 2', async () => {
		const db = database(driver());

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			thing.query.thing2 = 1;
			await db.flush(thing);

			stuff.add(thing.query);
		}

		const array = db.queryAll('Table', {thing: 1, thing2: 1}, true);

		const thing = await db('Table');
		thing.query.thing2 = 1;
		await db.flush(thing);

		assert.deepEqual(stuff, new Set(await array));
		array.remove();
	});

	test('query multiple reactive two queries 3', async () => {
		const db = database(driver());

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			thing.query.thing2 = 1;
			await db.flush(thing);

			stuff.add(thing.query);
		}

		const array = db.queryAll('Table', {thing: 1, thing2: 1}, true);

		const thing = await db('Table');
		thing.query.thing = 1;
		thing.query.thing2 = 1;
		stuff.add(thing.query);

		assert.deepEqual(stuff, new Set(await array));
		array.remove();

		await db.flush();
	});

	test('query multiple reactive remove before', async () => {
		const db = database(driver());

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			await db.flush(thing);

			stuff.add(thing.query);
		}

		const array = db.queryAll('Table', {thing: 1}, true);
		array.remove();

		await array;

		const thing = await db('Table');
		thing.query.thing = 1;
		await db.flush(thing);

		assert.deepEqual(stuff, new Set(await array));
	});

	test('delete', async () => {
		const db = database(driver());

		const stuff = await db('Table');

		stuff.query.thing = 1;
		db.delete(stuff);

		assertRecent(stuff.query.deletedAt);
		assert(!(await db('Table', {thing: 1})));

		await db.flush();
	});

	test('delete with await', async () => {
		const db = database(driver());

		const stuff = await db('Table');

		stuff.query.thing = 1;
		await db.delete(stuff);

		assertRecent(stuff.query.deletedAt);
		assert(!(await db('Table', {thing: 1})));
	});

	test('delete query', async () => {
		const db = database(driver());

		const stuff = await db('Table');
		stuff.query.thing = 1;

		db.delete(await db.query('Table', {thing: 1}));

		assert(!(await db('Table', {thing: 1})));

		await db.flush();
	});

	test('delete queryAll', async () => {
		const db = database(driver());

		const stuff = await db('Table');
		stuff.query.thing = 1;

		db.delete((await db.queryAll('Table', {thing: 1}))[0]);

		assert(!(await db('Table', {thing: 1})));

		await db.flush();
	});

	test('gather stats', async () => {
		const db = database(driver());

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
			await db.flush(thing);
		}

		assert.deepStrictEqual(db.stats().namespaces, [{
			name: 'Table',
			// 9 because each entry is stored 3 times:
			// once for the global map,
			// another for the uuid
			// and last for the user defined 'thing' query
			entries: 9,
			unique: 3,
			active: 3,
		}]);
	});

	test('full flush', async () => {
		const db = database(driver());

		const stuff = new Set();
		for (let i = 0; i < 3; i++) {
			const thing = await db('Table');
			thing.query.thing = 1;
		}

		await db.flush();
	});
}));

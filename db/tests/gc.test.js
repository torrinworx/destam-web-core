import { setFlagsFromString } from 'v8';
import { runInNewContext } from 'vm';

import database from '../index.js';
import dummy from '../driver/dummy.js';
import memory from '../driver/memory.js';

import {describe, it} from 'node:test';
import assert from 'node:assert';

setFlagsFromString('--expose_gc');
const gc = runInNewContext('gc');

const testGC = (impl, name, cb) => {
	describe(name, () => {
		cb((name, cb) => it(name, async () => {
			const store = impl();
			const db = database(store);

			let collected = false;
			const registry = new FinalizationRegistry(() => {
				collected = true;
			});

			registry.register(await cb(db));
			await db.flush();

			if (store.memory) store.memory.splice(0, store.memory.length);

			for (let i = 0; i < 100 && !collected; i++) {
				gc();
				await new Promise(ok => setTimeout(ok, 0));
			}

			assert(collected);
		}));
	});
};

[
	testGC.bind(null, dummy, "gc dummy"),
	testGC.bind(null, memory, "gc memory"),
].forEach(cb => cb(test => {
	test('basic gc', async (db) => {
		let thing = await db('Table');
		return thing;
	});

	test('gc after query register', async (db) => {
		let thing = await db('Table');
		thing.query.thing = 1;
		return thing;
	});

	test('gc after retrieve', async (db) => {
		let thing = await db('Table');
		thing.query.thing = 1;

		thing = await db('Table', {thing: 1});
		return thing;
	});

	test('gc retrieve query', async (db) => {
		await db('Table');

		let thing = await db.query('Table', {});
		thing.thing = 1;
		return thing;
	});

	test('gc retrieve queryAll', async (db) => {
		await db('Table');

		let thing = await db.queryAll('Table', {});
		thing[0].thing = 1;
		return thing[0];
	});
}));

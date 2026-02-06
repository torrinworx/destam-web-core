import test from 'node:test';
import { expect } from 'chai';
import createODB from '../index.js';
import { OObject, OArray } from 'destam';

const waitUntil = async (fn, { timeoutMs = 1500, stepMs = 10, label = 'condition' } = {}) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const ok = await fn();
		if (ok) return true;
		await new Promise(r => setTimeout(r, stepMs));
	}
	throw new Error(`Timed out waiting for: ${label}`);
};

export const runODBDriverTests = ({
	name,
	driver, // raw import (factory or instance)
	driverProps = {},
	throttleMs = 10,
	crossInstanceLive = true,
} = {}) => {
	if (!name) throw new Error('runODBDriverTests: missing name');
	if (!driver) throw new Error('runODBDriverTests: missing driver');

	const collection = `odb_test_${name}`;

	test(`[${name}] open() creates doc (default empty OObject)`, async () => {
		const db = await createODB({ driver, throttleMs, driverProps });
		try {
			const doc = await db.open({
				collection,
				query: { type: 'empty-default', v: 1 },
				// no value => should create OObject({}) and force query keys into it
			});

			expect(doc).to.be.instanceOf(OObject);
			expect(doc.type).to.equal('empty-default');
			expect(doc.v).to.equal(1);
		} finally {
			await db.close();
		}
	});

	test(`[${name}] open() reuses existing doc (query + cache)`, async () => {
		const db = await createODB({ driver, throttleMs, driverProps });
		try {
			const initial = OObject({ kind: 'reuse', count: 0, items: OArray([]) });

			const a = await db.open({
				collection,
				query: { kind: 'reuse' },
				value: initial,
			});

			const b = await db.open({
				collection,
				query: { kind: 'reuse' },
			});

			// same in-memory object (cache)
			expect(a).to.equal(b);
		} finally {
			await db.close();
		}
	});

	test(`[${name}] local mutation persists (findOne sees it)`, async () => {
		const db = await createODB({ driver, throttleMs, driverProps });
		try {
			const doc = await db.open({
				collection,
				query: { kind: 'persist' },
				value: OObject({ kind: 'persist', count: 0 }),
			});

			doc.count = 123;
			await doc.$odb.flush();

			const loaded = await db.findOne({ collection, query: { kind: 'persist' } });
			expect(loaded).to.be.instanceOf(OObject);
			expect(loaded.count).to.equal(123);
		} finally {
			await db.close();
		}
	});

	test(`[${name}] findMany returns multiple docs`, async () => {
		const db = await createODB({ driver, throttleMs, driverProps });
		try {
			for (let i = 0; i < 3; i++) {
				const doc = await db.open({
					collection,
					query: { kind: 'many', n: i },
					value: OObject({ kind: 'many', n: i, val: i * 10 }),
				});
				doc.val = i * 100;
				await doc.$odb.flush();
			}

			const found = await db.findMany({ collection, query: { kind: 'many' } });
			expect(found).to.be.an('array');
			expect(found.length).to.be.at.least(3);

			const ns = found.map(d => d.n).sort((a, b) => a - b);
			expect(ns[0]).to.equal(0);
		} finally {
			await db.close();
		}
	});

	test(`[${name}] remove() deletes doc and throws if not found`, async () => {
		const db = await createODB({ driver, throttleMs, driverProps });
		try {
			await db.open({
				collection,
				query: { kind: 'remove-me' },
				value: OObject({ kind: 'remove-me', ok: true }),
			});

			const removed = await db.remove({ collection, query: { kind: 'remove-me' } });
			expect(removed).to.equal(true);

			let threw = false;
			try {
				await db.remove({ collection, query: { kind: 'remove-me' } });
			} catch (e) {
				threw = true;
				expect(e.message.toLowerCase()).to.include('not found');
			}
			expect(threw).to.equal(true);
		} finally {
			await db.close();
		}
	});

	test(`[${name}] live propagation across two ODB instances`, async () => {
		if (!crossInstanceLive) return;

		let db1;
		let db2;

		// IMPORTANT:
		// - For real DB drivers (mongo), driver factory can be called twice and still observe same DB.
		// - For memory drivers, calling factory twice gives two isolated stores.
		// So here we intentionally share ONE driver instance across both ODBs.
		const sharedDriver =
			typeof driver === 'function'
				? await driver(driverProps) // share one instance
				: driver;

		try {
			db1 = await createODB({ driver: sharedDriver, throttleMs });
			db2 = await createODB({ driver: sharedDriver, throttleMs });

			const doc1 = await db1.open({
				collection,
				query: { kind: 'live' },
				value: OObject({ kind: 'live', text: 'a', messages: OArray([]) }),
			});

			const doc2 = await db2.open({
				collection,
				query: { kind: 'live' },
			});

			doc1.text = 'hello';
			doc1.messages.push(OObject({ id: 'm1', t: 'yo' }));
			await doc1.$odb.flush();

			await waitUntil(
				() =>
					doc2.text === 'hello' &&
					doc2.messages?.length === 1 &&
					doc2.messages[0].id === 'm1',
				{ label: 'db2 receives remote update' }
			);
		} finally {
			await Promise.allSettled([db1?.close?.(), db2?.close?.()]);
		}
	});
};

import test from 'node:test';
import assert from 'node:assert/strict';

import { OObject, OArray, Modify, Delete } from 'destam';
import Obridge from '../common/Obridge.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const wait = ms => new Promise(r => setTimeout(r, ms));

test('Obridge: A -> B mirrors basic OObject changes (insert/modify/delete)', async () => {
	const a = OObject({ user: OObject({ name: 'Alice' }) });
	const b = OObject({ user: OObject({ name: 'Alice' }) });

	const stop = Obridge({ a: a.observer, b: b.observer, aToB: true, bToA: false });

	a.user.age = 30;        // insert
	a.user.name = 'Alicia'; // modify
	delete a.user.age;      // delete

	await tick();

	assert.equal(b.user.name, 'Alicia');
	assert.equal('age' in b.user, false);

	stop();
});

test('Obridge: one-way means B changes do not affect A', async () => {
	const a = OObject({ n: 1 });
	const b = OObject({ n: 1 });

	const stop = Obridge({ a: a.observer, b: b.observer, aToB: true, bToA: false });

	b.n = 999;
	await tick();

	assert.equal(a.n, 1);

	stop();
});

test('Obridge: two-way sync does not loop infinitely', async () => {
	const a = OObject({ n: 1 });
	const b = OObject({ n: 1 });

	const stop = Obridge({ a: a.observer, b: b.observer, aToB: true, bToA: true });

	a.n = 2;
	await tick();
	assert.equal(b.n, 2);

	b.n = 3;
	await tick();
	assert.equal(a.n, 3);

	stop();
});

test('Obridge: allowAtoB path prefix filter', async () => {
	const a = OObject({
		user: OObject({ name: 'Alice', role: 'admin' }),
		settings: OObject({ dark: false }),
	});

	const b = OObject({
		user: OObject({ name: 'Alice', role: 'admin' }),
		settings: OObject({ dark: false }),
	});

	const stop = Obridge({
		a: a.observer,
		b: b.observer,
		aToB: true,
		bToA: false,
		allowAtoB: [
			['settings'], // only forward settings subtree
		],
	});

	a.user.name = 'Alicia';
	a.settings.dark = true;

	await tick();

	// should NOT have forwarded user change
	assert.equal(b.user.name, 'Alice');

	// should have forwarded settings change
	assert.equal(b.settings.dark, true);

	stop();
});

test('Obridge: transform can drop a specific path', async () => {
	const a = OObject({ user: OObject({ name: 'Alice', role: 'admin' }) });
	const b = OObject({ user: OObject({ name: 'Alice', role: 'admin' }) });

	const stop = Obridge({
		a: a.observer,
		b: b.observer,
		aToB: true,
		transform(delta) {
			if (delta?.path?.join('.') === 'user.role') return null; // block role changes
			return delta;
		},
	});

	a.user.role = 'user';
	a.user.name = 'Alicia';

	await tick();

	assert.equal(b.user.role, 'admin'); // unchanged
	assert.equal(b.user.name, 'Alicia'); // changed

	stop();
});

test('Obridge: throttle fires first update immediately, then coalesces to last', async () => {
	const a = OObject({ n: 0 });
	const b = OObject({ n: 0 });

	const stop = Obridge({
		a: a.observer,
		b: b.observer,
		aToB: true,
		throttle: 20,
	});

	// burst updates
	for (let i = 1; i <= 5; i++) a.n = i;

	// throttle sends the first event immediately
	await tick();
	assert.equal(b.n, 1);

	// then it should eventually deliver the latest pending value
	await wait(30);
	assert.equal(b.n, 5);

	stop();
});

test('Obridge: OArray basic element modify (same stable refs)', async () => {
	// NOTE: This only reliably works if both arrays were created with same shape
	// and you don't do reorders that change internal refs.
	const a = OObject({ list: OArray([OObject({ v: 1 }), OObject({ v: 2 })]) });
	const b = OObject({ list: OArray([OObject({ v: 1 }), OObject({ v: 2 })]) });

	const stop = Obridge({ a: a.observer, b: b.observer, aToB: true });

	a.list[0].v = 10;
	await tick();

	assert.equal(b.list[0].v, 10);

	stop();
});

test('Obridge: OArray insert/delete preserves element refs', async () => {
	const a = OObject({ list: OArray(['a', 'b']) });
	const b = OObject({ list: OArray(['a', 'b']) });

	const stop = Obridge({ a: a.observer, b: b.observer, aToB: true });

	a.list.push('c');
	await tick();
	assert.equal(b.list.length, 3);
	assert.equal(b.list[2], 'c');

	a.list.splice(1, 1);
	await tick();
	assert.equal(b.list.length, 2);
	assert.equal(b.list[1], 'c');

	stop();
});

test('Obridge: emits real deltas (guard test for applyDeltaByPath assumptions)', async () => {
	const a = OObject({ x: 1 });
	const seen = [];

	const rm = a.observer.watch((d) => seen.push(d.constructor));

	a.x = 2;
	delete a.x;

	rm();

	assert.ok(seen.includes(Modify));
	assert.ok(seen.includes(Delete));
});

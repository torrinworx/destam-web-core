import {test} from 'node:test';
import assert from 'node:assert';
import {insert, has, remove, insertItem, split, iterate, compare} from '../util/btree.js';
import UUID from 'destam/UUID.js';

const name = (func, name) => {
	Object.defineProperty(func, 'toString', {
		value: () => name,
	});
	return func;
};

for (let [name, num] of [
	[3, 128],
	[4, 256],
	[5, 512],
	[6, 1024],
	[7, 2048],
	[8, 4096],
	[9, 8192],
	['mixed', 4096],
]) {
	num /= 8;

	let createTree;
	let i = name;
	if (typeof i === 'number') {
		createTree = () => [];
	} else {
		i = 10;
		createTree = () => {
			const tree = [];
			tree.blockSize = 3;
			return tree;
		};
	}

	test(`btree fill blockSize ${name}`, async () => {
		const inserting = Array(num).fill(null).map(() => UUID());

		const tree = createTree();
		for (const item of inserting) await insert(tree, i, item);
		for (const item of inserting) assert(await has(tree, item));
	});

	test(`btree iterate blockSize ${name}`, async () => {
		const inserting = Array(num).fill(null).map(() => UUID());

		const tree = createTree();
		for (const item of inserting) await insert(tree, i, item);

		let set = new Set(inserting);
		let prev = 0;
		for await (const id of iterate(tree)) {
			assert(set.has(id));

			assert(!prev || compare(prev, id) < 1);
			prev = id;
		}
	});

	test(`btree fill blockSize ${name} alternating uuid sizes`, async () => {
		const inserting = Array(num).fill(null).map((_, i) => UUID(i & 1 ? 4 : 2));

		const tree = createTree();
		for (const item of inserting) await insert(tree, i, item);
		for (const item of inserting) assert(await has(tree, item));
	});

	test(`btree fill blockSize ${name} sequential`, async () => {
		const inserting = Array(num).fill(null).map((_, i) => UUID(new Uint32Array([i, 0])));

		const tree = createTree();
		for (const item of inserting) await insert(tree, i, item);
		for (const item of inserting) assert(await has(tree, item));
	});

	test(`btree fill blockSize ${name} sequential reversed`, async () => {
		const inserting = Array(num).fill(null).map((_, i) => UUID(new Uint32Array([-i, 0])));

		const tree = createTree();
		for (const item of inserting) await insert(tree, i, item);
		for (const item of inserting) assert(await has(tree, item));
	});

	test(`btree fill blockSize ${name}`, async () => {
		const inserting = Array(num).fill(null).map(() => UUID());

		const tree = createTree();
		for (const item of inserting) await insert(tree, i, item);
		for (const item of inserting) assert(await has(tree, item));
	});

	test(`btree fill blockSize ${name} sequential`, async () => {
		const inserting = Array(num).fill(null).map((_, i) => UUID(new Uint32Array([i, 0])));

		const tree = createTree();
		for (const item of inserting) await insert(tree, i, item);
		for (const item of inserting) assert(await has(tree, item));
	});

	test(`btree fill blockSize ${name} sequential reversed`, async () => {
		const inserting = Array(num).fill(null).map((_, i) => UUID(new Uint32Array([-i, 0])));

		const tree = createTree();
		for (const item of inserting) await insert(tree, i, item);
		for (const item of inserting) assert(await has(tree, item));
	});
}

test('btree', async () => {
	const blockSize = 32;
	let depth = 3;

	let tree = [];
	const items = [];

	for (let i = 0;; i++) {
		const inserting = UUID(i & 2 ? 2 : 4);
		items.push(i & 1 ? inserting : UUID(inserting.toHex()));

		if (await insertItem(tree, blockSize, inserting)) {
			tree = split(tree, blockSize);

			if (--depth === 0) break;
		}
	}

	for (const item of items) {
		assert(await has(tree, item));
	}

	assert(!await has(tree, UUID()));
	assert(!await has(tree, UUID(new Uint32Array([0x7FFFFFFF, 0, 0, 0]))));

	assert(!await remove(tree, blockSize, UUID()));
	assert(!await remove(tree, blockSize, UUID(32)));

	for (const item of items) {
		assert(await remove(tree, blockSize, item));
	}
});

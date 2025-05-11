import {test} from 'node:test';
import assert from 'node:assert';
import {insert, has, remove, insertItem, split, iterate, compare, intersection} from '../util/btree.js';
import UUID from 'destam/UUID.js';

test("btree has empty", async () => {
	const tree = [];
	assert(!await has(tree, UUID()));
});

test("btree remove empty", async () => {
	const tree = [];
	assert(!await remove(tree, UUID()));
});

test("btree insert", async () => {
	const inserting = UUID();

	const tree = [];
	await insert(tree, 5, inserting);

	assert(await has(tree, inserting));
});

test("btree fill node", async () => {
	const inserting = Array(5).fill(null).map(() => UUID());

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);

	assert(!tree.some(item => Array.isArray(item)));
	for (const item of inserting) assert(has(tree, item));
});

test("btree fill node has end", async () => {
	const inserting = Array(5).fill(null).map((_, i) => UUID(new Uint32Array([i, 0])));

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);
	assert(!await has(tree, UUID(new Uint32Array([6, 0]))));
});

test("btree fill node has start", async () => {
	const inserting = Array(5).fill(null).map((_, i) => UUID(new Uint32Array([i + 1, 0])));

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);
	assert(!await has(tree, UUID(new Uint32Array([0, 0]))));
});

test("btree fill node and remove", async () => {
	const inserting = Array(15).fill(null).map(() => UUID());

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);
	for (const item of inserting) assert(await remove(tree, 5, item));
	assert.deepStrictEqual(tree, []);
});

test("btree fill node and remove in order", async () => {
	const inserting = Array(15).fill(null).map(() => UUID());

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);

	const inOrder = await Array.fromAsync(iterate(tree));
	assert.deepEqual(inOrder.length, inserting.length);

	for (const item of inOrder) assert(await remove(tree, 5, item));
	assert.deepStrictEqual(tree, []);
});

test("btree fill node and remove constrained root", async () => {
	const inserting = Array(15).fill(null).map(() => UUID());

	const tree = [];
	tree.blockSize = 3;

	for (const item of inserting) await insert(tree, 5, item);
	for (const item of inserting) assert(await remove(tree, 5, item));
	assert.deepStrictEqual([...tree], []);
});

test("btree fill node and remove in order constrained root", async () => {
	const inserting = Array(15).fill(null).map(() => UUID());

	const tree = [];
	tree.blockSize = 3;
	for (const item of inserting) await insert(tree, 5, item);

	const inOrder = await Array.fromAsync(iterate(tree));
	assert.deepEqual(inOrder.length, inserting.length);

	for (const item of inOrder) assert(await remove(tree, 5, item));
	assert.deepStrictEqual([...tree], []);
});

test("btree has between", async () => {
	const tree = [];
	insert(tree, 5, UUID(new Uint32Array([0])))
	insert(tree, 5, UUID(new Uint32Array([2])))

	assert(!await has(tree, UUID(new Uint32Array([1]))));
});

test("btree remove between", async () => {
	const tree = [];
	insert(tree, 5, UUID(new Uint32Array([0])))
	insert(tree, 5, UUID(new Uint32Array([2])))

	assert(!await remove(tree, 5, UUID(new Uint32Array([1]))));
});

test("btree fill node and remove copied UUID", async () => {
	const inserting = Array(5).fill(null).map(() => UUID());

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);
	for (const item of inserting) assert(await remove(tree, 5, UUID(item.toHex())));
	assert.deepStrictEqual(tree, []);
});

test("btree fill node to split", async () => {
	const inserting = Array(6).fill(null).map(() => UUID());

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);

	assert(tree.some(item => Array.isArray(item)));
	for (const item of inserting) assert(await has(tree, item));
});

test("btree remove split", async () => {
	const inserting = Array(6).fill(null).map(() => UUID());

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);

	assert(await remove(tree, 5, tree.find(e => e instanceof UUID)));
});

test("btree remove nested", async () => {
	const inserting = Array(6).fill(null).map(() => UUID());

	const tree = [];
	for (const item of inserting) await insert(tree, 5, item);

	assert(await remove(tree, 5, tree[0][0]));
});

test("btree remove split deep", async () => {
	let depth = 3;
	let tree = [];
	while (true) {
		if (await insertItem(tree, 5, UUID())) {
			tree = split(tree, 5);
			if (--depth === 0) break;
		}
	}

	assert(await remove(tree, 5, tree.find(e => e instanceof UUID)));
});

test("btree empty iterate", async () => {
	let tree = [];

	assert.deepStrictEqual(await Array.fromAsync(iterate(tree)), []);
});

test("btree intersection empty", async () => {
	let tree = [];
	let tree2 = [];

	assert.deepStrictEqual(await Array.fromAsync(intersection(tree, tree2)), []);
});

test("btree empty intersection", async () => {
	let tree = [UUID()];
	let tree2 = [UUID()];

	assert.deepStrictEqual(await Array.fromAsync(intersection(tree, tree2)), []);
});

test("btree intersection same", async () => {
	let tree = [UUID()];

	assert.deepStrictEqual(await Array.fromAsync(intersection(tree, tree)), tree);
});

test("btree intersection small", async () => {
	let one = UUID();
	let two = UUID();

	let tree1 = [];
	await insert(tree1, 5, one);
	await insert(tree1, 5, two);
	await insert(tree1, 5, UUID());
	await insert(tree1, 5, UUID());

	let tree2 = [];
	await insert(tree2, 5, one);
	await insert(tree2, 5, two);
	await insert(tree2, 5, UUID());
	await insert(tree2, 5, UUID());

	assert.deepStrictEqual(new Set(await Array.fromAsync(intersection(tree1, tree2))), new Set([one, two]));
});

test("btree intersection large", async () => {
	let one = UUID();
	let two = UUID();

	let tree1 = [];
	await insert(tree1, 5, one);
	await insert(tree1, 5, two);
	for (let i = 0; i < 1024; i++) {
		await insert(tree1, 5, UUID());
	}

	let tree2 = [];
	await insert(tree2, 5, one);
	await insert(tree2, 5, two);
	for (let i = 0; i < 1024; i++) {
		await insert(tree2, 5, UUID());
	}

	assert.deepStrictEqual(new Set(await Array.fromAsync(intersection(tree1, tree2))), new Set([one, two]));
});

test("btree intersection large three", async () => {
	let one = UUID();
	let two = UUID();

	let tree1 = [];
	await insert(tree1, 5, one);
	await insert(tree1, 5, two);
	for (let i = 0; i < 1024; i++) {
		await insert(tree1, 5, UUID());
	}

	let tree2 = [];
	await insert(tree2, 5, one);
	await insert(tree2, 5, two);
	for (let i = 0; i < 1024; i++) {
		await insert(tree2, 5, UUID());
	}

	let tree3 = [];
	await insert(tree3, 5, one);
	await insert(tree3, 5, two);
	for (let i = 0; i < 1024; i++) {
		await insert(tree3, 5, UUID());
	}

	assert.deepStrictEqual(new Set(await Array.fromAsync(intersection(tree1, tree2, tree3))), new Set([one, two]));
});

{
	let has = UUID();

	let tree = [];
	await insert(tree, 5, has);
	for (let i = 0; i < 1024; i++) {
		await insert(tree, 5, UUID());
	}

	test("btree intersection find", async () => {
		const comp = await Array.fromAsync(intersection(tree, [has]));
		assert.deepStrictEqual(comp, [has]);
	});
}

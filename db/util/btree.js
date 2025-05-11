import UUID from 'destam/UUID.js';
import {len, assert} from 'destam/util.js';
import util from 'node:util';

const isUUID = val => val instanceof UUID;

export const compare = (first, second) => {
	if (first === second) return 0;

	first = UUID(first).buffer;
	second = UUID(second).buffer;

	const lenDif = len(first) - len(second);
	if (lenDif !== 0) return lenDif < 0 ? -1 : 1;

	for (let i = 0; i < len(first); i++){
		if (first[i] < second[i]) {
			return -1;
		} else if (first[i] > second[i]) {
			return 1;
		}
	}

	return 0;
};

const find = (tree, item, left = 0) => {
	const cmp = (left) => {
		if (!left) return 1;
		assert(isUUID(left), "binary search discovered node");

		return compare(left, item);
	};

	let right = len(tree) - 1;

	while (left <= right) {
		let m = (left + right) >> 1;
		const a = isUUID(tree[m]) ? m : m + 1;

		const res = cmp(tree[a]);
		if (res < 0) {
			left = a + 1;
		} else if (res === 0) {
			return a;
		} else if (left === right) {
			return left;
		} else {
			right = m;
		}
	}

	return left;
};

const merge = async (tree, blockSize, index) => {
	let replacing = 1, replacement = index;

	const nodes = [...await tree[index]];

	// balance with neighbours if node utilization is extreme
	if (Math.min(len(nodes), blockSize - len(nodes)) < 2) {
		if (index >= 2) {
			nodes.splice(0, 0, ...(await tree[index - 2]), tree[index - 1]);
			replacement -= 2;
			replacing += 2;
		}

		if (index + 2 < len(tree)) {
			nodes.push(tree[index + 1], ...(await tree[index + 2]));
			replacing += 2;
		}
	}

	tree.splice(replacement, replacing, ...split(nodes, blockSize));
	tree.modified?.();
};

export const has = async (tree, item) => {
	while (true) {
		const i = find(tree, item);

		if (i >= len(tree)){
			return false;
		} else if (isUUID(tree[i])) {
			return compare(tree[i], item) === 0;
		} else {
			tree = await tree[i];
		}
	}
};

export const split = (tree, blockSize) => {
	const splits = Math.ceil(len(tree) / blockSize);
	if (splits === 1) {
		return [tree];
	}

	let left = Math.floor(len(tree) / splits);
	if (!isUUID(tree[left])) left--;

	const out = [tree.slice(0, left)];

	for (let i = 2; i < splits; i++) {
		let advance = Math.floor(len(tree) * i / splits);
		if (!isUUID(tree[advance])) advance++;

		assert(isUUID(tree[left]), "not a uuid");

		const block = tree.slice(left + 1, advance);
		assert(block.length <= blockSize);
		assert(block.length >= 1);

		out.push(tree[left], block);
		left = advance;
	}

	assert(isUUID(tree[left]), "not a uuid");

	const block = tree.slice(left + 1)
	assert(block.length <= blockSize);
	assert(block.length >= 1);

	out.push(tree[left], block);
	return out;
};

export const insertItem = async (tree, blockSize, item) => {
	const insert = find(tree, item);

	const child = tree[insert];
	if (!child || isUUID(child)) {
		tree.splice(insert, 0, item);
		tree.modified?.();
	} else if (await insertItem(await child, blockSize, item)) {
		await merge(tree, blockSize, insert);
	}

	return len(tree) > blockSize;
};

export const remove = async (tree, blockSize, item) => {
	let stack = [];
	const minSize = 3;

	while (true) {
		const i = find(tree, item);

		if (i >= len(tree)){
			return false;
		} else if (!isUUID(tree[i])) {
			stack.push([i, tree]);
			tree = await tree[i];
		} else if (compare(tree[i], item) === 0) {
			if (i > 0 && !isUUID(tree[i - 1])) {
				const orig = tree;

				stack.push([i - 1, tree]);
				tree = await tree[i - 1];

				// replace the taken key with something deeper in the tree
				let replace;
				while (true) {
					const last = len(tree) - 1;
					if (isUUID(tree[last])) {
						replace = tree.pop();
						break;
					}

					stack.push([last, tree]);
					tree = await tree[last];
				}

				assert(replace);
				orig[i] = replace;
				orig.modified?.();
			} else {
				tree.splice(i, 1);
				tree.modified?.();
			}

			// we removed the item, now try to flatten the b-tree.
			while (len(stack)) {
				const [index, tree] = stack.pop();

				const indexLen = len(tree[index]);
				if (indexLen >= minSize && indexLen <= blockSize) break;

				await merge(tree, blockSize, index);
				if (len(stack) === 0 && len(tree) === 1) {
					tree.splice(0, 1, ...tree[0]);
					tree.modified?.();
				}
			}

			return true;
		} else {
			return false;
		}
	}
};

export const insert = async (tree, blockSize, item) => {
	const blsize = tree.blockSize ? tree.blockSize : blockSize;
	await insertItem(tree, blockSize, item);

	if (len(tree) > blsize) {
		tree.splice(0, len(tree), ...split(tree, blsize));
		tree.modified?.();
	}
};

const iterator = (tree) => {
	let top = {
		tree,
		index: 0,
	};

	return async (next) => {
		while (top) {
			let index = top.index;
			if (next) {
				index = find(top.tree, next, index);
			}

			top.index = index + 1;
			const item = top.tree[index];

			if (!item) {
				top = top.parent;
			} else if (isUUID(item)) {
				return item;
			} else {
				top = {
					parent: top,
					tree: await item,
					index: 0,
				};
			}
		}

		return null;
	};
};

export const intersection = async function * (...trees) {
	assert(trees.length > 0);

	// fast path for a a single tree to intersection (just iterate all values in the
	// one tree)
	if (trees.length === 1) {
		const iter = iterator(trees[0]);

		while (true) {
			const item = await iter();
			if (!item) return null;
			yield item;
		}
	}

	let prime;
	for (const tree of trees) {
		if (isUUID(tree[0]) && (!prime || compare(prime, tree[0]) < 0)) {
			prime = tree[0];
		}
	}

	const iterators = await Promise.all(trees.map(async tree => {
		const iter = iterator(tree);
		return {
			iter,
			value: await iter(prime),
		};
	}));

	for (const iter of iterators) if (!iter.value) return;

	while (true) {
		let equ = true;
		let max = null;

		// find the max value of all iterators and keep track if all of them are
		// the same
		for (const iter of iterators) {
			if (!max) {
				max = iter.value;
			} else {
				const cmp = compare(max, iter.value);
				if (cmp !== 0) {
					equ = false;
				}

				if (cmp < 0) {
					max = iter.value;
				}
			}
		}

		// all iterators have the same value
		if (equ) {
			yield max;

			max = null;
		}

		// if the iterators did not produce the same value, advance all iterators
		// less than the max value. If there is no max (because we found a intersection
		// member), advance all iterators once.
		for (const iter of iterators) {
			if (max && compare(iter.value, max) == 0) continue;

			if (!(iter.value = await iter.iter(max))) {
				return;
			}
		}
	}
};

export const iterate = (tree) => {
	return intersection(tree);
};

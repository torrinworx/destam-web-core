import {assert} from 'destam/util.js';

const dates = ['createdAt', 'deletedAt', 'modifiedAt'];

class DuelMap {
	constructor (parent) {
		this.map = new Map();
		this.values = new Set();
		this.listeners = [];
		this.parent = parent;
	}
	path (path) {
		if (!path.length) return this;

		if (!this.parent && dates.includes(path[0])){
			return null;
		} else if (path[0] === 'constructor') {
			return null;
		}

		let current = this;

		for (const value of path) {
			let next = current.map.get(value);
			if (!next) current.map.set(value, next = new DuelMap(current));
			current = next;
		}

		return current;
	}
	remove (value) {
		this.values.delete(value);

		return this;
	}
	add (value) {
		this.values.add(value);
		for (const l of this.listeners) l(value);
		return this;
	}
	countEntries () {
		let count = this.values.size;
		for (const map of this.map.values()) {
			count += map.countEntries();
		}
		return count;
	}
};

export default parent => {
	const collectionCache = new Map();
	let freedCaches = 0;

	const registry = new FinalizationRegistry(({weak, paths}) => {
		for (const path of paths) {
			path.remove(weak);
		}
		freedCaches++;
	});

	const out = (collectionName, query) => {
		let cache = collectionCache.get(collectionName);
		if (!cache) {
			collectionCache.set(collectionName, cache = new DuelMap());
		}

		const setupHooks = (item) => {
			const weak = new WeakRef(item);
			const paths = new Set([cache]);

			const updateQuery = (path, prev, value) => {
				const root = cache.path(path);
				const walk = (node, cache, setter) => {
					if (Array.isArray(node)) {
						for (let i = 0; i < node.length; i++) {
							walk(node[i], cache, setter);
						}
					} else if (typeof node === 'object') {
						for (let o in node) {
							walk(node[o], cache && cache.path([o]), setter);
						}
					} else {
						cache = cache && cache.path([node]);
						if (cache) setter(cache);
					}
				};

				if (prev) walk(prev, root, cache => paths.delete(cache.remove(weak)));
				if (value) walk(value, root, cache => paths.add(cache.add(weak)));
			};

			cache.add(weak);
			registry.register(item, {weak, paths});
			item.query.observer.watch(delta => {
				updateQuery(delta.path, delta.prev, delta.value);
			});

			updateQuery([], null, item.query);
		};

		const processed = new Set();

		let caches;
		let cacheEntries;
		if (query) {
			cacheEntries = Object.entries(query).map(([key, val]) => cache.path([
				...key.split('.'),
				val,
			]));

			if (!cacheEntries.length) cacheEntries = [cache];

			caches = (function *() {
				main:for (const value of cacheEntries[0].values) {
					for (let i = 1; i < cacheEntries.length; i++) {
						if (!cacheEntries[i].values.has(value)) continue main;
					}

					const deref = value.deref();
					if (!deref) continue;

					if (deref.query.deletedAt) {
						processed.add(deref.query.uuid);
					} else {
						yield deref;
					}
				}
			})();
		}

		let lookup;
		return {
			listen: cb => {
				const listener = value => {
					const unwrapped = value.deref();
					if (!unwrapped) return;
					if (processed.has(unwrapped.query.uuid)) return;

					for (const entry of cacheEntries) {
						if (!entry.values.has(value)) return;
					}

					processed.add(unwrapped.query.uuid);
					cb(unwrapped);
				};

				for (const entry of cacheEntries) {
					entry.listeners.push(listener);
				}

				return () => {
					for (const entry of cacheEntries) {
						const i = entry.listeners.indexOf(listener);
						entry.listeners.splice(i, 1);
					}
				};
			},
			next: async () => {
				if (caches) {
					const next = caches.next();
					if (!next.done) {
						processed.add(next.value.query.uuid);
						return next;
					}
				}

				// we exausted the entire cache, start searching the actual db
				if (!lookup) lookup = parent(collectionName, query);

				while (true) {
					const item = await lookup.next();
					if (item.done) {
						break;
					}

					if (processed.has(item.value.query.uuid)) {
						continue;
					}

					processed.add(item.value.query.uuid);

					const val = item.value;

					// double check that this item is not already cached
					const path = cache.path(['uuid', val.query.uuid]);
					if (path.values.size) {
						assert(path.values.size === 1);

						const val = path.values.values().next().value.deref();
						if (val) return { done: false, value: val };
					}

					setupHooks(val);
					return { done: false, value: val };
				}

				return { done: true };
			},
			return: async () => {
				if (caches?.return) await caches.return();
				if (lookup?.return) await lookup.return();

				return { done: true };
			},
		};
	};

	out.flush = async () => {
		for (const cache of collectionCache.values()) {
			for (const weak of cache.values) {
				const item = weak.deref();

				if (item) {
					await item.flush();
				}
			}
		}

		await parent.flush();
	};

	out.close = () => parent.close();

	out.stats = () => ({
		freedCaches,
		namespaces: [...collectionCache.entries()].map(([name, cache]) => {
			const unique = cache.values;
			const date = Date.now();
			let active = 0;

			for (const entry of unique) {
				const data = entry.deref();
				const activeDate = Math.max(
					data.query.createdAt ?? 0,
					data.query.modifiedAt ?? 0,
					data.query.deletedAt ?? 0);
				if (data && date - activeDate <= 1000 * 60 * 5) {
					active++;
				}
			}

			return {
				name,
				entries: cache.countEntries(),
				unique: unique.size,
				active,
			};
		}),
		...parent.stats(),
	});

	return out;
};

import cache from './driver/cache.js';
import OArray from 'destam/Array.js';
import { assert } from 'destam/util.js';

export default (driver) => {
	driver = cache(driver);
	const objects = new WeakMap();

	const registerInstance = async entry => {
		const instance = await entry.instance();
		if (!objects.has(instance)) {
			objects.set(instance, entry);

			Object.defineProperty(instance, 'query', {
				value: entry.query,
				enumerable: false,
				writable: false,
			});

			instance.observer.watch(change => {
				entry.query.modifiedAt = new Date();
			});
		}

		return instance;
	};

	const DBTable = async (name, query) => {
		assert(typeof name === 'string', "Table name must be a string");
		assert(query == null || typeof query === 'object', "Query must be null or an object");

		const driverQuery = driver(name, query);
		const result = await driverQuery.next();
		if (driverQuery.return) await driverQuery.return();

		if (result.done) return null;

		objects.set(result.value.query, result.value);

		return await registerInstance(result.value);
	};

	DBTable.reuse = async (name, query) => {
		assert(typeof name === 'string', "Table name must be a string");
		assert(typeof query === 'object', "Query must be null or an object");

		let out = await DBTable(name, query);

		if (!out) {
			out = await DBTable(name);
			let tmp = {};

			for (let o of Object.keys(query)) {
				let path = o.split('.');
				let current = tmp;

				for (let i = 0; i < path.length - 1; i++) {
					let next = current[path[i]];
					if (!next) current[path[i]] = next = {};
					current = next;
				}

				current[path[path.length - 1]] = query[o];
			}

			for (let o in tmp) {
				out.query[o] = tmp[o];
			}
		}

		return out;
	};

	/*
	 * Querries a single entry from the database. This is similar to the DBTable default query,
	 * but it does not resolve deltas and simply returns the query section of the database entry.
	 *
	 * Because it doesn't resolve any deltas, lookups are much faster here.
	 */
	DBTable.query = async (name, query) => {
		assert(typeof name === 'string', "Table name must be a string");
		assert(typeof query === 'object', "Query must be null or an object");

		const results = driver(name, query);

		const result = await results.next();
		if (results.return) await results.return();

		if (result.done) return null;
		objects.set(result.value.query, result.value);
		return result.value.query;
	};

	/*
	 * Returns a list of database query objects that match the query. Note that what is returned
	 * will not be the full DB entry with decoded deltas, but just a list of the query objects
	 * a full DB query would normally return.
	 */
	DBTable.queryAll = (name, query, reactive) => {
		assert(typeof name === 'string', "Table name must be a string");
		assert(typeof query === 'object', "Query must be null or an object");

		const result = driver(name, query);
		const array = OArray();
		const deleteListeners = [];

		const add = (value) => {
			const query = value.query;
			objects.set(query, value);

			if (reactive) {
				const listener = query.observer.path('deletedAt').effect(val => {
					if (!val) return;
					let i;

					// remove the query item from the array
					i = array.indexOf(query);
					array.splice(i, 1);

					// now also remove the listener
					i = deleteListeners.indexOf(listener);
					deleteListeners.splice(i, 1);
					listener();
				});

				deleteListeners.push(listener);
			}

			array.push(query);
		};

		if (reactive) {
			deleteListeners.push(result.listen(add));
		}

		const promise = (async () => {
			while (true) {
				const {done, value} = await result.next();
				if (done) return array;

				add(value);
			}
		})();

		promise.remove = () => {
			reactive = false;
			for (const l of deleteListeners) l();
		};

		promise.array = array;
		return promise;
	};

	DBTable.flush = (object) => {
		if (object) {
			const meta = objects.get(object);
			assert(meta, "DB.flush passed with unknown object");
			return meta.flush();
		} else {
			return driver.flush();
		}
	};

	DBTable.delete = (object) => {
		const meta = objects.get(object);
		assert(meta, "DB.delete passed with unknown object");

		objects.delete(object);
		meta.query.deletedAt = new Date();

		return meta.flush();
	};

	DBTable.instance = (object) => {
		const meta = objects.get(object);
		assert(meta, "DB.instance passed with unknown object");

		return registerInstance(meta);
	};

	DBTable.close = async () => {
		await driver.flush();
		await driver.close();
	};

	/*
	DBTable.clearCache = async (name, query) => {
		const result = driver(name, query);

		for await (const item of result) {
			await item.flush();
		}

		if (!name) {
			collectionCache.clear();
		} else if (!query) {
			collectionCache.delete(name);
		} else {
			const ret = queryInstance(collectionCache.get(name), query);


		}
	};
	*/

	DBTable.stats = () => driver.stats();

	return DBTable;
};


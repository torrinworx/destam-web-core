import { OObject, OArray } from 'destam';
import { parse, stringify } from '../common/clone.js';

/**
 * Driver contract (single driver):
 *
 * Required:
 * - create({ collection, record }) -> record
 * - get({ collection, key }) -> record | false
 * - update({ collection, key, record }) -> true
 * - remove({ collection, key }) -> true (throw/false on failure)
 * - queryOne({ collection, query }) -> record | false
 * - queryMany({ collection, query, options? }) -> record[]
 * - watch({ collection, key, onRecord }) -> stop()  (implement polling here if needed)
 *
 * Optional (advanced / "raw"):
 * - rawFindOne({ collection, filter, options? }) -> record | false
 * - rawFindMany({ collection, filter, options? }) -> record[]
 *
 * record shape (stored in DB; never returned to user):
 * {
 *   key: string,              // usually root observer UUID hex (ex: "#A1B2...")
 *   state_tree: object,       // from stringify()/parse()
 *   index: object             // queryable projection (plain JSON)
 * }
 */

const isPlainObject = v =>
	v && typeof v === 'object' && (v.constructor === Object || Object.getPrototypeOf(v) === null);

const isUUIDLike = v =>
	v && typeof v === 'object' && typeof v.toHex === 'function' && v.buffer instanceof Int32Array;

const normalizeIndexValue = v => {
	if (isUUIDLike(v)) return v.toHex();
	if (v instanceof Date) return +v;
	return v;
};

const deepNormalize = v => {
	v = normalizeIndexValue(v);

	if (Array.isArray(v)) return v.map(deepNormalize);
	if (isPlainObject(v)) {
		const out = {};
		for (const k of Object.keys(v)) out[k] = deepNormalize(v[k]);
		return out;
	}
	return v;
};

const makeIndex = (state) => {
	const index = deepNormalize(JSON.parse(JSON.stringify(state)));

	index.id = keyFromState(state);

	// TODO, somehow we need to serialize createdAt and modifiedAt so that 
	// createdAt is stored. Then modifiedAt is stored but also updated every modification.
	// might look into extending clone.js?

	return index;
};

const keyFromState = (state) => {
	const id = state?.observer?.id;
	if (!id) throw new Error('ODB: state is missing observer.id');
	return typeof id.toHex === 'function' ? id.toHex() : String(id);
};

const throttle = (fn, ms) => {
	let t = null;
	let pending = false;

	const run = async () => {
		t = null;
		pending = false;
		await fn();
		if (pending) schedule();
	};

	const schedule = () => {
		if (t) {
			pending = true;
			return;
		}
		t = setTimeout(run, ms);
	};

	schedule.flush = async () => {
		if (t) clearTimeout(t);
		t = null;
		pending = false;
		await fn();
	};

	schedule.cancel = () => {
		if (t) clearTimeout(t);
		t = null;
		pending = false;
	};

	return schedule;
};

// In-place sync so UI keeps the same object references
const obsKey = (v) => {
	const id = v?.observer?.id;
	return id?.toHex ? id.toHex() : null;
};

const syncInto = (dst, src) => {
	if (dst === src) return;

	// OObject
	if (dst instanceof OObject && src instanceof OObject) {
		for (const k of Object.keys(dst)) {
			if (!(k in src)) delete dst[k];
		}

		for (const k of Object.keys(src)) {
			const dv = dst[k];
			const sv = src[k];

			const dk = obsKey(dv);
			const sk = obsKey(sv);

			if (dk && sk && dk === sk) {
				// same observable identity, sync deeper
				if (dv instanceof OObject && sv instanceof OObject) syncInto(dv, sv);
				else if (dv instanceof OArray && sv instanceof OArray) syncInto(dv, sv);
				else dst[k] = sv;
			} else {
				dst[k] = sv;
			}
		}
		return;
	}

	// OArray
	if (dst instanceof OArray && src instanceof OArray) {
		// keyed-by-element-id reconciliation if possible
		const allObjectsWithId = (arr) => arr.every(x => x instanceof OObject && (typeof x.id === 'string' || typeof x.id === 'number'));
		if (allObjectsWithId(dst) && allObjectsWithId(src)) {
			const map = new Map(dst.map(el => [el.id, el]));
			const next = [];

			for (const sEl of src) {
				const existing = map.get(sEl.id);
				if (existing) {
					syncInto(existing, sEl);
					next.push(existing);
				} else {
					next.push(sEl);
				}
			}

			dst.splice(0, dst.length, ...next);
			return;
		}

		// fallback: positional
		const min = Math.min(dst.length, src.length);
		for (let i = 0; i < min; i++) {
			const dv = dst[i];
			const sv = src[i];

			const dk = obsKey(dv);
			const sk = obsKey(sv);

			if (dk && sk && dk === sk) {
				if (dv instanceof OObject && sv instanceof OObject) syncInto(dv, sv);
				else if (dv instanceof OArray && sv instanceof OArray) syncInto(dv, sv);
				else dst[i] = sv;
			} else {
				dst[i] = sv;
			}
		}

		if (src.length > dst.length) dst.push(...src.slice(dst.length));
		else if (dst.length > src.length) dst.splice(src.length, dst.length - src.length);
	}
};

export const createODB = async ({ driver, throttleMs = 75, driverProps = {} } = {}) => {
	if (!driver) throw new Error('ODB: missing "driver"');

	const d = typeof driver === 'function' ? await driver(driverProps) : driver;

	const required = ['create', 'get', 'update', 'remove', 'queryOne', 'queryMany', 'watch'];
	for (const name of required) {
		if (typeof d[name] !== 'function') {
			throw new Error(`ODB: driver is missing required method "${name}()"`);
		}
	}

	// cache: collection::key -> handle
	const cache = new Map();

	const cacheKey = (collection, key) => `${collection}::${key}`;

	const recordFromState = (state) => {
		if (!(state instanceof OObject)) {
			throw new Error('ODB: only OObject documents are supported as roots.');
		}

		const state_tree = JSON.parse(stringify(state));
		const key = keyFromState(state);
		const index = makeIndex(state);

		return { key, state_tree, index };
	};

	const stateFromRecord = (record) => {
		const state = parse(JSON.stringify(record.state_tree));
		if (!(state instanceof OObject)) {
			throw new Error('ODB: parsed document root is not an OObject.');
		}
		return state;
	};

	const attachHandle = (state, handle) => {
		Object.defineProperty(state, '$odb', {
			enumerable: false,
			configurable: true,
			value: handle,
		});
	};

	const openFromRecord = async ({ collection, record }) => {
		const key = record.key || record.state_tree?.id;
		if (!key) throw new Error('ODB: record missing "key" (or state_tree.id)');

		const ckey = cacheKey(collection, key);
		const existing = cache.get(ckey);
		if (existing) {
			existing._refs++;
			return existing.state;
		}

		const state = stateFromRecord(record);

		const handle = {
			state,
			collection,
			key,

			_refs: 1,
			_suppress: 0,
			_stopLocal: null,
			_stopRemote: null,
			_throttledSave: null,

			flush: async () => handle._throttledSave.flush(),
			reload: async () => {
				const rec = await d.get({ collection, key: handle.key });
				if (!rec) return false;

				const next = stateFromRecord(rec);
				handle._suppress++;
				try { syncInto(handle.state, next); }
				finally { handle._suppress--; }

				return true;
			},

			dispose: async () => {
				handle._refs--;
				if (handle._refs > 0) return;

				cache.delete(ckey);

				try { handle._throttledSave?.cancel?.(); } catch { }
				try { handle._stopLocal?.(); } catch { }
				try { await handle._stopRemote?.(); } catch { }
			},

			remove: async () => {
				const ok = await d.remove({ collection, key: handle.key });
				if (!ok) throw new Error('ODB.remove: driver failed to remove document.');
				await handle.dispose();
				return true;
			},
		};

		// local -> db
		const saveNow = async () => {
			if (handle._suppress) return;

			const rec = recordFromState(handle.state);
			const ok = await d.update({ collection, key: handle.key, record: rec });
			if (!ok) throw new Error(`ODB: driver.update() returned false for key=${handle.key}`);
		};

		handle._throttledSave = throttle(saveNow, throttleMs);

		handle._stopLocal = state.observer.watch(() => {
			if (handle._suppress) return;
			handle._throttledSave();
		});

		// db -> local (live propagation)
		handle._stopRemote = await d.watch({
			collection,
			key: handle.key,
			onRecord: (rec) => {
				if (!rec) return; // treat as "deleted" if you want later
				const next = stateFromRecord(rec);

				handle._suppress++;
				try { syncInto(handle.state, next); }
				finally { handle._suppress--; }
			}
		});

		attachHandle(state, handle);
		cache.set(ckey, { state, ...handle });

		return state;
	};

	const ensureValueMatchesQuery = (value, query) => {
		if (!query || !Object.keys(query).length) return value;

		for (const [k, v] of Object.entries(query)) {
			if (!(k in value)) value[k] = v;
			else {
				// strict: query implies these fields
				const a = normalizeIndexValue(value[k]);
				const b = normalizeIndexValue(v);
				if (a !== b) {
					throw new Error(`ODB.open: value.${k} does not match query.${k}`);
				}
			}
		}
		return value;
	};

	const open = async ({ collection, query = null, value = null } = {}) => {
		if (!collection) throw new Error('ODB.open: "collection" is required.');

		const normalizedQuery = query && Object.keys(query).length ? deepNormalize(query) : null;

		// try find existing if query provided
		if (normalizedQuery) {
			const found = await d.queryOne({ collection, query: normalizedQuery });
			if (found) return openFromRecord({ collection, record: found });
		}

		// create new
		if (!value) value = OObject({});
		if (!(value instanceof OObject)) throw new Error('ODB.open: "value" must be an OObject.');

		value = ensureValueMatchesQuery(value, normalizedQuery);

		const rec = recordFromState(value);
		const created = await d.create({ collection, record: rec });
		return openFromRecord({ collection, record: created });
	};

	const findOne = async ({ collection, query } = {}) => {
		if (!collection) throw new Error('ODB.findOne: "collection" is required.');
		if (!query || !Object.keys(query).length) throw new Error('ODB.findOne: "query" is required.');

		const rec = await d.queryOne({ collection, query: deepNormalize(query) });
		if (!rec) return false;
		return openFromRecord({ collection, record: rec });
	};

	const findMany = async ({ collection, query, options } = {}) => {
		if (!collection) throw new Error('ODB.findMany: "collection" is required.');
		if (!query || !Object.keys(query).length) throw new Error('ODB.findMany: "query" is required.');

		const recs = await d.queryMany({ collection, query: deepNormalize(query), options });
		return Promise.all(recs.map(record => openFromRecord({ collection, record })));
	};

	const remove = async ({ collection, query } = {}) => {
		if (!collection) throw new Error('ODB.remove: "collection" is required.');
		if (!query || !Object.keys(query).length) throw new Error('ODB.remove: "query" is required.');

		const rec = await d.queryOne({ collection, query: deepNormalize(query) });
		if (!rec) throw new Error('ODB.remove: document not found.');

		const key = rec.key || rec.state_tree?.id;
		const ok = await d.remove({ collection, key });
		if (!ok) throw new Error('ODB.remove: driver failed to remove document.');

		const ckey = cacheKey(collection, key);
		const existing = cache.get(ckey);
		if (existing?.state?.$odb) await existing.state.$odb.dispose();

		return true;
	};

	const close = async () => {
		// dispose all open docs
		for (const v of [...cache.values()]) {
			try { await v.state.$odb.dispose(); } catch { }
		}
		cache.clear();

		await d.close?.();
	};

	// db.driver.* (advanced), but still returns destam state
	const driverView = new Proxy(d, {
		get(target, prop) {
			if (prop === 'findOne') {
				return async ({ collection, filter, options } = {}) => {
					if (!target.rawFindOne) throw new Error('ODB.driver.findOne: driver.rawFindOne is not implemented');
					const rec = await target.rawFindOne({ collection, filter, options });
					if (!rec) return false;
					return openFromRecord({ collection, record: rec });
				};
			}

			if (prop === 'findMany') {
				return async ({ collection, filter, options } = {}) => {
					if (!target.rawFindMany) throw new Error('ODB.driver.findMany: driver.rawFindMany is not implemented');
					const recs = await target.rawFindMany({ collection, filter, options });
					return Promise.all(recs.map(record => openFromRecord({ collection, record })));
				};
			}

			return target[prop];
		}
	});

	return {
		open,
		findOne,
		findMany,
		remove,
		close,

		driver: driverView,
	};
};

export default createODB;

import Observer, { observerGetter } from 'destam/Observer.js';
import OObject from 'destam/Object.js';
import OArray from 'destam/Array.js';
import OMap from 'destam/UUIDMap.js';
import UUID from 'destam/UUID.js';
import * as Network from 'destam/Network.js';
import { Insert, Modify, Delete } from 'destam/Events.js';
import { registerElement } from 'destam/UUIDMap.js';
import { assert } from 'destam/util.js';

const wrap = (type, props) => ({
	OBJECT_TYPE: type,
	...props,
});

const encodeEvent = (value, name, encodeValue) => {
	return wrap(
		'observer_' + name,
		Object.fromEntries(
			encodeValue.map((name) => {
				let val = value[name];
				if (name === 'time') val = wrap('date', { date: +val });
				return [name, val];
			})
		)
	);
};

const readonlyStore = (store) =>
	new Proxy(store, {
		set() {
			throw new Error('readonly store');
		},
		deleteProperty() {
			throw new Error('readonly store');
		},
		defineProperty() {
			throw new Error('readonly store');
		},
		get(target, prop, receiver) {
			// block mutations via observer paths too
			if (prop === 'observer') {
				return Observer.immutable(target.observer);
			}

			const v = Reflect.get(target, prop, receiver);
			// bind methods so calling target methods still works normally
			return typeof v === 'function' ? v.bind(target) : v;
		},
	});

export const stringify = (state, options) => {
	const duplicates = new Set();

	return JSON.stringify(
		state,
		(key, value) => {
			const reg0 = value?.[observerGetter];
			if (reg0?.id && duplicates.has(value)) return wrap('ref', { id: reg0.id });
			if (reg0?.id) duplicates.add(value);

			duplicates.add(value);

			const getRef = (v, create) => {
				const reg = v?.[observerGetter];

				// If this thing doesn't have a tracking reg/id, it cannot be referenced.
				if (!reg?.id) return create();

				if (!options?.observerRefs || !options.observerRefs(reg)) {
					return create();
				} else {
					return wrap('observer_ref', { id: reg.id.toHex() });
				}
			};

			if (value instanceof UUID) {
				return wrap('uuid', { val: value.toString() });
			}

			if (value instanceof Observer) {
				const reg = value?.[observerGetter];

				// If it has a real reg/id, allow ref behavior, otherwise always inline encode
				if (reg?.id) {
					return getRef(value, () =>
						wrap('observer_value', {
							immutable: value.isImmutable?.() ? 1 : 0,
							value: value.get(),
						})
					);
				}

				return wrap('observer_value', {
					immutable: value.isImmutable?.() ? 1 : 0,
					value: value.get(),
				});
			}

			if (value instanceof OArray) {
				return getRef(value, () => {
					const reg = value[observerGetter];
					const indexes = reg.indexes_;
					const out = [];

					for (let i = 0; i < indexes.length; i++) {
						out.push({
							ref: indexes[i].query_,
							val: value[i],
						});
					}

					return wrap('observer_array', { id: reg.id.toHex(), vals: out });
				});
			} else if (value instanceof OObject) {
				return getRef(value, () => {
					const reg = value[observerGetter];
					const out = [];

					for (const name of Object.keys(value)) {
						out.push({ name, val: value[name] });
					}

					return wrap('observer_object', { id: reg.id.toHex(), vals: out });
				});
			} else if (value instanceof OMap) {
				return getRef(value, () => {
					const reg = value[observerGetter];
					const map = reg.user_;

					const out = [];
					for (let item of map.elements()) out.push(item);

					return wrap('observer_map', { id: reg.id.toHex(), vals: out });
				});
			} else if (value instanceof Insert) {
				return encodeEvent(value, 'insert', ['id', 'value', 'ref', 'time']);
			} else if (value instanceof Modify) {
				return encodeEvent(value, 'modify', ['id', 'value', 'ref', 'time']);
			} else if (value instanceof Delete) {
				return encodeEvent(value, 'delete', ['id', 'ref', 'time']);
			}

			return value;
		},
		2
	);
};

export const parse = (state, options) => {
	const refs = new Map();

	const constructors = {
		observer_array: OArray,
		observer_object: OObject,
		observer_map: OMap,
	};

	const walk = (obj) => {
		if (Array.isArray(obj)) {
			obj.forEach(walk);
		} else if (typeof obj === 'object' && obj) {
			for (let o in obj) {
				if (o === 'OBJECT_TYPE') {
					if (obj.OBJECT_TYPE === 'observer_ref') {
						const obs = options?.observerNetwork?.get(UUID(obj.id));
						assert(obs, 'Could not find referenced id: ' + obj.id);
						refs.set(obj.id, obs);
					} else if (constructors[obj.OBJECT_TYPE]) {
						refs.set(obj.id, constructors[obj.OBJECT_TYPE](null, UUID(obj.id)));
					}
					continue;
				}
				walk(obj[o]);
			}
		}
	};

	walk(JSON.parse(state));

	return JSON.parse(state, (key, value) => {
		if (!(value && typeof value === 'object' && 'OBJECT_TYPE' in value)) {
			return value;
		}

		if (value.OBJECT_TYPE === 'ref') {
			const obj = refs.get(value.id.toHex());
			assert(obj, 'Could not find json ref: ' + value.id.toHex());
			return obj;
		}

		if (value.OBJECT_TYPE === 'observer_ref') {
			const obs = options?.observerNetwork?.get(UUID(value.id));
			assert(obs, 'Could not find referenced id: ' + value.id);
			return obs;
		}

		if (value.OBJECT_TYPE === 'uuid') return UUID(value.val);

		if (value.OBJECT_TYPE === 'observer_value') {
			// value.value is already decoded (likely an OObject / OArray / etc)
			// Return the underlying store (so UI can do msg.observer.path(...))
			// If immutable, wrap it as readonly.
			return value.immutable ? readonlyStore(value.value) : value.value;
		}

		if (value.OBJECT_TYPE === 'observer_array') {
			const val = refs.get(value.id);
			const reg = val[observerGetter];
			const indexes = reg.indexes_;
			const init = reg.init_;

			for (const v of value.vals) {
				const ref = v.ref;
				const link = { reg_: reg, query_: ref };
				indexes.push(link);
				init.push(v.val);
				Network.link(link, v.val?.[observerGetter]);
			}

			refs.set(value.id, val);
			return val;
		}

		if (value.OBJECT_TYPE === 'observer_object') {
			const val = refs.get(value.id);
			const reg = val[observerGetter];
			const nodes = reg.nodes_;
			const init = reg.init_;

			for (const v of value.vals) {
				const link = { reg_: reg, query_: v.name };
				Network.link(link, v.val?.[observerGetter]);
				init[v.name] = v.val;
				nodes.set(v.name, link);
			}

			refs.set(value.id, val);
			return val;
		}

		if (value.OBJECT_TYPE === 'observer_map') {
			const val = refs.get(value.id);
			const reg = val[observerGetter];
			const map = reg.user_;

			for (const v of value.vals) {
				const link = { reg_: reg, user_: v, query_: v.id };
				registerElement(v, link);
				map.setElement(v);
				Network.link(link, v[observerGetter]);
			}

			refs.set(value.id, val);
			return val;
		}

		if (value.OBJECT_TYPE === 'observer_insert') {
			const v = Insert();
			v.id = value.id;
			v.value = value.value;
			v.ref = value.ref;
			v.time = value.time;
			return v;
		}

		if (value.OBJECT_TYPE === 'observer_modify') {
			const v = Modify();
			v.id = value.id;
			v.value = value.value;
			v.ref = value.ref;
			v.time = value.time;
			return v;
		}

		if (value.OBJECT_TYPE === 'date') return new Date(value.date);

		assert(value.OBJECT_TYPE === 'observer_delete', 'unknown object type');
		const v = Delete();
		v.id = value.id;
		v.ref = value.ref;
		v.time = value.time;
		return v;
	});
};

export const clone = (value, options) => {
	return parse(stringify(value, options), options);
};

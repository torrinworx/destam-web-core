// all message definitions for observers

import {register, readUnsigned, writeUnsigned} from './Message.js';
import {observerGetter} from 'destam/Observer.js';
import {assert} from 'destam/util.js';

import UUID from 'destam/UUID.js';
import OArray from 'destam/Array.js';
import OObject from 'destam/Object.js';
import OMap, {registerElement} from 'destam/UUIDMap.js';
import {Insert, Modify, Delete} from 'destam/Events.js';
import * as Network from 'destam/Network.js';

import './uuid.js';

const bigIntLen = i => {
	if (i < 0n) i = -i;

	let n = 0x7Fn;
	let l = 1;
	while (n < i) {
		n = (n << 8n) | 0xFFn;
		l++;
	}

	return l;
};

const fromBigint = (i) => {
	if (typeof i !== 'bigint') {
		return i;
	}

	const n = bigIntLen(i);
	const num = [0];

	for (let ii = 0; ii < n; ii++) {
		num[ii + 1] = Number(i & 0xFFn);
		i >>= 8n;
	}

	return num;
};

const remap = (id, observerRemap) => {
	if (!observerRemap || !id) {
		return id;
	}

	let n = observerRemap.get(id);
	if (!n) {
		observerRemap.set(id, n = UUID());
	}
	return n;
};

register(null, {
	name: 'o_ref',
	alloc: 1,
	lower: v => {
		return [v[observerGetter].id];
	},
	higher: (v, _, {observerNetwork, observerNetworks, getObserverNetworks, workaround}) => {
		if (!observerNetworks && observerNetwork) {
			observerNetworks = [observerNetwork];
		}

		if (!observerNetworks && getObserverNetworks) {
			observerNetworks = getObserverNetworks();
		}

		assert(observerNetworks, "Trying to find a reference for a decode that doesn't support it.");

		for (const network of observerNetworks) {
			const reg = network.get(v[0]);
			if (reg) return reg;
		}

		if (workaround) {
			return OObject({id: UUID(), fake: true});
		}

		throw new Error("Could not find referenced id: " + v[0].toHex());
	},
});

register(OObject, {
	selector: (v, {observerRefs}) => {
		return !observerRefs || !observerRefs(v[observerGetter]) ? null : 'o_ref';
	},
	name: 'o_obj',
	lower: (v, {observerNameFilter}) => {
		let reg = v[observerGetter];

		const keys = [];
		for (let link = reg.linkNext_; link !== reg; link = link.linkNext_) {
			const name = link.query_;

			if (observerNameFilter) {
				if (observerNameFilter(name)) keys.push(name);
			} else if (name[0] !== '_' && name[0] !== '$') {
				keys.push(name);
			}
		}
		let out = Array(keys.length * 2 + 2);
		let i = 0;
		out[i++] = keys.length;
		out[i++] = reg.id;
		for (const name of keys) {
			out[i] = name;
			out[i + keys.length] = v[name];
			i++;
		}

		return out;
	},
	alloc: 2,
	prototype: Object.prototype,
	preallocate (v, {observerRemap}) {
		let id = remap(v[1], observerRemap);

		return {
			value: OObject(Object.create(this.prototype), id),
			count: v[0] * 2,
		};
	},
	higher: (v, {value, count}) => {
		count /= 2;
		const reg = value[observerGetter];
		const nodes = reg.nodes_;
		const init = reg.init_;

		for (let i = 0; i < count; i++) {
			const key = v[i];
			const value = v[i + count];

			const link = {reg_: reg, query_: key};
			Network.link(link, value?.[observerGetter]);
			init[key] = value;
			nodes.set(key, link);
		}
	},
});

const Index = (index) => {
	let o = Object.create(Index.prototype);
	o.data = index;
	return o;
};

Index.prototype = {};

register(Index, {
	name: 'o_arr_i',
	copy: val => val.data,
	write: async (v, stream) => {
		await writeUnsigned(stream, v.data[0]);
		await writeUnsigned(stream, v.data.length - 1);
		await stream.write(v.data.slice(1));
	},
	read: (stream, work) => {
		const decimal = readUnsigned(stream);
		const len = readUnsigned(stream);
		const thing = {
			get bits() {
				return len.value * 8;
			},
			run() {
				this.value = [decimal.value, ...stream.readSync(len.value)];
				return true;
			},
		};

		work.push(thing, len, decimal);
		return thing;
	},
});

register(OArray, {
	selector: (v, {observerRefs}) => {
		return !observerRefs || !observerRefs(v[observerGetter]) ? null : 'o_ref';
	},
	name: 'o_arr',
	lower: v => {
		const reg = v[observerGetter];
		const indexes = reg.indexes_;
		const out = new Array(indexes.length * 2 + 2);

		let i = 0;
		out[i++] = indexes.length;
		out[i++] = reg.id;

		for (let ii = 0; ii < indexes.length; ii++) {
			out[i] = Index(indexes[ii].query_);
			out[i + indexes.length] = v[ii];
			i++;
		}

		return out;
	},
	alloc: 2,
	preallocate: (v, {observerRemap}) => {
		let id = remap(v[1], observerRemap);

		return {count: v[0] * 2, value: OArray(null, id)};
	},
	higher: (v, {value, count}) => {
		count >>= 1;
		const reg = value[observerGetter];
		const indexes = reg.indexes_;
		const init = reg.init_;

		for (let i = 0; i < count; i++) {
			const link = {reg_: reg, query_: fromBigint(v[i])};
			const value = v[i + count];

			indexes.push(link);
			init.push(value);
			Network.link(link, value?.[observerGetter]);
		}
	},
});

register(OMap, {
	selector: (v, {observerRefs}) => {
		return !observerRefs || !observerRefs(v[observerGetter]) ? null : 'o_ref';
	},
	name: 'o_uuid_map',
	lower: v => {
		let reg = v[observerGetter];
		let map = reg.user_;

		let out = new Array(map.size + 2);
		let i = 0;
		out[i++] = map.size;
		out[i++] = reg.id;
		for (let item of map.elements()) {
			out[i++] = item;
		}

		return out;
	},
	alloc: 2,
	preallocate: (v, {observerRemap}) => {
		let id = remap(v[1], observerRemap);

		return {count: v[0], value: OMap(null, id)};
	},
	higher: (v, {value, count}, {finish}) => {
		const reg = value[observerGetter];
		const map = reg.user_;

		for (let i = 0; i < count; i++) {
			const element = v[i];
			const link = {reg_: reg, user_: element};

			registerElement(element, link);
			Network.link(link, element[observerGetter]);

			finish(() => {
				map.setElement(element);
				link.query_ = element.id;
			});
		}
	},
});

const registerEvent = (event, name, encodeValue) => register(event, {
	name,
	alloc: encodeValue.length,
	higher: v => {
		const val = event();
		let i = 0;

		for (let o of encodeValue) {
			val[o] = v[i++];
		}

		if (val.ref) val.ref = fromBigint(val.ref);

		return val;
	},
	lower: state => {
		const out = [];

		for (let o of encodeValue) {
			out.push(state[o]);
		}

		return out;
	}
});

registerEvent(Insert, 'observable_insert', ['id', 'value', 'time', 'ref']);
registerEvent(Modify, 'observable_modify', ['id', 'value', 'time', 'ref']);
registerEvent(Delete, 'observable_delete', ['id', 'time', 'ref']);

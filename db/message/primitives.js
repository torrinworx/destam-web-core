import {register, registerError, readString, readUnsigned, writeUnsigned} from './Message.js';
import ReadStream from '../stream/read.js';
import {decode as utf8Decode, encode as utf8Encode} from '../stream/utf8.js';

register(Date, {
	name: 'date',
	copy: date => new Date(date),
	size: 8,
	read: stream => {
		let low = stream.readUInt32LE();
		let high = stream.readUInt32LE();

		return new Date(low + high * Math.pow(2, 32));
	},
	write: async (value, stream) => {
		let date = +value;
		stream.writeUInt32LE(date | 0);
		stream.writeUInt32LE(Math.floor(date / Math.pow(2, 32)) | 0);
	}
});

register(Array, {
	name: 'arr',
	alloc: 1,
	preallocate: v => ({value: [], count: v[0]}),
	higher: (deps, {value}) => {
		for (let i = 0; i < deps.length; i++) {
			value[i] = deps[i];
		}
	},
	lower: array => [array.length].concat(array),
});

register(Set, {
	name: 'set',
	alloc: 1,
	preallocate: v => ({value: new Set(), count: v[0]}),
	higher: (deps, {value}) => {
		for (let i = 0; i < deps.length; i++) {
			value.add(deps[i]);
		}
	},
	lower: set => [set.size].concat([...set]),
});

register(Map, {
	name: 'map',
	alloc: 1,
	preallocate: v => ({value: new Map(), count: v[0] * 2}),
	higher: (deps, {value}) => {
		let count = deps.length / 2;
		for (let i = 0; i < count; i++) {
			value.set(deps[i], deps[i + count]);
		}
	},
	lower: map => {
		let out = new Array(map.size * 2 + 1).fill(null);
		let i = 0;
		out[i++] = map.size;
		for (const [key, value] of map.entries()) {
			out[i] = key;
			out[i + map.size] = value;
			i++;
		}
		return out;
	}
});

register(URLSearchParams, {
	name: 'urlsp',
	lower: data => {
		const keys = [];
		const values = [];
		let len = 0;
		for (const [key, value] of data.entries()) {
			keys.push(key);
			values.push(value);
			len++;
		}
		return [len, ...keys, ...values];
	},
	alloc: 1,
	preallocate: v => {
		return {
			value: new URLSearchParams(),
			count: v[0] * 2,
		};
	},
	higher: async (deps, pre) => {
		let mid = deps.length / 2;

		for (let i = 0; i < mid; i++) {
			pre.value.append(deps[i], deps[i + mid]);
		}
	}
});

register(Object, {
	name: 'obj',
	lower: object => {
		let arr = [];

		for (let o in object) {
			let c = o.charAt(0);
			if (c === '_' || c === '$') {
				continue;
			}

			arr.push(o);
		}

		for (let i = 0, k = arr.length; i < k; i++) {
			arr.push(object[arr[i]]);
		}

		arr.splice(0, 0, arr.length >> 1);

		return arr;
	},
	alloc: 1,
	prototype: Object.prototype,
	preallocate (v) {
		return {
			value: Object.create(this.prototype),
			count: v[0] * 2,
		};
	},
	higher: (deps, pre) => {
		let mid = deps.length / 2;

		for (let i = 0; i < mid; i++) {
			pre.value[deps[i]] = deps[i + mid];
		}
	}
});

register(Number, {
	selector: num => {
		if (((num & 0xFFFF) << 16) >> 16 === num) {
			return 'srt';
		}else if ((num | 0) === num) {
			return 'int';
		}else{
			return 'dbl';
		}
	},
	entries: [{
		name: 'srt',
		copy: num => num,
		size: 2,
		read: stream => {
			return stream.readInt16LE();
		},
		write: (value, stream) => {
			return stream.writeInt16LE(value);
		}
	}, {
		name: 'int',
		copy: num => num,
		size: 4,
		read: stream => {
			return stream.readInt32LE();
		},
		write: (value, stream) => {
			return stream.writeInt32LE(value);
		}
	}, {
		name: 'dbl',
		copy: num => num,
		size: 8,
		read: stream => {
			return stream.readDoubleLE();
		},
		write: (value, stream) => {
			return stream.writeDoubleLE(value);
		}
	}]
});

register(String, {
	selector: str => {
		for (let i = 0; i < str.length; i++) {
			if (str.charAt(i) === '\0') {
				return 'lstr';
			}
		}

		return 'str';
	},
	entries: [{
		name: 'str',
		copy: str => str,
		read: (stream, work) => {
			const thing = readString(stream);
			work.push(thing);
			return thing;
		},
		write: (value, stream) => {
			stream.writeString(value);
		}
	}, {
		name: 'lstr',
		copy: str => str,
		read: (stream, work) => {
			const len = readUnsigned(stream);
			const stuff = {
				get bits () {
					return len.value * 8;
				},
				run() {
					this.value = utf8Decode(stream.readSync(len.value));
					return true;
				}
			};

			work.push(stuff, len);
			return stuff;
		},
		write: async (str, stream) => {
			const bytes = utf8Encode(str);
			writeUnsigned(stream, bytes.length);
			await stream.write(bytes);
		}
	}]
});

register(ArrayBuffer, {
	name: 'buf',
	copy: src => {
		const dst = new ArrayBuffer(src.byteLength);
		new Uint8Array(dst).set(new Uint8Array(src));
		return dst;
	},
	read: (stream, work) => {
		const length = readUnsigned(stream);
		const stuff = {
			bits: 8,
			read: 0,
			run () {
				if (!this.value) {
					this.buffer = new Uint8Array(length.value);
					this.value = this.buffer.buffer;
				}

				if (this.read < length.value) {
					const buf = stream.readAny(length.value - this.read);
					this.buffer.set(buf, this.read);
					this.read += buf.length;
				}
				return this.read === length.value;
			}
		};

		work.push(stuff, length);
		return stuff;
	},
	write: async (value, stream) => {
		writeUnsigned(stream, value.byteLength);
		await stream.write(new Uint8Array(value));
	}
});

{
	const extend = (name, constructor) => {
		register(constructor, {
			name,
			alloc: 3,
			lower: object => {
				return [object.buffer, object.byteOffset, object.length];
			},
			higher: v => {
				return new constructor(...v);
			}
		});
	};

	extend('uint8a', Uint8Array);
	extend('int8a', Int8Array);
	extend('uint16a', Uint16Array);
	extend('int16a', Int16Array);
	extend('uint32a', Uint32Array);
	extend('int32a', Int32Array);
	extend('cuint8a', Uint8ClampedArray);
	extend('f32a', Float32Array);
	extend('f64a', Float64Array);
}

register(Boolean, {
	name: 'bool',
	size: 1,
	read: stream => {
		return !!stream.readUInt8();
	},
	write: (value, stream) => {
		stream.writeUInt8(value ? 1 : 0);
	}
});

register(Function, {
	name: 'func',
	copy: func => func,
});

register(BigInt, {
	name: 'bint',
	copy: int => int,
	read: (stream, work) => {
		const stuff = {
			bits: 8,
			first: true,
			value: 0n,
			run () {
				let len = stream.readUInt8();
				if (this.first) {
					this.negative = len >> 7;
					len &= 0x7F;
					this.first = false;
				}

				if (len === 0) {
					if (this.negative) this.value = -this.value;
					return true;
				}

				work.push({
					bits: len * 8,
					run: () => {
						for (let i = 0; i < len; i++) {
							this.value = (this.value << 8n) | BigInt(stream.readUInt8());
						}

						return true;
					}
				});

				return false;
			}
		};
		work.push(stuff);
		return stuff;
	},
	write: (int, stream) => {
		const negative = int < 0n;
		if (negative) int = -int;

		let bytes = [];
		while (int !== 0n) {
			bytes.push(Number(BigInt.asUintN(8, int)));
			int >>= 8n;
		}

		let first = true;
		while (bytes.length) {
			let len;
			if (first) {
				len = Math.min(bytes.length, 0x7F);
				stream.writeUInt8((negative << 7) | len);
				first = false;
			} else {
				len = Math.min(bytes.length, 0xFF);
				stream.writeUInt8(len);
			}

			for (let i = 0; i < len; i++) {
				stream.writeUInt8(bytes.pop());
			}
		}

		stream.writeUInt8(0);
	},
});

registerError(Error, 'error');
registerError(TypeError, 'error-type');
registerError(ReadStream.UnderflowError, 'error-undeflow');

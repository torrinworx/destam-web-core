import Heap from 'heap';
import {decode as utf8Decode} from '../stream/utf8.js';
import {assert} from 'destam/util.js';
import ReadStream from '../stream/read.js';
import WriteStream from '../stream/write.js';

// just 4 bytes that came out of /dev/urandom
const MAGIC = 0x9822dbfb;
const CURRENT_VERSION = 0;

class MultiMap {
	constructor () {
		this.map = new Map();
		this.len = 0;
	}

	set (key, val) {
		this.len = key.length;

		let current = this.map;

		for (let i = 0; i < key.length - 1; i++) {
			let next = current.get(key[i]);
			assert(next);
			current = next;
		}

		current.set(key[key.length - 1], val);
	}

	increment (key) {
		this.len = key.length;
		let current = this.map;

		for (let i = 0; i < key.length - 1; i++) {
			let next = current.get(key[i]);
			if (!next) {
				next = new Map();
				current.set(key[i], next);
			}
			current = next;
		}

		current.set(key[key.length - 1], (current.get(key[key.length - 1]) || 0) + 1);
	}

	get (key, val) {
		let current = this.map;

		for (let i = 0; i < key.length - 1; i++) {
			current = current.get(key[i]);
		}

		return current.get(key[key.length - 1]);
	}

	entries () {
		let stack = [];
		let names = [];

		stack.push(this.map[Symbol.iterator]());

		return {
			[Symbol.iterator] () {
				return this;
			},
			next: () => {
				for (let i = stack.length - 1; i >= 0; i--) {
					let next = stack[i].next();

					if (next.done) {
						stack.pop();
						names.pop();
					}else if (i + 1 === this.len) {
						return {value: [names.concat([next.value[0]]), next.value[1]], done: false};
					}else{
						names.push(next.value[0]);
						stack.push(next.value[1][Symbol.iterator]());
						i = stack.length;
					}
				}

				return {value: undefined, done: true};
			}
		};
	}
}

const builtins = (() => {
	const objects = [
		true, false, undefined, null
	];

	for (let i = -128; i < 128; i++) {
		objects.push(i);
	}

	return objects;
})();

// the basis of the format relies on three mechanisms
//  - binary data storage
//  - primitive creation
//  - object building
//  the binary data stores raw data that is used for primitive creation. These
//  binary data chunks can have compression or be split up in arbitrary ways
//  so that it can be optimized for the use case. Primitives like strings or
//  integers are created from this raw binary data. Then object building
//  happens where these primitives are taken and put together into the object.
//  Primitive creation and object creation are split up because they handle
//  fundamentally different ways of arranging data. Primitive creation handles
//  new data types that have no dependencies. Object creation is based on
//  building up primitives and may have more complex data structures possibly
//  including circles in the graph

// format:
// 	- 4 bytes: magic
// 	- 1 byte: version
// 	- extent list: initial extent
// 	- extent list[]: list of extents
// 	- EOF
//
// an extent list is a null terminated array of extents
//  - extent[]: list of extents
//  - 1 byte: 0
//
// The format is made up of a series of extents. Extents are regions of the file
// that describe a part of the message. These extents look like this
//  - 1 byte: type
//    - 0: EOF marker
//    - 1: primitive list
//      - string: null terminated string which specifies the type of primitives that are encoded here
//      - byte[]: Relative position of binary extent
//      - byte 0: EOL marker
//    - 2: object list
//      - string: null terminated string which specifies the type of primitives that are encoded here
//      - huffman table definition for deltas
//      - list of deltas
//    - 3: delta huffman table definition
//    - 4: binary data
//    - 5: binary data run length encoded
//    - 6: binary data deflate compression
//    - 7: binary data zstd compression
//    - 8-16: reserved for further binary compression methods
//    - 17: root reference
//    - 18: string type table
//    - 18-253: reserved
//    - 0xF7: extended type - next 4 bytes contains the extent type
//    - 0xFF: extended type with length - next 4 bytes contains the extent type and the further 4 encode a length
//      - this space is used exclusively for optional extents, any decoder can safely skip over these
//  - (optional) 4 bytes: extended type
//  - (optional) 4 bytes: extent length (not including the 9 byte header)

export const encode = async (obj, writeStream, options) => {
	let stream;
	if (writeStream) {
		stream = WriteStream.create(writeStream);
	} else {
		stream = new WriteStream();
	}

	stream.writeUInt32LE(MAGIC);
	stream.writeUInt8(CURRENT_VERSION);

	await encodeLean(obj, stream, options);

	if (!writeStream) {
		return stream.toUint8Array();
	}
};

export const writeUnsigned = (stream, value) => {
	do {
		let byte = value & 0x7F;
		value >>= 7;
		stream.writeUInt8(byte | (value ? 0x80 : 0));
	} while (value);
};

export const readUnsigned = (stream) => ({
	value: 0,
	shift: 0,
	bits: 8,
	run () {
		const byte = stream.readUInt8();
		this.value |= (byte & 0x7F) << this.shift;
		this.shift += 7;
		return !(byte & 0x80);
	},
});

export const readString = (stream) => ({
	bits: 8,
	data: [],
	run() {
		const byte = stream.readUInt8();
		if (byte === 0) {
			this.value = utf8Decode(this.data);
			return true;
		}

		this.data.push(byte);
		return false;
	},
});

export const encodeLean = async (obj, writeStream, options = {}) => {
	if (!options.register) options.register = globalMappings;

	let stream;
	if (writeStream) {
		stream = WriteStream.create(writeStream);
	} else {
		stream = new WriteStream();
	}

	let primitives = new Map();
	let objects = new Map();

	let objectIndex = builtins.length;

	let dups = new Map();
	// fill out dups with what is already in the primitives set
	for (let i = 0; i < builtins.length; i++){
		let builtin = builtins[i];
		dups.set(builtin, {index: i, object: builtin});
	}

	{
		const traverse = object => {
			let ret = dups.get(object);
			if (ret) return ret;

			try {
				const serializer = getFrom(object, options);
				assert(serializer, "no serializer for object");

				dups.set(object, ret = {serializer, index: undefined, object});

				if (serializer.lower) {
					ret.children = serializer.lower(object, options).map(traverse);

					let entry = objects.get(serializer);

					if (!entry) {
						objects.set(serializer, entry = {objects: [], serializer, depends: new Set()});
					}

					entry.objects.push(ret);

					const bound = Math.min(serializer.alloc ?? Infinity, ret.children.length);
					for (let i = 0; i < bound; i++) {
						const child = ret.children[i];
						entry.depends.add(child.serializer);
					}
				} else {
					assert(serializer.write,
						"No way to serialize " + serializer.name);

					if (!primitives.has(serializer)) {
						primitives.set(serializer, [ret]);
					} else {
						primitives.get(serializer).push(ret);
					}
				}
			} catch(e) {
				console.log('encoding object', Object.getPrototypeOf(object), object);
				throw e;
			}

			return ret;
		};

		traverse(obj);
	}

	let ordered = [];
	for (let thing of objects.values()) {
		// find a good place to put the thing that will handle the dependency order

		let i = 0;
		for (; i < ordered.length; i++) {
			if (ordered[i].depends.has(thing.serializer)){
				break;
			}
		}

		ordered.splice(i, 0, thing);
	}
	objects = ordered;

	primitives = [...primitives.entries()].map(([serializer, objects]) => ({serializer, objects}));

	let current = 0, currentPos = 0;
	const writeBits = (value, len) => {
		current |= value << currentPos;
		currentPos += len;

		while (currentPos > 8) {
			stream.writeInt8(current & 0xFF);
			current >>= 8;
			currentPos -= 8;
		}
	};

	const flush = () => {
		while (currentPos > 0) {
			stream.writeInt8(current & 0xFF);
			current >>= 8;
			currentPos -= 8;
		}

		currentPos = 0;
		current = 0;
	};

	const writeUnsigned = value => {
		let index = 0;
		let denominations = [3, 3, 7, 15, 31];
		do {
			let den = denominations[index];
			writeBits(value & ((1 << den) - 1), den);
			value >>= den;
			writeBits(value ? 1 : 0, 1);
			index++;
		} while(value);
	};

	const encodeTypes = async (types) => {
		writeBits(18, 8);
		writeUnsigned(types.length);

		writeBits(4, 8);
		flush();

		let table = new Map();
		let i = 0;
		for (const {serializer} of types) {
			stream.writeString(serializer.name);
			table.set(serializer, i++);
		}

		await stream.maybeFlush();

		return table;
	};

	const encodePrimitives = async (primitives, typeTable) => {
		for (const {serializer, objects} of primitives) {
			writeBits(1, 8);
			writeUnsigned(typeTable.get(serializer));
			writeUnsigned(objects.length);

			writeBits(4, 8);
			flush();

			for (let object of objects) {
				await serializer.write(object.object, stream, options);
				object.index = objectIndex++;

				await stream.maybeFlush();
			}
		}
	};

	const encodeObjects = async (objs, typeTable) => {
		let startingIndex = objectIndex;
		// assign indexes
		for (const {objects} of objs) {
			for (let entry of objects) {
				entry.index = objectIndex++;
			}
		}

		let frequencies = new MultiMap();
		let serial = new Map();

		for (const {serializer, objects} of objs) {
			let ser = [];
			let previous = startingIndex;
			let runLength = 0;

			for (let {children, index} of objects) {
				for (let child of children) {
					// bail out if delta changes or the run length gets too
					// long as we can only encode 16 bit unsigned integers
					if (previous + 1 !== child.index) {
						if (runLength) {
							ser.push(runLength, previous - runLength + 1);
							runLength = 0;
						}
					}

					runLength++;
					assert(child.index !== undefined, "trying to serialize an object that doesn't have an index yet");
					assert(serializer.preallocate || index > child.index,
						"Tried to serialize an object that looks forward but doesn't support random access");

					previous = child.index;
				}
			}

			if (runLength) {
				ser.push(runLength, previous - runLength + 1);
			}

			previous = startingIndex;
			for (let i = 0; i < ser.length; i += 2) {
				let runLength = ser[i];
				let index = ser[i + 1];

				// if the run length is 1 assume that absolute encoding will
				// always be more efficient
				if (runLength === 1) {
					runLength = 0;
				} else {
					// delta encoding
					const delta = index - previous;
					previous = index;
					index = delta;

					previous += runLength - 1;
				}

				frequencies.increment([index, runLength]);
				ser[i] = runLength;
				ser[i + 1] = index;
			}

			serial.set(serializer, {ser, objects});
			startingIndex += objects.length;
		}

		const heap = new Heap((a, b) => a.freq - b.freq);
		for (let [value, freq] of frequencies.entries()) {
			heap.push({
				freq,
				value,
			});
		}

		while (heap.size() > 1) {
			let a = heap.pop();
			let b = heap.pop();

			heap.push({
				freq: a.freq + b.freq,
				value: [a.value, b.value],
			});
		}

		{
			let absolutePrevious = 0;

			// write the huffman table and populate lookup table
			const writeHuffTable = (table, val, len) => {
				if (Array.isArray(table[0])) {
					writeBits(0, 1);

					writeHuffTable(table[0], val, len + 1);
					writeHuffTable(table[1], val | (1 << len), len + 1);
				} else { // leaf
					let [delta, runLength] = table;
					writeBits(1, 1);
					writeUnsigned(runLength);

					if (!runLength) {
						let absDelta = delta - absolutePrevious;
						absolutePrevious = delta;
						delta = absDelta;
					}

					let absDelta;
					if (delta < 0) {
						writeBits(1, 1);
						absDelta = -delta - 1;
					}else{
						writeBits(0, 1);
						absDelta = delta;
					}

					writeUnsigned(absDelta);

					frequencies.set(table, {val, len});
				}
			};

			writeBits(3, 8);
			writeHuffTable(heap.pop().value, 0, 0);
		}

		for (const [serializer, {ser, objects}] of serial.entries()) {
			writeBits(2, 8);
			writeUnsigned(typeTable.get(serializer));
			writeUnsigned(objects.length);

			for (let i = 0; i < ser.length; i += 2) {
				const runLength = ser[i];
				const delta = ser[i + 1];

				let val = frequencies.get([delta, runLength]);
				writeBits(val.val, val.len);
			}

			await stream.maybeFlush();
		}
	};

	if (primitives.length) await encodePrimitives(primitives, await encodeTypes(primitives));
	if (objects.length) await encodeObjects(objects, await encodeTypes(objects));

	// write root offset if needed
	if (dups.get(obj).index !== objectIndex - 1) {
		writeBits(17, 8);
		let offset = objectIndex - 1 - dups.get(obj).index;

		flush();
		writeUnsigned(offset);
	}

	// EOF extent
	writeBits(0, 8);
	flush();
	await stream.flush(true);

	if (!writeStream) {
		return stream.toUint8Array();
	}
};

export const decode = async (stream, options) => {
	stream = ReadStream.create(stream);

	await stream.ensureRead(5);
	if (stream.readUInt32LE() !== MAGIC) throw new Error("Not in packing format");
	if (stream.readUInt8() > CURRENT_VERSION) throw new Error("version is too new");

	return decodeLean(stream, options);
};

export const runWorkQueue = (stream, work) => new Promise((ok, err) => {
	stream.currentLen = 0;

	const doWork = () => {
		let index = work.length - 1;
		let workPiece = work[index];

		while (workPiece) {
			const bits = workPiece.bits;
			if (stream.remaining * 8 + stream.currentLen < bits) {
				break;
			}

			const ret = workPiece.run();
			assert(bits !== 0 || ret || work.length - 1 !== index, "reader made no forward progress for zero length message");

			if (ret) {
				work.splice(index, 1);

				if (ret.then) {
					ret.then(doWork).catch(err);
					return;
				}
			}

			index = work.length - 1;
			workPiece = work[index];
		}

		if (workPiece) {
			const read = workPiece.bits - stream.currentLen;
			stream.ensureRead((read >> 3) + !!(read & 0x7)).then(doWork).catch(err);
		} else {
			ok();
		}
	};

	doWork();
});

export const decodeLean = (stream, options = {}) => {
	if (!options.register) options.register = globalMappings;
	stream = ReadStream.create(stream);

	let current = 0;

	const readBit = () => {
		if (!stream.currentLen) {
			current = stream.readUInt8();
			stream.currentLen += 8;
		}

		const val = current & 1;
		current >>= 1;
		stream.currentLen--;
		return val;
	};

	const readBits = len => {
		while (stream.currentLen < len) {
			current |= stream.readUInt8() << stream.currentLen;
			stream.currentLen += 8;
		}

		const val = current & ((1 << len) - 1);
		current >>= len;
		stream.currentLen -= len;
		return val;
	};

	const flush = () => {
		current = 0;
		stream.currentLen = 0;
	};

	// readUnsigned can read up to 8 bytes
	const unsignedDenominations = [3, 3, 7, 15, 31];
	const readUnsigned = () => ({
		index: 0,
		value: 0,
		pos: 0,
		get bits () {
			return unsignedDenominations[this.index] + 1;
		},
		run () {
			let den = unsignedDenominations[this.index++];
			this.value |= readBits(den) << this.pos;
			this.pos += den;

			return !readBit();
		},
	});

	const objects = builtins.slice();
	const deferred = [];

	let binHandler;
	let lastTypes, lastHuffTable;
	let rootOffset;

	const finishHandlers = [];
	options.finish = cb => finishHandlers.push(cb);

	const createFrameReader = () => ({
		bits: 8,
		run: () => {
			const type = readBits(8);

			if (type === 0) {
				return true;
			} else if (type === 4) {
				flush();

				work.push(binHandler(stream));
			} else if (type === 18) { // type list
				const count = readUnsigned();
				work.push(count);

				binHandler = (stream) => ({
					bits: 0,
					index: 0,
					types: Array(count.value).fill(null),
					string: null,
					run() {
						assert(count.value);

						if (this.string) {
							const type = this.string.value;
							const serializer = options.register.nameMapping.get(type);
							assert(serializer, "Unknown type: " + JSON.stringify(type));

							this.types[this.index++] = serializer;
						}

						if (this.index >= count.value) {
							lastTypes = this.types;
							return true;
						}

						this.string = readString(stream);
						work.push(this.string);
						return false;
					},
				});
			} else if (type === 1) { // primative list
				const serializerIndex = readUnsigned();
				const count = readUnsigned();
				work.push(count, serializerIndex);

				binHandler = stream => ({
					get bits (){
						const serializer = lastTypes[serializerIndex.value];
						if (!serializer.size) {
							return 0;
						}

						if (this.index >= count.value) {
							return 0;
						}

						return serializer.size * 8;
					},
					index: 0,
					run() {
						const serializer = lastTypes[serializerIndex.value];

						if (this.index >= count.value) {
							if (!serializer.size) {
								for (let i = objects.length - this.index; i < objects.length; i++) {
									objects[i] = objects[i].value;
								}
							}

							return true;
						}

						objects.push(serializer.read(stream, work, options));
						this.index++;
						return false;
					},
				});
			} else if (type === 3) { // huffman table
				let absolutePrevious = 0;

				const createHuffman = () => ({
					bits: 1,
					run() {
						if (!readBit()) {
							this.left = createHuffman();
							this.right = createHuffman();

							work.push(this.right, this.left);
						} else {
							const runLength = readUnsigned();
							const sign = {
								bits: 1,
								run() {
									this.value = readBit();
									return true;
								}
							};
							const delta = readUnsigned();

							work.push({
								bits: 0,
								run: () => {
									this.delta = sign.value ? -(delta.value + 1) : delta.value;
									this.runLength = runLength.value;

									if (!this.runLength) {
										absolutePrevious += this.delta;
										this.delta = absolutePrevious;
									}

									return true;
								},
							}, delta, sign, runLength);
						}

						return true;
					}
				});

				lastHuffTable = createHuffman();
				work.push(lastHuffTable);
			} else if (type === 2) { // object list
				const serializerIndex = readUnsigned();
				const count = readUnsigned();

				let previous = objects.length;

				const readEntry = {
					bits: 1,
					len: 0,
					run() {
						while (this.huff.left) {
							if (stream.currentLen === 0 && stream.remaining === 0) {
								return false;
							}

							this.huff = readBit() ? this.huff.right : this.huff.left;
						}

						if (this.huff.runLength) {
							this.len = this.huff.runLength;
							previous += this.huff.delta;
							this.value = previous;
							previous += this.len - 1;
						} else {
							this.value = this.huff.delta;
							this.len = 1;
						}

						return true;
					}
				};

				const readEntries = (len) => ({
					bits: 0,
					value: Array(len).fill(null),
					index: 0,
					run() {
						if (len === 0) return true;

						while (readEntry.len > 0) {
							readEntry.len--;
							this.value[this.index++] = readEntry.value++;

							if (this.index === len) {
								return true;
							}
						}

						readEntry.huff = lastHuffTable;
						work.push(readEntry);
						return false;
					}
				});

				work.push({
					bits: 0,
					run: () => {
						const serializer = lastTypes[serializerIndex.value];

						if (serializer.preallocate) {
							work.push({
								bits: 0,
								index: 0,
								entries: null,
								run() {
									let objEntries;
									if (this.entries) {
										const things = this.entries.value.map(i => {
											assert(i < objects.length, "overflow");
											return objects[i];
										});

										const pre = serializer.preallocate(things, options);
										let dependencies;
										if (pre.count === 0) {
											dependencies = {value: []};
										} else {
											dependencies = objEntries = readEntries(pre.count);
										}

										objects.push(pre.value);
										deferred.push({serializer, pre, dependencies});
										this.index++;
									}

									if (this.index === count.value) {
										if (objEntries) work.push(objEntries);
										return true;
									}

									this.entries = readEntries(serializer.alloc);
									work.push(this.entries);
									if (objEntries) work.push(objEntries);
									return false;
								},
							});
						} else {
							work.push({
								bits: 0,
								index: 0,
								entries: null,
								run() {
									if (this.entries) {
										const things = this.entries.value.map(i => {
											assert(i < objects.length, "overflow");
											return objects[i];
										});

										objects.push(serializer.higher(things, null, options));
										this.index++;
									}

									if (this.index === count.value) {
										return true;
									}

									this.entries = readEntries(serializer.alloc);
									work.push(this.entries);
									return false;
								},
							});
						}

						return true;
					}
				}, count, serializerIndex);
			} else {
				assert(type === 17, "Unknown extent type: " + type);

				flush();
				rootOffset = readUnsigned();
				work.push(rootOffset);
			}

			return false;
		}
	});

	const work = [createFrameReader()];
	return runWorkQueue(stream, work).then(() => {
		for (let i = 0; i < deferred.length; i++) {
			let {serializer, pre, dependencies} = deferred[i];
			serializer.higher(
				dependencies.value.map(index => {
					return objects[index];
				}),
				pre, options
			);
		}

		for (let handler of finishHandlers) {
			handler();
		}

		return objects[objects.length - 1 - (rootOffset ? rootOffset.value : 0)];
	});
};

export const getFrom = (obj, opts = {}) => {
	if (!opts.register) opts.register = globalMappings;

	let serializer = opts.register.prototypeMapping.get(Object.getPrototypeOf(obj));
	if (!serializer && obj instanceof Error) {
		serializer = opts.register.prototypeMapping.get(Error.prototype);
	}

	if (serializer?.selector) {
		const selector = serializer.selector(obj, opts);
		if (selector === null) {
			return serializer;
		}

		return opts.register.nameMapping.get(selector);
	}

	return serializer;
};

// makes a deep copy of the given object
export const copy = (obj, options = {}) => {
	if (!options.register) options.register = globalMappings;

	const finishHandlers = [];
	options.finish = cb => finishHandlers.push(cb);

	const deferred = [];
	const dups = new Map([
		true, false, null, undefined
	].map(value => [value, {value}]));

	const traverse = object => {
		let ret = dups.get(object);
		if (ret) return ret;

		const serializer = getFrom(object, options);
		assert(serializer, "no serializer for object");

		dups.set(object, ret = {});

		if (serializer.copy) {
			ret.value = serializer.copy(object);
		} else {
			assert(serializer.lower, "No way to copy this object: " + serializer.name);

			const lowered = serializer.lower(object, options).map(traverse);
			if (serializer.preallocate) {
				const pre = serializer.preallocate(lowered.slice(0, serializer.alloc).map(dep => dep.value), options);
				assert(pre.count === lowered.length - serializer.alloc,
					"Preallocation assertion length error: " + serializer.name);

				ret.value = pre.value;
				deferred.push({serializer, pre, dependencies: lowered.slice(serializer.alloc)});
			} else {
				assert(lowered.length === serializer.alloc,
					"Higher assertion length error: " + serializer.name);

				ret.value = serializer.higher(lowered.map(dep => dep.value), null, options);
			}
		}

		return ret;
	};

	const ret = traverse(obj);

	for (let i = 0; i < deferred.length; i++) {
		let {serializer, pre, dependencies} = deferred[i];
		serializer.higher(
			dependencies.map(dep => dep.value),
			pre, options
		);
	}

	for (let handler of finishHandlers) {
		handler();
	}

	return ret.value;
};


export const createRegister = (extend) => {
	const nameMapping = new Map(extend?.nameMapping);
	const prototypeMapping = new Map(extend?.prototypeMapping);

	const fillPrototypeMapping = (serializer, obj) => {
		assert(obj.name, "Object doesn't have a name");

		if (Array.isArray(serializer)) {
			for (let s of serializer) {
				prototypeMapping.set(s.prototype, obj);
			}
		} else {
			prototypeMapping.set(serializer.prototype, obj);
		}
	};

	return {
		nameMapping,
		prototypeMapping,
		register: (serializer, props) => {
			let name = props.name;
			if (!name && props.entries) {
				name = 'Compound(' + props.entries.map(e => e.name).join(',') + ')';
			}

			let obj;
			 if (props.extend) {
				let extending = nameMapping.get(props.extend);
				assert(extending, "Extending object does not exist: " + props.extend);

				if (!props.name) {
					fillPrototypeMapping(serializer, extending);
					return;
				}

				obj = Object.create(extending);
				Object.assign(obj, props);

				if (props.lower) {
					obj.lower = value => props.lower(extending.lower(value));
				}
				if (props.higher) {
					obj.higher = (next, pre, options) =>
						Promise.resolve(extending.higher(next, pre, options))
							.then(val => props.higher(val, pre, options));
				}
			} else {
				obj = props;
			}

			obj.name = name;

			assert(!obj.higher || obj.alloc, "Message serialization to higher must have an alloc size");

			if (props.entries) {
				obj.entries = props.entries.map(entry => register(null, entry));
			} else {
				if (nameMapping.has(name)) {
					console.warn("Replacing message serializer: " + name);
				}

				nameMapping.set(name, obj);
			}

			if (serializer) {
				fillPrototypeMapping(serializer, obj);
			}
		},
		registerError: (constructor, name) => {
			register(constructor, {
				name,
				alloc: 1,
				lower: error => {
					// only enable stack traces for development for security purposes
					if (process.env.NODE_ENV === 'development') {
						return [error.message + '\0' + error.stack];
					} else {
						return [error.message];
					}
				},
				higher: v => {
					let [message, stack] = v[0].split('\0');
					const e = new constructor(message);
					if (stack) e.stack = stack;
					return e;
				}
			});
		},
		has: name => nameMapping.has(name),
	};
};

export const globalMappings = createRegister();
export const register = globalMappings.register;
export const registerError = globalMappings.registerError;

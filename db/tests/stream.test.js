import ReadStream from '../stream/read.js';
import WriteStream from '../stream/write.js';
import {test, describe, it} from 'node:test';
import assert from 'node:assert';
import {readStreamToNode, writeStreamToNode} from '../stream/nodeUtils.js';
import {Readable, Writable} from 'node:stream';

test("stream read byte", async () => {
	const stream = ReadStream.create(Buffer.from([1]));
	await stream.ensureRead(1);
	assert.equal(stream.readInt8(), 1);
});

test("ReadStream.create arrayBuffer", async () => {
	const stream = ReadStream.create(new Uint8Array([1]).buffer);
	await stream.ensureRead(1);
	assert.equal(stream.readInt8(), 1);
});

test("ReadStream.create string", async () => {
	const stream = ReadStream.create("A");
	await stream.ensureRead(1);
	assert.equal(stream.readInt8(), 65);
});

test("ReadStream.create response", async () => {
	let thrown = false;
	try {
		ReadStream.create(new Response());
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("ReadStream.create from itself", async () => {
	const stream = ReadStream.create(ReadStream.create(Buffer.from([1])));
	await stream.ensureRead(1);
	assert.equal(stream.readInt8(), 1);
});

test("WriteStream.create from itself", async () => {
	const stream = WriteStream.create(new WriteStream());
	stream.writeUInt8(1);
	assert.deepStrictEqual(stream.toUint8Array(), new Uint8Array([1]));
});

test("stream write close twice", async () => {
	const stream = WriteStream.create(() => {});
	await stream.flush(true);

	let thrown = false;
	try {
		await stream.flush(true);
	} catch (e) {
		thrown = true;
	}
	assert(thrown);
});

test("stream read empty", async () => {
	const stream = ReadStream.create([Buffer.from([])]);
	await stream.ensureRead();
	assert(stream.closed);
});

test("stream read read", async () => {
	const buf = Buffer.from([0, 1]);
	const stream = ReadStream.create(buf);
	assert.deepStrictEqual(buf, await stream.read(2));
});

test("stream read ReadableStream", async () => {
	const buf = Buffer.from([0, 1]);
	const stream = ReadStream.create(ReadableStream.from((function *() {
		for (let i = 0; i < buf.length; i++) {
			yield Buffer.from([buf[i]]);
		}
	})()));
	assert.deepStrictEqual(buf, await stream.read(2));
});

test("stream read Blob", async () => {
	const buf = Buffer.from([0, 1]);
	const stream = ReadStream.create(new Blob([buf]));
	assert.deepStrictEqual(buf, await stream.read(2));
});

test("stream read read small", async () => {
	const buf = Buffer.from([0, 1]);
	const stream = ReadStream.create(buf);
	await stream.ensureRead();
	assert.deepStrictEqual(Buffer.from(buf.subarray(0, 1)), await stream.read(1));
});

test("stream read read underflow", async () => {
	const buf = Buffer.from([0, 1]);
	const stream = ReadStream.create(buf);

	let thrown = false;
	try {
		await stream.read(3);
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream read skip", async () => {
	const stream = ReadStream.create(Buffer.from([0, 1]));
	await stream.ensureRead();
	stream.skip(1);
	assert.equal(stream.readInt8(), 1);
});

test("stream read skip underflow", async () => {
	const stream = ReadStream.create([Buffer.from([0, 1])]);
	await stream.ensureRead();

	let thrown = false;
	try {
		stream.skip(3);
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream read skip partial read", async () => {
	const stream = ReadStream.create([Buffer.from([0]), Buffer.from([1])]);
	await stream.ensureRead();

	stream.skip(1);

	let thrown = false;
	try {
		stream.skip(3);
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream read partial read", async () => {
	const stream = ReadStream.create([Buffer.from([0]), Buffer.from([1])]);
	await stream.ensureRead();

	stream.skip(1);

	let thrown = false;
	try {
		stream.readUInt8();
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream read injest large buffer", async () => {
	const buffer = Buffer.alloc(1024 * 1024);
	const stream = ReadStream.create([buffer]);

	await stream.ensureRead();

	let len = 0;
	while (!stream.closed) {
		stream.readUInt8();
		len++;
	}

	assert.equal(buffer.length, len);
});

test("stream read injest two large buffer", async () => {
	const buffer = Buffer.alloc(1024 * 1024);
	const buffer2 = Buffer.alloc(1024 * 1024);
	const stream = ReadStream.create([buffer, buffer2]);

	await stream.ensureRead();

	let len = 0;
	while (!stream.closed) {
		if (len === buffer.length) await stream.ensureRead();

		stream.readUInt8();
		len++;
	}

	assert.equal(buffer.length + buffer2.length, len);
});

test("stream read injest two large buffer partial read", async () => {
	const buffer = Buffer.alloc(1024 * 1024);
	const buffer2 = Buffer.alloc(1024 * 1024);
	const stream = ReadStream.create([buffer, buffer2]);

	await stream.ensureRead();

	let len = 0;
	while (!stream.closed) {
		if (len === buffer.length - 2) await stream.ensureRead(4);

		stream.readUInt8();
		len++;
	}

	assert.equal(buffer.length + buffer2.length, len);
});

test("stream read injest two buffers partial read", async () => {
	const buffer = Buffer.alloc(1024);
	const buffer2 = Buffer.alloc(1024);
	const stream = ReadStream.create([buffer, buffer2]);

	await stream.ensureRead();

	let len = 0;
	while (!stream.closed) {
		if (len === buffer.length - 2) await stream.ensureRead(4);

		stream.readUInt8();
		len++;
	}

	assert.equal(buffer.length + buffer2.length, len);
});

test("stream read injest two buffers barely fits partial read", async () => {
	const buffer = Buffer.alloc(1024);
	const buffer2 = Buffer.alloc(1024);
	const stream = ReadStream.create([buffer, buffer2], 1024 + 2);

	await stream.ensureRead();

	let len = 0;
	while (!stream.closed) {
		if (len === buffer.length - 2) await stream.ensureRead(4);

		stream.readUInt8();
		len++;
	}

	assert.equal(buffer.length + buffer2.length, len);
});

test("stream read error", async () => {
	const stream = new ReadStream(() => {
		return {error: 'whoops'};
	});

	let thrown = false;
	try {
		await stream.ensureRead();
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream read twice error", async () => {
	const stream = new ReadStream(() => {
		return {error: 'whoops'};
	});

	try {
		await stream.ensureRead();
	} catch (e) {}

	let thrown = false;
	try {
		await stream.ensureRead();
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream read multiple bytes", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create(Buffer.from(stuff));

	await stream.ensureRead(stuff.length);

	for (const thing of stuff) {
		assert.equal(stream.readUInt8(), thing);
	}
});

test("stream read readAny", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create(Buffer.from(stuff));

	await stream.ensureRead(stuff.length);

	assert.deepStrictEqual(stream.readAny(stuff.length), Buffer.from(stuff));
});

test("stream read readSync", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create(Buffer.from(stuff));

	await stream.ensureRead(stuff.length);

	assert.deepStrictEqual(stream.readSync(stuff.length), Buffer.from(stuff));
});

test("stream read readAll", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create(Buffer.from(stuff));

	assert.deepStrictEqual(await stream.readAll(stuff.length), Buffer.from(stuff));
});

test("stream read readAll unbound", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create(Buffer.from(stuff));

	assert.deepStrictEqual(await stream.readAll(), Buffer.from(stuff));
});

test("stream read readAny partial", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create(Buffer.from(stuff));

	await stream.ensureRead(stuff.length);

	assert.deepStrictEqual(stream.readAny(10000), Buffer.from(stuff));
});

test("stream read readAny underflow", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create([Buffer.from(stuff)]);

	let thrown = false;
	try {
		stream.readAny(1);
	} catch(e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream read readSync underflow", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create(Buffer.from(stuff));

	await stream.ensureRead(stuff.length);

	let thrown = false;
	try {
		stream.readSync(10000);
	} catch(e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream read multiple bytes", async () => {
	const stuff = Array(256).fill(null).map((_, i) => i);
	const stream = ReadStream.create(Buffer.from(stuff));

	await stream.ensureRead(stuff.length);

	for (const thing of stuff) {
		assert.equal(stream.readUInt8(), thing);
	}
});

test("stream ReadStream.create nodejs stream", async () => {
	const stream = Readable();
	stream._read = () => {
		// Trigger the error asynchronously to mimic real stream behavior
	 	process.nextTick(() => stream.emit('error', new Error()));
	};

	const read = ReadStream.create(stream);

	let thrown = false;
	try {
		await read.read(1);
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream ReadStream.write nodejs stream", async () => {
	const stream = Writable();
	stream._write = (chunk, encoding, callback) => {
		// Trigger the error asynchronously to mimic real stream behavior
	 	process.nextTick(() => callback(new Error()));
	};

	stream.on('error', () => {});

	const write = WriteStream.create(stream);

	let thrown = false;
	try {
		write.writeUInt8(1);
		await write.flush(true);
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream ReadStream.create nodejs emit error synchronous", async () => {
	const stream = Readable();
	stream._read = () => {};

	const read = ReadStream.create(stream);
	stream.emit('error', new Error());

	let thrown = false;
	try {
		await read.read(1);
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("stream ReadStream.create nodejs stream errored", async () => {
	const stream = Readable();
	stream._read = () => {
		// Trigger the error asynchronously to mimic real stream behavior
	 	process.nextTick(() => stream.destroy(new Error()));
	};

	stream.on('data', () => {});

	assert(await new Promise(ok => {
		stream.on('error', async () => {
			const read = ReadStream.create(stream);

			let thrown = false;
			try {
				await read.read(1);
			} catch (e) {
				thrown = true;
			}
			ok(thrown);
		})
	}));
});

test("passthrough prime write", async () => {
	const [readStream, writeStream] = WriteStream.createPassthrough(1024);

	writeStream.writeUInt8(0);
	writeStream.flush(true);

	await readStream.ensureRead();
	assert.equal(readStream.readUInt8(), 0);
});

test("read write blobs", async () => {
	let writeStream;
	let readStream = new Promise(ok => {
		writeStream = WriteStream.createBlob(blob => {
			ok(ReadStream.create(blob));
		});
	});

	await writeStream.write(new Blob([
		new Uint8Array([1]).buffer,
		new Uint8Array([2]).buffer,
	]));
	await writeStream.flush(true);

	readStream = await readStream;
	await readStream.ensureRead(2);

	assert.deepStrictEqual([readStream.readUInt8(), readStream.readUInt8()], [1, 2]);
});

const createCycleTest = (name, cycle) => (cb) => {
	describe(name, () => {
		cb(it, cycle);
	});
};

[
	createCycleTest("stream cycle", (write, read) => async () => {
		const [readStream, writeStream] = WriteStream.createPassthrough(1024);
		const vals = Promise.resolve(write(writeStream)).then(val => (writeStream.flush(true), val));
		await readStream.ensureRead();

		assert.deepStrictEqual(await read(readStream), await vals);
	}),
	createCycleTest("stream cycle node write", (write, read) => async () => {
		const [readStream, origWriteStream] = WriteStream.createPassthrough(1024);
		const writeStream = WriteStream.create(writeStreamToNode(origWriteStream), 1024);
		const vals = Promise.resolve(write(writeStream)).then(val => (writeStream.flush(true), val));
		await readStream.ensureRead();

		assert.deepStrictEqual(await read(readStream), await vals);
	}),
	createCycleTest("stream cycle node read", (write, read) => async () => {
		const [origReadStream, writeStream] = WriteStream.createPassthrough(1024);
		const readStream = ReadStream.create(readStreamToNode(origReadStream));
		const vals = Promise.resolve(write(writeStream)).then(val => (writeStream.flush(true), val));
		await readStream.ensureRead();

		assert.deepStrictEqual(await read(readStream), await vals);
	}),
	createCycleTest("stream cycle blob", (write, read) => async () => {
		let writeStream;
		let readStream = new Promise(ok => {
			writeStream = WriteStream.createBlob(blob => {
				ok(ReadStream.create(blob));
			});
		});
		const vals = Promise.resolve(write(writeStream)).then(val => (writeStream.flush(true), val));

		readStream = await readStream;
		await readStream.ensureRead();

		assert.deepStrictEqual(await read(readStream), await vals);
	}),
	createCycleTest("stream cycle memory", (write, read) => async () => {
		const writeStream = new WriteStream(null, 1024);
		const vals = await write(writeStream);
		await writeStream.flush(true);

		const readStream = ReadStream.create(writeStream.toUint8Array());
		await readStream.ensureRead();

		assert.deepStrictEqual(await read(readStream), vals);
	}),
].forEach(func => func((test, cycle) => {
	test("stream unsigned byte", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 8));

		stream.writeUInt8(val);
		return val;
	}, stream => {
		return stream.readUInt8();
	}));

	test("stream signed byte", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 8));

		stream.writeInt8(val);
		return val << 24 >> 24;
	}, stream => {
		return stream.readInt8();
	}));

	test("stream DoubleBE", cycle(stream => {
		const val = Math.random();

		stream.writeDoubleBE(val);
		return val;
	}, stream => {
		return stream.readDoubleBE();
	}));

	test("stream DoubleLE", cycle(stream => {
		const val = Math.random();

		stream.writeDoubleLE(val);
		return val;
	}, stream => {
		return stream.readDoubleLE();
	}));

	test("stream FloatBE", cycle(stream => {
		const val = Math.random();

		stream.writeFloatBE(val);
		return new Float32Array([val])[0];
	}, stream => {
		return stream.readFloatBE();
	}));

	test("stream FloatLE", cycle(stream => {
		const val = Math.random();

		stream.writeFloatLE(val);
		return new Float32Array([val])[0];
	}, stream => {
		return stream.readFloatLE();
	}));

	test("stream Int16BE", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 16));

		stream.writeInt16BE(val);
		return val << 16 >> 16;
	}, stream => {
		return stream.readInt16BE();
	}));

	test("stream Int16LE", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 16));

		stream.writeInt16LE(val);
		return val << 16 >> 16;
	}, stream => {
		return stream.readInt16LE();
	}));

	test("stream UInt16BE", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 16));

		stream.writeUInt16BE(val);
		return val;
	}, stream => {
		return stream.readUInt16BE();
	}));

	test("stream UInt16LE", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 16));

		stream.writeUInt16LE(val);
		return val;
	}, stream => {
		return stream.readUInt16LE();
	}));

	test("stream Int32BE", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 32));

		stream.writeInt32BE(val);
		return val & ~0;
	}, stream => {
		return stream.readInt32BE();
	}));

	test("stream Int32LE", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 32));

		stream.writeInt32LE(val);
		return val & ~0;
	}, stream => {
		return stream.readInt32LE();
	}));

	test("stream UInt32BE", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 32));

		stream.writeUInt32BE(val);
		return val;
	}, stream => {
		return stream.readUInt32BE();
	}));

	test("stream UInt32LE", cycle(stream => {
		const val = Math.floor(Math.random() * (2 ** 32));

		stream.writeUInt32LE(val);
		return val;
	}, stream => {
		return stream.readUInt32LE();
	}));

	test("stream UInt64BE", cycle(stream => {
		const low = Math.floor(Math.random() * (2 ** 32));
		const high = 1;// Math.floor(Math.random() * (2 ** 32));
		const val = BigInt(low) | (BigInt(high) << 32n);

		stream.writeUInt64BE(val);
		return Number(val);
	}, stream => {
		return stream.readUInt64BE();
	}));

	test("stream UInt64LE", cycle(stream => {
		const low = Math.floor(Math.random() * (2 ** 32));
		const high = 1;// Math.floor(Math.random() * (2 ** 32));
		const val = BigInt(low) | (BigInt(high) << 32n);

		stream.writeUInt64LE(val);
		return Number(val);
	}, stream => {
		return stream.readUInt64LE();
	}));

	test("stream string", cycle(stream => {
		const val = "hello world";

		stream.writeString(val);
		return val;
	}, stream => {
		return stream.readString();
	}));

	test("stream overread", cycle(stream => {
		stream.writeUInt8(1);
		return true;
	}, async stream => {
		stream.readUInt8();

		try {
			await stream.ensureRead(1);
			return false;
		} catch (e) {
			return true;
		}
	}));

	test("stream underensure", cycle(stream => {
		stream.writeUInt8(1);
		return true;
	}, async stream => {
		stream.readUInt8();

		try {
			stream.readUInt8();
			return false;
		} catch (e) {
			return true;
		}
	}));

	test("stream underensure", cycle(stream => {
		stream.writeUInt8(1);
		return true;
	}, async stream => {
		stream.readUInt8();

		try {
			stream.readUInt8();
			return false;
		} catch (e) {
			return true;
		}
	}));

	test("stream read nothing", cycle(stream => {
		return true;
	}, async stream => {
		try {
			stream.readUInt8();
			return false;
		} catch (e) {
			return true;
		}
	}));

	test("stream write twice", cycle(async stream => {
		await stream.write([1]);
		await stream.write([2]);
		return [1, 2];
	}, async stream => {
		await stream.ensureRead(2);
		return [stream.readUInt8(), stream.readUInt8()];
	}));

	test("stream write twice slightly smaller than block size", cycle(async stream => {
		const one = Array(1023).fill(null).map((_, i) => i & 0xFF);

		await stream.write(one);
		await stream.write(one);
		return [...one, ...one];
	}, async stream => {
		const out = [];

		while(!stream.closed) {
			await stream.ensureRead();
			if (stream.closed) break;
			out.push(stream.readUInt8());
		}

		return out;
	}));

	test("stream write twice block size", cycle(async stream => {
		const one = Array(1024).fill(null).map((_, i) => i & 0xFF);

		await stream.write(one);
		await stream.write(one);
		return [...one, ...one];
	}, async stream => {
		const out = [];

		while(!stream.closed) {
			await stream.ensureRead();
			if (stream.closed) break;
			out.push(stream.readUInt8());
		}

		return out;
	}));

	test("stream write twice block maybeFlush", cycle(async stream => {
		const one = Array(1024).fill(null).map((_, i) => i & 0xFF);

		for (const thing of one) {
			await stream.maybeFlush();
			stream.writeUInt8(thing);
		}

		return one;
	}, async stream => {
		const out = [];

		while(!stream.closed) {
			await stream.ensureRead();
			if (stream.closed) break;
			out.push(stream.readUInt8());
		}

		return out;
	}));

	test("stream write twice slightly larger than block size", cycle(async stream => {
		const one = Array(1025).fill(null).map((_, i) => i & 0xFF);

		await stream.write(one);
		await stream.write(one);
		return [...one, ...one];
	}, async stream => {
		const out = [];

		while(!stream.closed) {
			await stream.ensureRead();
			if (stream.closed) break;
			out.push(stream.readUInt8());
		}

		return out;
	}));

	test("stream write twice slightly smaller than block size primed", cycle(async stream => {
		const one = Array(1023).fill(null).map((_, i) => i & 0xFF);

		stream.writeUInt8(0);

		await stream.write(one);
		await stream.write(one);
		return [0, ...one, ...one];
	}, async stream => {
		const out = [];

		while(!stream.closed) {
			await stream.ensureRead();
			if (stream.closed) break;
			out.push(stream.readUInt8());
		}

		return out;
	}));

	test("stream write twice block size primed", cycle(async stream => {
		const one = Array(1024).fill(null).map((_, i) => i & 0xFF);

		stream.writeUInt8(0);

		await stream.write(one);
		await stream.write(one);
		return [0, ...one, ...one];
	}, async stream => {
		const out = [];

		while(!stream.closed) {
			await stream.ensureRead();
			if (stream.closed) break;
			out.push(stream.readUInt8());
		}

		return out;
	}));

	test("stream large buffer", cycle(async stream => {
		const buffer = Buffer.alloc(1024 * 1024);
		buffer[buffer.length - 1] = 1;

		await stream.write(buffer);

		return buffer.length;
	}, async stream => {
		let count = 0;
		while (!stream.closed) {
			await stream.ensureRead();
			if (stream.closed) break;

			const bytes = stream.readAny();
			for (let i = 0; i < bytes.length; i++) {
				count++;
				if (bytes[i] === 1) return count;
			}
		}
	}));

	test("stream write twice slightly larger than block size primed", cycle(async stream => {
		const one = Array(1025).fill(null).map((_, i) => i & 0xFF);

		stream.writeUInt8(0);

		await stream.write(one);
		await stream.write(one);
		return [0, ...one, ...one];
	}, async stream => {
		const out = [];

		while(!stream.closed) {
			await stream.ensureRead();
			if (stream.closed) break;
			out.push(stream.readUInt8());
		}

		return out;
	}));
}));

import {decode as utf8Decode} from './utf8.js';
import {assert} from 'destam/util.js';

let Buffer;

/* node:coverage disable */
if (typeof global !== 'undefined' && global.Buffer){
	Buffer = global.Buffer;
} else {
	let alloc = size => {
		let buffer = new ArrayBuffer(size);

		let out = new Uint8Array(buffer);
		out.dataview = new DataView(buffer);
		return out;
	};

	Buffer = {
		allocUnsafe: alloc,
		alloc,

		from: buffer => {
			buffer = buffer.buffer;

			let out = new Uint8Array(buffer);
			out.dataview = new DataView(buffer);
			return out;
		},

		concat: buffers => {
			let size = 0;

			for (const buffer of buffers){
				size += buffer.length;
			}

			let out = Buffer.allocUnsafe(size);

			size = 0;
			for (const buffer of buffers) {
				out.set(buffer, size);
				size += buffer.length;
			}

			return out;
		}
	};

	Buffer.prototype = {
		readDoubleBE: function(pos) {
			return this.dataview.getFloat64(pos, false);
		},
		readDoubleLE: function(pos) {
			return this.dataview.getFloat64(pos, true);
		},
		readFloatBE: function(pos) {
			return this.dataview.getFloat32(pos, false);
		},
		readFloatLE: function(pos) {
			return this.dataview.getFloat32(pos, true);
		},
		readInt8: function(pos) {
			return this.dataview.getInt8(pos);
		},
		readInt16BE: function(pos) {
			return this.dataview.getInt16(pos, false);
		},
		readInt16LE: function(pos) {
			return this.dataview.getInt16(pos, true);
		},
		readInt32BE: function(pos) {
			return this.dataview.getInt32(pos, false);
		},
		readInt32LE: function(pos) {
			return this.dataview.getInt32(pos, true);
		},
		readUInt8: function(pos) {
			return this.dataview.getUint8(pos);
		},
		readUInt16BE: function(pos) {
			return this.dataview.getUint16(pos, false);
		},
		readUInt16LE: function(pos) {
			return this.dataview.getUint16(pos, true);
		},
		readUInt32BE: function(pos) {
			return this.dataview.getUint32(pos, false);
		},
		readUInt32LE: function(pos) {
			return this.dataview.getUint32(pos, true);
		},
	};
}
/* node:coverage enable */

const UnderflowError = class extends Error {};
const ClosedError = class extends Error {};

class ReadStream {
	constructor (read, bufferSize){
		assert(typeof read === 'function', "read is not a function");

		this.current = 0;
		this.bytes = 0;
		this.readBytes = 0;

		if (ArrayBuffer.isView(bufferSize)) {
			this.buffer = Buffer.from(bufferSize);
			this.bytes = bufferSize.length;
		}else{
			this.buffer = Buffer.allocUnsafe(bufferSize || 1024 * 16);
		}

		this._read = read;

		this.ended = false;
		this.error = null;
	}

	get closed () {
		return this.ended && this.current === this.bytes;
	}

	injestBytes (buffer) {
		if (!buffer.length) {
			return;
		}

		let nsize = this.buffer.length;
		while (nsize - this.bytes + this.current < buffer.length){
			nsize *= 2;
		}

		if (nsize !== this.buffer.length) {
			const buf = Buffer.allocUnsafe(nsize);

			if (this.current !== this.bytes) {
				buf.set(this.buffer.subarray(this.current, this.bytes));
			}

			this.buffer = buf;

			this.bytes -= this.current;
			this.current = 0;
		} else if (this.buffer.length - this.bytes < buffer.length) {
			for (let i = this.current; i < this.bytes; i++){
				this.buffer[i - this.current] = this.buffer[i];
			}

			this.bytes -= this.current;
			this.current = 0;
		}

		this.buffer.set(buffer, this.bytes);
		this.bytes += buffer.length;
	}

	async ensureRead (size = 0) {
		if (this.error) {
			throw new Error("errored stream");
		}

		while (this.remaining < (size || 1)) {
			if (this.ended) {
				if (size === 0) return;
				throw new ClosedError("stream was closed");
			}

			const buffer = await this._read();

			if (buffer.error) {
				this.error = buffer.error;
				throw buffer.error;
			}

			if (buffer.closed) {
				this.ended = true;
			}

			if (buffer.buffer) {
				this.injestBytes(buffer.buffer);
			}
		}
	}

	readAny (maxLength) {
		if (this.bytes === this.current) {
			throw new UnderflowError("stream underflow: reached end of input");
		}

		const len = Math.min(maxLength || Infinity, Math.max(this.bytes - this.current, 0));

		const buffer = this.buffer.subarray(this.current, this.current + len);
		this.current += len;
		this.readBytes += len;
		return buffer;
	}

	readSync (len) {
		if (this.current + len > this.bytes) {
			throw new UnderflowError("stream underflow: reached end of input");
		}

		return this.readAny(len);
	}

	async readAll (max = 0){
		let buffers = [];

		while (this){
			await this.ensureRead(0);
			if (this.closed) break;

			let buffer = this.readAny(max);
			if (max > 0) {
				max -= buffer.length;
				if (max === 0) {
					buffers.push(buffer);
					break;
				}
			}

			buffers.push(new Uint8Array(buffer));
		}

		return Buffer.concat(buffers);
	}

	async readString() {
		let data = [];

		while (true) {
			await this.ensureRead(1);
			let byte = this.readUInt8();
			if (byte === 0) break;
			data.push(byte);
		}

		return utf8Decode(data);
	}

	skip (size) {
		if (this.remaining < size) {
			if (this.ended) {
				throw new UnderflowError("stream underflow: reached end of input");
			} else {
				throw new UnderflowError("stream underflow: trying to skip " + size + ' bytes in a stream with ' + this.remaining + ' bytes remaining');
			}
		}

		this.current += size;
		this.readBytes += size;
	}

	async read (size) {
		await this.ensureRead(size);

		let slice = this.buffer.slice(this.current, this.current + size);
		this.current += size;
		this.readBytes += size;

		return slice;
	}

	get remaining () {
		return this.bytes - this.current;
	}
};

export default ReadStream;

[
	["readDoubleBE", 8],
	["readDoubleLE", 8],
	["readFloatBE", 4],
	["readFloatLE", 4],
	["readInt8", 1],
	["readInt16BE", 2],
	["readInt16LE", 2],
	["readInt32BE", 4],
	["readInt32LE", 4],
	["readUInt8", 1],
	["readUInt16LE", 2],
	["readUInt16BE", 2],
	["readUInt32LE", 4],
	["readUInt32BE", 4]
].forEach (([name, size]) => {
	let func = Buffer.prototype[name];

	ReadStream.prototype[name] = function () {
		if (this.remaining < size) {
			if (this.ended) {
				throw new UnderflowError("stream underflow: reached end of input");
			} else {
				throw new UnderflowError("stream underflow: trying to skip " + size + ' bytes in a stream with ' + this.remaining + ' bytes remaining');
			}
		}

		let val = func.call(this.buffer, this.current);
		this.current += size;
		this.readBytes += size;

		return val;
	};
});

ReadStream.UnderflowError = UnderflowError;
ReadStream.ClosedError = ClosedError;

ReadStream.prototype.readUInt64LE = function () {
	if (this.current + 8 > this.bytes) throw new Error("buffer underflow");

	let num = 0;

	for (let i = 0; i < 8; i++){
		num += this.buffer[this.current++] * Math.pow(2, i * 8);
	}

	this.readBytes += 8;
	return num;
};

ReadStream.prototype.readUInt64BE = function () {
	if (this.current + 8 > this.bytes) throw new Error("buffer underflow");

	let num = 0;

	for (let i = 0; i < 8; i++){
		num *= 256;
		num += this.buffer[this.current++];
	}

	this.readBytes += 8;
	return num;
};

const fromReadableStream = stream => {
	let reader = stream.getReader();

	return () => reader.read().then(({done, value}) => {
		return {closed: done, buffer: value};
	});
};

ReadStream.create = (stream, bufferSize) => {
	if (stream instanceof ReadStream) {
		return stream;
	}

	if (stream instanceof ArrayBuffer){
		stream = new Uint8Array(stream);
	}

	if (Response && stream instanceof Response) {
		stream = stream.body;
		assert(stream, "Response had no body");
	}

	if (typeof stream === 'string') {
		stream = Buffer.from(stream, 'utf-8');
	}

	if (Blob && stream instanceof Blob) {
		stream = fromReadableStream(stream.stream());
	} else if (ReadableStream && stream instanceof ReadableStream) {
		stream = fromReadableStream(stream);
	} else if (Array.isArray(stream)){ //array of buffers
		const buffers = stream;
		let index = 0;

		stream = () => {
			const buffer = buffers[index++];
			return {buffer, closed: buffers.length === index};
		};
	} else if (ArrayBuffer.isView(stream)) {
		return new ReadStream(() => ({closed: true}), stream);
	} else if (stream.pipe && stream.read){
		// use duck typing to see if this is a nodejs stream

		let listener;

		const onClose = () => {
			if (listener) {
				listener({closed: true});
				listener = null;
			} else {
				readstream.ended = true;
			}
		};

		const onError = error => {
			if (listener) {
				listener({error, closed: true});
				listener = null;
			} else {
				readstream.error = error;
			}
		};

		const onReadable = () => {
			if (!listener) return;
			const buffer = stream.read();
			if (!buffer) return;

			listener({buffer});
			listener = null;
		};

		stream.once('close', onClose);
		stream.once('end', onClose);
		stream.once('error', onError);
		stream.on('readable', onReadable);

		const readstream = new ReadStream(() => new Promise(ok => {
			if (stream.errored) {
				ok({ error: stream.errored });
			}

			listener = ok;
			onReadable();
		}), bufferSize);

		return readstream;
	}

	return new ReadStream(stream, bufferSize);
};

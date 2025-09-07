import ReadStream from './read.js';
import { encode as utf8Encode } from './utf8.js';
import { assert } from 'destam/util.js';

const mask32Bits = (1n << 32n) - 1n;

export default class WriteStream {
	constructor(write, bufferSize) {
		this.bufferSize = bufferSize || 1024 * 16;
		this.writeout = write;
		this.pos = 0;
		this.written = 0;
		this.closed = false;
	}

	ensureSpace(size) {
		let has = this.buffer ? this.buffer.length - this.pos : 0;
		if (has < size) {
			let newbuffer;
			if (this.buffer) {
				let newsize = this.buffer.length;
				while (newsize < this.pos + size) {
					newsize *= 2;
				}

				newbuffer = new Uint8Array(newsize);
				newbuffer.set(this.buffer.subarray(0, this.pos));
			} else {
				let newsize = this.bufferSize;
				while (newsize < size) {
					newsize *= 2;
				}

				newbuffer = new Uint8Array(newsize);
			}

			this.dataview = new DataView(newbuffer.buffer);
			this.buffer = newbuffer;
		}

		let old = this.pos;
		this.pos += size;
		this.written += size;
		return old;
	}

	writeString(str) {
		const bytes = utf8Encode(str);
		bytes.push(0);

		let pos = this.ensureSpace(bytes.length);
		for (let i = 0; i < bytes.length; i++) {
			this.buffer[pos++] = bytes[i];
		}
	}

	async flush(done = false) {
		if (this.closed) {
			throw new Error("the write stream is closed");
		}

		if (done) {
			if (this.finished) this.finished();
			this.closed = true;
		}

		if (!this.writeout) {
			return;
		}

		if (this.pos || done) {
			await this.writeout(this.buffer ? this.buffer.subarray(0, this.pos) : new Uint8Array(0), done);
			this.pos = 0;
		}
	}

	async maybeFlush() {
		if (this.buffer && this.pos > this.buffer.length * 0.80) {
			await this.flush();
		}
	}

	async write(buffer) {
		if (Array.isArray(buffer)) {
			buffer = new Uint8Array(buffer);
		}

		if (buffer instanceof Blob) {
			await this.flush();
			await this.writeout(buffer, false);
		} else if (!this.writeout) {
			let pos = this.ensureSpace(buffer.length);
			this.buffer.set(buffer, pos);
		} else if (!this.buffer) {
			await this.writeout(buffer, false);
		} else {
			let has = this.buffer.length - this.pos;
			if (has >= buffer.length) {
				this.buffer.set(buffer, this.pos);
				this.pos += buffer.length;
			} else {
				await this.flush();
				await this.writeout(buffer, false);
			}
		}

		this.written += buffer.length;
	}

	toUint8Array() {
		assert(!this.writeout,
			"this is only supported with a writestream that doesn't reference a stream");
		return this.buffer ? new Uint8Array(this.buffer.buffer, 0, this.pos) : new Uint8Array(0);
	}

	writeDoubleBE(value) {
		const pos = this.ensureSpace(8);
		this.dataview.setFloat64(pos, value, false);
	}
	writeDoubleLE(value) {
		const pos = this.ensureSpace(8);
		this.dataview.setFloat64(pos, value, true);
	}
	writeFloatBE(value) {
		const pos = this.ensureSpace(4);
		this.dataview.setFloat32(pos, value, false);
	}
	writeFloatLE(value) {
		const pos = this.ensureSpace(4);
		this.dataview.setFloat32(pos, value, true);
	}
	writeInt8(value) {
		const pos = this.ensureSpace(1);
		this.dataview.setInt8(pos, value);
	}
	writeInt16BE(value) {
		const pos = this.ensureSpace(2);
		this.dataview.setInt16(pos, value, false);
	}
	writeInt16LE(value) {
		const pos = this.ensureSpace(2);
		this.dataview.setInt16(pos, value, true);
	}
	writeInt32BE(value) {
		const pos = this.ensureSpace(4);
		this.dataview.setInt32(pos, value, false);
	}
	writeInt32LE(value) {
		const pos = this.ensureSpace(4);
		this.dataview.setInt32(pos, value, true);
	}
	writeUInt8(value) {
		const pos = this.ensureSpace(1);
		this.dataview.setUint8(pos, value);
	}
	writeUInt16BE(value) {
		const pos = this.ensureSpace(2);
		this.dataview.setUint16(pos, value, false);
	}
	writeUInt16LE(value) {
		const pos = this.ensureSpace(2);
		this.dataview.setUint16(pos, value, true);
	}
	writeUInt32BE(value) {
		const pos = this.ensureSpace(4);
		this.dataview.setUint32(pos, value, false);
	}
	writeUInt32LE(value) {
		const pos = this.ensureSpace(4);
		this.dataview.setUint32(pos, value, true);
	}
	writeUInt64BE(value) {
		const pos = this.ensureSpace(8);
		this.dataview.setUint32(pos, Number((value >> 32n) & mask32Bits), false);
		this.dataview.setUint32(pos + 4, Number(value & mask32Bits), false);
	}
	writeUInt64LE(value) {
		const pos = this.ensureSpace(8);
		this.dataview.setUint32(pos, Number(value & mask32Bits), true);
		this.dataview.setUint32(pos + 4, Number((value >> 32n) & mask32Bits), true);
	}

	static create(stream, endonEnded) {
		if (stream instanceof WriteStream) {
			return stream;
		}

		if (typeof stream === 'function') {
			return new WriteStream(stream);
		}

		const close = () => {
			ws.closed = true;
		};

		const ws = new WriteStream((bytes, ended) => new Promise((ok, err) => {
			if (bytes.length === 0 && ended) {
				ws.closed = true;
				stream.removeListener('finish', close);
				if (endonEnded) stream.end();
			}

			stream.write(bytes, error => {
				if (error) {
					ws.closed = true;
					err(error);
				} else {
					ok();
				}
			});
		}));

		stream.on('finish', close);

		return ws;
	}

	static createPassthrough(bufferSize) {
		let buffer;
		let latch;

		const readStream = ReadStream.create(() => new Promise(ok => {
			const resolve = () => {
				ok(buffer);
				buffer = null;

				const unlatch = latch;
				latch = null;
				if (unlatch) {
					unlatch();
				}
			};

			if (buffer) {
				resolve();
			} else {
				assert(!latch);
				latch = resolve;
			}
		}));

		return [readStream, new WriteStream((buffer_, closed) => new Promise(ok => {
			assert(!buffer, "createPassthrough: Buffer already written");
			buffer = { buffer: buffer_, closed };

			const unlatch = latch;
			latch = ok;
			if (unlatch) {
				unlatch();
			}
		}), bufferSize)];
	}

	static createBlob(callback) {
		let chunks = [];

		return new WriteStream(async (bytes, flushed) => {
			if (bytes instanceof Blob) {
				chunks.push(bytes);
			} else {
				chunks.push(new Uint8Array(bytes));
			}

			if (flushed) {
				await callback(new Blob(chunks, { type: 'application/octet-stream' }));
			}
		});
	}
};

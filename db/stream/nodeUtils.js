import {Readable, Writable} from 'stream';

export const readStreamToNode = (readStream) => {
	let stream = new Readable();
	stream._read = size => {
		readStream.ensureRead(0).then(() => {
			if (readStream.closed) {
				stream.push(null);
				return;
			}

			// TODO: Don't copy. If we don't copy the data, then s3 upload
			// will be broken but nothing else. Nodejs lifetime rules for
			// buffers is extremely unclear.
			stream.push(new Uint8Array(readStream.readAny()));

			if (readStream.closed) {
				stream.push(null);
			}
		});
	};

	return stream;
};

export const writeStreamToNode = (writeStream) =>  {
	const stream = new Writable();
	stream._write = (chunk, encoding, done) => {
		writeStream.write(chunk).then(done).catch(done);
	};
	stream._final = done => {
		writeStream.flush(true).then(done).catch(done);
	};
	return stream;
};

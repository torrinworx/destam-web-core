import {register} from './Message.js';
import UUID from 'destam/UUID.js';

register(UUID, {
	selector: uuid => {
		const len = uuid.buffer.byteLength;
		if (len === 8) {
			return 'uuid2';
		} else if (len === 16) {
			return 'uuid4';
		} else if (len === 32) {
			return 'uuid8';
		} else {
			throw new Error('Unusual uuid byte size');
		}
	},
	entries: [{
		name: 'uuid2',
		copy: uuid => uuid,
		size: 8,
		read: stream => {
			return UUID(stream.readSync(8));
		},
		write: (value, stream) => {
			return stream.write(new Uint8Array(value.buffer.buffer));
		},
	}, {
		name: 'uuid4',
		copy: uuid => uuid,
		size: 16,
		read: stream => {
			return UUID(stream.readSync(16));
		},
		write: (value, stream) => {
			return stream.write(new Uint8Array(value.buffer.buffer));
		},
	}, {
		name: 'uuid8',
		copy: uuid => uuid,
		size: 32,
		read: stream => {
			return UUID(stream.readSync(32));
		},
		write: (value, stream) => {
			return stream.write(new Uint8Array(value.buffer.buffer));
		},
	}]
});

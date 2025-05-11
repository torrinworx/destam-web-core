import {register, writeUnsigned} from './Message.js';

register([Blob, File], {
	name: 'blob',
	// reading is not supported on the frontend
	write: async (blob, stream) => {
		await stream.writeString('.');
		writeUnsigned(stream, blob.size);
		await stream.write(blob);
	}
});

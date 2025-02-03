// OFile.js
import fs from 'fs';
import crypto from 'crypto';
import * as Network from 'destam/Network.js';
import { isEqual, push, remove, assert, createClass, createInstance } from 'destam/util.js';
import { Modify, Delete } from 'destam/Events.js';

const OFile = createClass((filePath, id) => {
	assert(typeof filePath === 'string', 'FilePath must be a string');

	const reg = Network.createReg(OFile, id);

	const computeHash = (content) =>
		crypto.createHash('sha256').update(content).digest('hex');

	let fileContent = fs.existsSync(filePath)
		? fs.readFileSync(filePath, 'utf-8')
		: null;
	let oldHash = fileContent ? computeHash(fileContent) : null;
	let prevSize = fileContent ? Buffer.byteLength(fileContent, 'utf-8') : 0;

	const listeners = [];
	const invokeListeners = (delta) => {
		for (const listener of listeners) listener(delta);
	};

	const checkAndUpdate = () => {
		if (!fs.existsSync(filePath)) {
			const delta = Delete(
				{ hash: oldHash, size: prevSize },
				undefined,
				filePath,
				id
			);
			oldHash = null;
			prevSize = 0;
			fileContent = null;
			invokeListeners(delta);
			return;
		}

		const content = fs.readFileSync(filePath, 'utf-8');
		const newHash = computeHash(content);

		if (!isEqual(oldHash, newHash)) {
			const newSize = Buffer.byteLength(content, 'utf-8');

			const delta = Modify(
				{ hash: oldHash, size: prevSize },
				{ hash: newHash, size: newSize },
				filePath,
				id
			);

			oldHash = newHash;
			prevSize = newSize;
			fileContent = content;

			invokeListeners(delta);
		}
	};

	// Pass { persistent: false } so the watcher does not keep Node's event loop active.
	fs.watch(filePath, { persistent: false }, (eventType) => {
		if (eventType === 'change') {
			checkAndUpdate();
		}
	});

	return createInstance(OFile, {
		get: {
			value: () => fileContent,
		},
		set: {
			value: (newContent) => {
				fs.writeFileSync(filePath, newContent, 'utf-8');
				checkAndUpdate();
			},
		},
		watch: {
			value: (callback) => {
				push(listeners, callback);
				return () => remove(listeners, callback);
			},
		},
	});
});

export default OFile;
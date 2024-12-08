import fs from 'fs';
import path from 'path';
import * as Network from 'destam/Network.js';
import { Insert, Modify, Delete } from 'destam/Events.js';
import { createClass, createInstance, push, remove, assert } from 'destam/util.js';

const getDirectoryState = (dirPath) => {
	if (!fs.existsSync(dirPath)) return {};

	const files = fs.readdirSync(dirPath);
	return files.reduce((acc, file) => {
		const fullPath = path.join(dirPath, file);
		try {
			if (fs.statSync(fullPath).isFile()) {
				const { mtimeMs, size } = fs.statSync(fullPath);
				acc[file] = { mtimeMs, size };
			}
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
		}
		return acc;
	}, {});
};

const ODir = createClass((dirPath, id) => {
	assert(typeof dirPath === 'string', 'Directory path must be a string');

	const reg = Network.createReg(ODir, id);

	let currentState = getDirectoryState(dirPath);

	const listeners = [];
	const invokeListeners = (delta) => {
		for (const listener of listeners) listener(delta);
	};

	const updateDirectoryState = () => {
		const newState = getDirectoryState(dirPath);

		Object.keys(newState).forEach(file => {
			if (!currentState[file]) {
				const delta = Insert(undefined, { file, ...newState[file] }, file, id);
				invokeListeners(delta);
			} else if (newState[file].mtimeMs !== currentState[file].mtimeMs || newState[file].size !== currentState[file].size) {
				const delta = Modify(currentState[file], newState[file], file, id);
				invokeListeners(delta);
			}
		});

		Object.keys(currentState).forEach(file => {
			if (!newState[file]) {
				const delta = Delete(currentState[file], undefined, file, id);
				invokeListeners(delta);
			}
		});

		currentState = newState;
	};

	const addFile = (fileName, content = '') => {
		const fullPath = path.join(dirPath, fileName);
		fs.writeFileSync(fullPath, content, 'utf8');
		updateDirectoryState();
	};

	const removeLastFile = () => {
		const files = Object.keys(currentState);
		const fileName = files[files.length - 1];
		if (fileName) {
			const fullPath = path.join(dirPath, fileName);
			if (fs.existsSync(fullPath)) {
				fs.unlinkSync(fullPath);
				updateDirectoryState();
				return fileName;
			}
		}
		return undefined;
	};

	const spliceFiles = (start, deleteCount, ...newFiles) => {
		const files = Object.keys(currentState);
		const toRemove = files.slice(start, start + deleteCount);

		toRemove.forEach(fileName => {
			const fullPath = path.join(dirPath, fileName);
			if (fs.existsSync(fullPath)) {
				fs.unlinkSync(fullPath);
				updateDirectoryState();
			}
		});

		newFiles.forEach(({ fileName, content }) => {
			if (fileName) {
				const fullPath = path.join(dirPath, fileName);
				fs.writeFileSync(fullPath, content, 'utf8');
			}
		});

		updateDirectoryState();
	};

	fs.watch(dirPath, { persistent: false }, updateDirectoryState);

	return createInstance(ODir, {
		observer: {
			get: () => reg
		},
		getFiles: {
			value: () => Object.keys(currentState || {})
		},
		addFile: {
			value: addFile
		},
		pop: {
			value: removeLastFile
		},
		splice: {
			value: spliceFiles
		},
		watch: {
			value: (callback) => {
				push(listeners, callback);
				return () => remove(listeners, callback);
			}
		}
	});
}, {
	stopWatching: function() {
		for (let listener of listeners) {
			listener();
		}
		listeners.length = 0;
	}
});

export default ODir;

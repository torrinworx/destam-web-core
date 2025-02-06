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

/**
 * One comment: Observables are not supposed to implement a watch function. Instead, they're supposed to call into the network with Network.linkApply
 * The network is the thing that implements the fine grained listeners that we have
 * so .path .ignore .skip ... etc
 * But I don't know if the ideas are really all that compatible: Observables are synchronious while the fs is asynchronious. That's why you have to put the 'sync' versions everywhere
 * - Alex
 * 
 * 	
alex
5:37 PM
One comment: Observables are not supposed to implement a watch function. Instead, they're supposed to call into the network with Network.linkApply

The network is the thing that implements the fine grained listeners that we have

so .path .ignore .skip ... etc


torrin
5:38 PM
Oooooh I see


alex
5:38 PM
Not a bad idea

But I don't want to implement nodejs specific stuff in destam because that's supposed to be backend/frontend

As a seperate library maybe 'destam-fs' would work


torrin
5:40 PM
Ah right right, makes sense, well thanks! I came up with it because I wanted to watch a dir with images for my personal site 


alex
5:40 PM
But I don't know if the ideas are really all that compatible: Observables are synchronious while the fs is asynchronious. That's why you have to put the 'sync' versions everywhere

Plus it won't work if you try to send a ODir or OFile over the network to the frontend or something

I would suggest an alternate approach that doesn't require building a new observable:


torrin
5:44 PM
Oh I see, so maybe just a really fancy OArray?


alex
5:46 PM
Build a state tree but modify it from the outside:

const createObservableFromFS = (fsFile) => {
const files = OObject();

for (const file in fsFile.getFiles()) {
if (file.isDirectory()){
   files[file.name] = createObservableFromFS(file);
} else {
   files[file.name] = {name: file.name, contents: ...};
}
}

fsFile.watch(() => {
 // update the files oobject
});
}

torrin
5:48 PM
Ah ok and fsFile is the existing ODir .getFiles() method using fs? 


alex
5:49 PM
Yeah, it's pseudo code


torrin
5:49 PM
oh right right mb

5:49 PM







ok cool that makes sense
 */

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

/*
initialized the queue, worker pool, returns a queue list that can be
appended to/watched for progress updates on each item.

Each item in the queue might look like:
{
	id: 'someID',
	module: 'module name/route',
	props: { ... },
	status: 'pending' | 'working' | 'complete' | 'error',
	result: null | any,
	error: null | Error
}

Array of available workers mapped to numWorkers, workers get removed when
taking an item from the queue. items from the queue status changes from "pending" to "working"
when a worker picks it up.
once a worker completes the item, status on the item in the queue is changed from working to
complete queu items will either have '.result' (when completed), or '.error', if not completed
due to an error.
once a worker is done an item from the queue either result or error, it adds itself back to the
workerpool and the workerPool watcher assigns another queue item to it with status: 'pending'

why not just load all the modules from within the workers so that the workers each have a copy
of each of the modules with intQ and onMsgQ

TODO: Assign some logic on what to do with stale workers/workers that take a long time to complete?
maybe have a .env timeout setting to prevent workers from being completely consumed in edge case 
loops/errors that lock up the worker.

TODO: Store queue using odb or something so that we can recover queued items that are pending?
*/
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import { Worker } from 'worker_threads';

import { OArray, OObject } from 'destam';

export const queue = OArray([
	{
		id: 'someId',
		module: 'q',
		props: {
			test: 'test'
		},
		status: 'pending',
		result: null,
		error: null,
		created: new Date()
	}
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const requestQ = async ({ id, module, props }) => {
	const item = OObject({
		id: id ? id : uuidv4(),
		module,
		props,
		status: 'pending',
		result: null,
		error: null,
		created: new Date(),
	})

	queue.push(item); // add item to queue

	return new Promise((resolve, reject) => {
		item.observer.watch(() => {
			if (item.status === 'complete') {

				// if result remove item from queue
				const index = queue.findIndex(item => item.id === item.id);
				if (index !== -1) {
					queue.splice(index, 1);
				}

				resolve(item.result);
			}
			if (item.status === 'error') {
				console.error(
					`Error with queued request to module '${item.module}':\n`,
					item.error
				);
				reject(item.error);
			}
		})
	})
};

const spawnWorker = (modulesDir) => {
	const w = new Worker(path.resolve(__dirname, './worker.js'));
  
	w.isAvailable = true;
  
	w.on('message', (msg) => {
	  const { id, result, error } = msg;
	  const item = queue.find(qItem => qItem.id === id);
	  if (!item) return;
  
	  if (error) {
		item.error = error;
		item.status = 'error';
	  } else {
		item.result = result;
		item.status = 'complete';
	  }
  
	  w.isAvailable = true;
	  assignWorkToAvailableWorker(modulesDir);
	});
  
	// Listen for errors originating from the Worker itself
	w.on('error', (err) => {
	  console.error(`[Worker ${w.threadId} error]`, err);
	  // Potentially mark worker as unavailable and spawn a new one if needed
	  w.isAvailable = false;
	});
  
	// Listen for exit
	w.on('exit', (code) => {
	  console.log(`[Worker ${w.threadId} exit] code: ${code}`);
	  // Remove worker from the workerPool if it exits
	  const index = workerPool.indexOf(w);
	  if (index > -1) {
		workerPool.splice(index, 1);
	  }
	  if (code !== 0) {
		console.error(`[Worker ${w.threadId}] crashed. Respawning...`);
		// Potentially respawn a new worker if needed:
		const newWorker = spawnWorker(modulesDir);
		workerPool.push(newWorker);
	  }
	});
  
	return w;
  }

const initQ = ({ modulesDir }) => {
	const numWorkers = process.env.NUM_WORKERS ? process.env.NUM_WORKERS : 4;
	// setup initial pool.
	Array.from({ length: numWorkers }).map(() => {
		const w = new Worker(path.resolve(__dirname, './worker.js'));

		w.isAvailable = true;
	  
		w.on('message', (msg) => {
		  const { id, result, error } = msg;
		  const item = queue.find(qItem => qItem.id === id);
		  if (!item) return;
	  
		  if (error) {
			item.error = error;
			item.status = 'error';
		  } else {
			item.result = result;
			item.status = 'complete';
		  }
	  
		  w.isAvailable = true;
		});
	  
		w.on('error', (err) => {
		  console.error(`[Worker ${w.threadId} error]`, err);
		  // TODO: stop process worker was working on and assign new module? Or kill it if needed and spin up a
		  // new worker? Not sure.
		});
	  
		w.on('exit', (code) => {
		  console.log(`[Worker ${w.threadId} exit] code: ${code}`);
		  // Remove worker from the workerPool if it exits
		  const index = workerPool.indexOf(w);
		  if (index > -1) {
			workerPool.splice(index, 1);
		  }
		  if (code !== 0) {
			console.error(`[Worker ${w.threadId}] crashed. Respawning...`);
			// Potentially respawn a new worker if needed:
			const newWorker = spawnWorker(modulesDir);
			workerPool.push(newWorker);
		  }
		});

		return w;
	});

	// Triggers once on startup and once every time the queue changes:
	queue.observer.effect(value => {
		console.log(value);
		const pendingItems = queue.filter(i => i.status === 'pending');

		if (pendingItems.length > 0) { // if pending items in queue, assign workers until no workers from workerPool left.

			// TODO: Clean this up, something like this
			const item = pendingItems[0];
			item.status = 'working';

			console.log(item);

			/*

			// TODO: how to assign workers correctly?
			w.postMessage({
				id: item.id,
				modulesDir: modulesDir,
				module: item.module,
				props: item.props,
			});

			remove worker from worker pool here

			Once a worker is finished, should it add itself back to the worker pool? is that possible?
			*/

		}
	});
};

export default initQ;

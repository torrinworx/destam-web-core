/*
initialized the queue, worker pool, returns a queue list that can be
appended to/watched for progress updates on each item.


  Each item in the queue might look like:
  {
	id: 'someID',
	module: 'string name of module',
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
*/
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { OArray } from 'destam';

export const queue = OArray([]);


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const initQ = ({ modules }) => {
	const numWorkers = process.env.NUM_WORKERS ? process.env.NUM_WORKERS : 4;
	// setup initial pool.
	const workerPool = OArray([
		...Array.from({ length: numWorkers }).map(() => new Worker(path.resolve(__dirname, './worker.js')))
	]);

	workerPool.observer.effect(() => {
		// list of current pending items to be ran, pending means that a worker
		// has never toched this item before.
		const pending = queue.filter(i => i.status === 'pending');
		if (pending.length > 0 && workerPool.length > 0) {

			const workerToCall = workerPool.pop(); // grab first worker
			const itemToProgress = pending[0]; // grab first item

			const module = modules[itemToProgress.module];

			let func;
			if (module.onMsgQ) func = module.onMsgQ;
			if (module.intQ) func = module.intQ;
			else {
				console.error('Requested to queue a module not compatible with queue system.');
				return;
			}

			workerToCall({
				module: module.toString(),
				props: itemToProgress.props,
			})

			worker.on('result', () => {

			})

		}
	})

	// TODO: init separate process to manage and start workers to process module requests
	// in the queue. queue will be returned so that the queue OArray can be watched for updates
	// and progress if needed. Need to define a stnadard for how items in the queue are updated
	// status wise, assuming they are removed from the queue once they have been completed.


	// TODO: Assign some logic on what to do with stale workers/workers that take a long time to complete?
	// maybe have a .env timeout setting to prevent workers from being completely consumed in edge case 
	// loops/errors that lock up the worker.

	return queue;
};

export default initQ;


/*
  const workerPool = OArray([]);

  // Initialize the workers
  for (let i = 0; i < numWorkers; i++) {
    const w = new Worker(workerUrl);
    // When the worker finishes processing a queue item, it responds here:
    w.on('message', (msg) => {
      const { itemId, result, error } = msg;

      // 1) Update the corresponding item in the queue
      const item = queue.find((qItem) => qItem.id === itemId);
      if (item) {
        if (error) {
          item.error = error;
          item.status = 'error';
        } else {
          item.result = result;
          item.status = 'complete';
        }
      }

      // 2) Return the worker to the pool
      workerPool.push(w);
    });

    // If there's an error in the worker, mark that worker dead or handle it:
    w.on('error', (e) => {
      console.error('Worker error:', e);
      // Optionally spawn a replacement worker here, depending on your strategy
    });

    // If the worker exits unexpectedly, you might want to replace it:
    w.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker stopped with exit code ${code}`);
        // Optionally create a new worker to keep the pool at a consistent size
      }
    });

    // Put this new worker into the pool
    workerPool.push(w);
  }

  // Use the OArray observer to watch for changes.
  // Whenever there is a “pending” item AND an available worker,
  // assign that worker to the item.
  workerPool.observer.effect(() => {
    // If any queue item is pending and there's at least one idle worker,
    // pick one and send a message to run the item’s “moduleString”.
    const pendingItem = queue.find((i) => i.status === 'pending');
    if (pendingItem && workerPool.length > 0) {
      // Remove a worker from the pool
      const w = workerPool.shift();
      pendingItem.status = 'working';

      // Send data to the Worker. 
      // (Here we pass moduleString, props, and an itemId to identify it.)
      w.postMessage({
        itemId: pendingItem.id,
        moduleString: pendingItem.moduleString,
        props: pendingItem.props,
      });
    }
  });
*/

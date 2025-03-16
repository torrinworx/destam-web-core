import { parentPort } from 'worker_threads';

import Modules from './modules.js';

// const modules = await Modules(modulesDir);

parentPort.on('message', async ({ id, modulesDir, module, props }) => {
    let result = null;
    let error = null;

    console.log(modulesDir)

    parentPort.postMessage({ id, result, error });
});

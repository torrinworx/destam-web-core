import { parentPort } from 'worker_threads';

parentPort.on('message', async (item) => {
    let result = null;
    let error = null;

    try {
        const func = eval(`(${item.onMsgQ})`);
        result = await func(item.props);
    } catch (err) {
        error = err.toString();
    }

    parentPort.postMessage({ id: item.id, result, error });
});

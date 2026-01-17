import { OObject, createNetwork } from 'destam';
import { parse, stringify } from '../common/clone.js';

/**
 * Sets up a synced observer with the client and db. Synchronizes changes from
 * the client/server and updates through WebSocket connection.
 * @param {Object} authenticated - An object that tracks user authentication status.
 * @param {WebSocket} ws - The WebSocket connection instance.
 * @param {OObject} [sync=OObject({})] - An observable object to sync.
 * @returns {OObject} - The synced observable object.
 */
const sync = (onMsg, ws, sync = OObject({})) => {
	let network = createNetwork(sync.observer);
	const fromClient = {};
	// Don't know why this one is here:
	ws.send(JSON.stringify({ name: 'sync', result: stringify(sync) }));

	network.digest(async (changes, observerRefs) => {
		const serverChanges = stringify(
			changes, { observerRefs: observerRefs, observerNetwork: network }
		);
		ws.send(JSON.stringify({ name: 'sync', result: serverChanges }));
	}, 1000 / 30, (arg) => arg === fromClient);

	ws.on('message', async (msg) => {
		msg = parse(msg);

		if (!(await onMsg()) || msg.name !== 'sync') return;

		const clientChanges = msg.clientChanges ?? msg?.props?.clientChanges;

		if (!clientChanges) {
			ws.send(JSON.stringify({ name: 'sync', result: stringify(sync) }));
			return;
		}

		network.apply(parse(clientChanges), fromClient);
	});

	ws.on('close', () => {
		network.remove();
	});

	return sync;
};

export default sync


import database from 'destam-db';
import { v4 as uuidv4 } from 'uuid';
import indexeddb from 'destam-db/driver/indexeddb.js';
import { OObject, createNetwork } from 'destam';

import { parse, stringify } from '../common/clone';
import { webcoreToken, setWebcoreToken, clearWebcoreToken } from './cookies';

/*
Handles destam network setup and variable syncrhonization.
*/
export const sync = async (state) => {
	let network;
	const fromServer = {};

	ws.addEventListener('message', msg => {
		msg = parse(msg.data);
		// look for sync here because other data is returned from the server for modReq:
		if (msg.name === 'sync' && msg?.error === undefined) {
			const serverChanges = parse(msg.result);
			if (!state.sync) {
				if (!Array.isArray(serverChanges)) {
					state.sync = serverChanges;
					network = createNetwork(state.sync.observer);

					network.digest(async (changes, observerRefs) => {
						const clientChanges = stringify(
							changes,
							{ observerRefs: observerRefs, observerNetwork: network }
						);
						await modReq('sync', { clientChanges: clientChanges })
					}, 1000 / 30, arg => arg === fromServer);

					window.addEventListener('unload', () => {
						if (ws) ws.close();
						if (network) network.remove();
					});
				} else {
					console.error('First message should establish sync, received an array instead.');
				}
			} else {
				if (Array.isArray(serverChanges)) {
					network.apply(serverChanges, fromServer);
				}
			}
		}
	});

	ws.addEventListener('close', () => {
		if (network) network.remove();
	});

	ws.addEventListener('error', (error) => {
		console.error('WebSocket error:', error.message);
	});
};

export default sync;

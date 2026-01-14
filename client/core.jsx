/*
Since most of the logic for routing has been moved to destamatic-ui Stage system, this file's objectives are now:

- Authentication, return an observer state that dictates if the user is authenticated or not. We then let users wire up what pages that means they should access, we can
	build out a helper in stage itself that can allow users to auto route to a fallback page if a check function returns false.
- Cookies, related to authentication above.
- general setup of state sync with the backend via websockets.
- basic client functions, enter, check, leave, etc.

No more giant bulky frontend module system.
*/

import database from 'destam-db';
import { v4 as uuidv4 } from 'uuid';
import indexeddb from 'destam-db/driver/indexeddb.js';
import { OObject, createNetwork } from 'destam';

import { parse, stringify } from '../common/clone';
import { webcoreToken, setWebcoreToken, clearWebcoreToken } from './cookies';

let ws;
export const initWS = () => {
	const token = webcoreToken.get() || '';
	const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
	const wsURL = token
		? `${protocol}${window.location.hostname}:${window.location.port}/?token=${encodeURIComponent(token)}`
		: `${protocol}${window.location.hostname}:${window.location.port}`;
	ws = new WebSocket(wsURL);
	return new Promise((resolve, reject) => {
		ws.addEventListener('open', () => resolve(ws));
		ws.addEventListener('error', (err) => reject(err));
		ws.addEventListener('close', () => { });
	});
};

/*
Designed as a way to request running a module on the backend from frontend ui.
*/
export const modReq = (name, props) => new Promise(async (resolve, reject) => {
	const msgID = uuidv4(); // Use destam UUID instead for lighter weight library deps.

	const handleMessage = (event) => {
		const response = JSON.parse(event.data);
		if (response.id === msgID) {
			ws.removeEventListener('message', handleMessage);

			if (response.error) {
				console.error(response.error);
			} else {
				resolve(response.result);
			}
		}
	};

	ws.addEventListener('message', handleMessage);

	try {
		ws.send(JSON.stringify({
			name: name,
			token: webcoreToken.get() || '',
			id: msgID,
			props: props ? props : null,
		}));
	} catch (error) {
		reject(new Error('Issue with server module request: ', error));
		console.log(error)
	}

	// TODO: Cleanup event listeners?
});

/*
Handles destam network setup and variable syncrhonization.
*/
export const syncNetwork = async (state) => {
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

/*
Main export. Sets up server link, indexeddb, synced state with server, and cookies/authentication and other state functions.
*/

export const clientState = async () => {
	const driver = indexeddb('webcore');
	const DB = database(driver);
	return await DB.reuse('client', { state: 'client' });
};

export const syncState = async () => {
	await initWS();

	const state = OObject({
		sync: null
	});

	await syncNetwork(state);

	const token = webcoreToken.get() || '';

	if (token) {
		const sync_res = await modReq('sync');
		if (sync_res?.error === 'Invalid session token.') clearWebcoreToken();
	};

	state.enter = async (email, password) => {
		const response = await modReq('enter', {
			email: email.get(),
			password: password.get(),
		});
		if (response.token) {
			setWebcoreToken(response.token);
		}
		return response;
	};

	state.check = async (email) => await modReq(
		'check',
		{ email: email.get() }
	);

	state.leave = () => {
		clearWebcoreToken();
		state.sync = null;
	};

	state.modReq = modReq;

	return state;
};

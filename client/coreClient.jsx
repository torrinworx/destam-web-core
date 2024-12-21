/*
TODO: This could be strucutred a bit neater imo to allow for more flexibilitiy when it comes to the sync stuff maybe?
*/

import { mount } from 'destam-dom';
import { v4 as uuidv4 } from 'uuid';
import { OObject, createNetwork } from 'destam';

import { parse, stringify } from '../common/clone.js';
import { initODB, ODB } from '../common/index.js';

export const getCookie = (name) => {
	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) return parts.pop().split(';').shift();
};

let ws;

export const initWS = () => {
	const tokenValue = getCookie('webCore') || '';
	const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
	const wsURL = tokenValue
		? `${protocol}${window.location.hostname}:${window.location.port}/?sessionToken=${encodeURIComponent(tokenValue)}`
		: `${protocol}${window.location.hostname}:${window.location.port}`;
	ws = new WebSocket(wsURL);
	return new Promise((resolve, reject) => {
		ws.addEventListener('open', () => resolve(ws));
		ws.addEventListener('error', (err) => reject(err));
		ws.addEventListener('close', () => console.warn('WebSocket closed unexpectedly.'));
	});
};

export const jobRequest = (name, params) => {
	return new Promise(async (resolve, reject) => {
		const msgID = uuidv4();

		const handleMessage = (event) => {
			try {
				const response = JSON.parse(event.data);
				if (response.id === msgID) {
					ws.removeEventListener('message', handleMessage);
					resolve(response);
				}
			} catch (error) {
				console.error('Failed to parse incoming message:', error);
			}
		};

		const sendMessage = () => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({
					name: name,
					sessionToken: getCookie('webCore') || '',
					id: msgID,
					...params
				}));
			} else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
				ws.removeEventListener('message', handleMessage);
				ws = initWS()
					.then(() => sendMessage())
					.catch(err => reject(new Error('WebSocket could not be re-opened: ' + err.message)));
			} else {
				reject(new Error('WebSocket is not open. Ready state is: ' + ws.readyState));
			}
		};

		ws.addEventListener('message', handleMessage);
		sendMessage();
	});
};

export const syncNetwork = async () => {
	let remove;
	let network;
	const fromServer = {};

	// TODO: move client state creation to core() function instead.
	// Client is an ODB driver running indexeddb so that changes to client state
	// are maintained accross page reloads with a similar permanence to cookies.
	let client = await ODB('indexeddb', 'client', { state: 'client' });
	if (!client) {
		client = await ODB('indexeddb', 'client', {}, OObject({ state: 'client' }))
	}

	// State is split in two: state.sync and state.client, this prevents
	// client only updates from needlessly updating the database.
	const state = OObject({
		client: client,
		sync: null
	});
	window.state = state;

	ws.addEventListener('message', (msg) => {
		msg = parse(msg.data);

		// look for sync here because other data is returned from the server for jobRequest:
		if (msg.name === 'sync') {
			const serverChanges = parse(msg.result);
			if (!state.sync) {
				if (!Array.isArray(serverChanges)) {
					state.sync = serverChanges; // Clone of OServer
					network = createNetwork(state.sync.observer);

					network.digest(async (changes, observerRefs) => {
						const clientChanges = stringify(
							changes,
							{ observerRefs: observerRefs, observerNetwork: network }
						);
						jobRequest('sync', { clientChanges: clientChanges })
					}, 1000 / 30, arg => arg === fromServer);

					window.addEventListener('unload', () => {
						if (remove) remove();
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
		console.log('WebSocket connection closed.');
	});

	ws.addEventListener('error', (error) => {
		console.error('WebSocket error:', error.message);
	});

	return state
};

export const coreClient = async (App, NotFound) => {
	await initWS();
	await initODB();
	const state = await syncNetwork();

	const token = getCookie('webCore') || '';
	if (token) {
		(async () => await jobRequest('sync'))();
		state.client.openPage = { page: 'Auth' }
	} else {
		state.client.openPage = { page: 'Landing'}
	};

	state.login = async ({ email, password }) => {
		const response = await jobRequest('login', { email: email.get(), password: password.get() });

		if (response.result.status === 'success') {
			const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
			const sessionToken = response.result.sessionToken;
			document.cookie = `webCore=${sessionToken}; expires=${expires}; path=/; SameSite=Lax`;

			// TODO For some reason it gets stuck here and doesn't load the home page/state.sync:
			console.log('Login, initializing sync...')
			const response2 = await jobRequest('sync'); // Issue occurs here
			console.log(response2)
		}

		return response;
	}

	state.signup = async ({ email, password }) => await jobRequest(
		'signup',
		{ email: email.get(), password: password.get() }
	);

	mount(document.body, window.location.pathname === '/' ? <App state={state} /> : <NotFound />);
};

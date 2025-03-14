import { mount } from 'destam-dom';
import { v4 as uuidv4 } from 'uuid';
import { ODB, initODB } from 'destam-db-core';
import { Observer, OObject, createNetwork } from 'destam';

import { parse, stringify } from '../common/clone.js';

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
		ws.addEventListener('close', () => { });
	});
};

export const jobRequest = (name, params) => {
	return new Promise(async (resolve, reject) => {
		const msgID = uuidv4();

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
	let network;
	const fromServer = {};

	// TODO: move client state creation to core() function instead.
	// Client is an ODB driver running indexeddb so that changes to client state
	// are maintained accross page reloads with a similar permanence to cookies.
	let client = await ODB({
		driver: 'indexeddb',
		collection: 'client',
		query: { state: 'client' }
	});

	if (!client) {
		client = await ODB({
			driver: 'indexeddb',
			collection: 'client',
			value: OObject({ state: 'client' })
		})
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

	return state
};

export const coreClient = async ({ App, Fallback, pages, defaultPage = 'Landing' }) => {
	if (!App) throw new Error('App component is required.');
	if (!Fallback) throw new Error('Fallback component is required.');

	await initWS();
	await initODB();

	const state = await syncNetwork();
	const openPage = state.client.observer.path('openPage');

	const getRoute = () => {
		let path = window.location.pathname;
		if (path.startsWith('/')) path = path.slice(1);
		if (!path) path = defaultPage;
		return path;
	}

	const route = getRoute();
	if (!pages[route]) {
		// If pages don't have this route, default to fallback

		// TODO: Issue here with fallback.name if in production without maps,
		// the namem will get obfiscated, need to find a way around this that
		// uses the proper name here at runtime:
		// state.client.openPage = { name: Fallback.name };
		state.client.openPage = { name: Fallback.name };

	} else {
		state.client.openPage = { name: route };
	}

	/*
	Automatically push a new history entry whenever openPage changes.
	This ensures multiple states are stored for us to go back and
	forward through.
	*/
	openPage.effect(page => {
		const newPath = `/${page.name}`;
		if (newPath !== window.location.pathname) {
			// Push a new entry onto the history stack with the route name
			history.pushState({ name: page.name }, '', newPath);
		}
	});

	/*
	Listen to popstate so that back/forward browser actions
	update openPage accordingly. This also handles the user
	manually editing the URL in the address bar.
	*/
	window.addEventListener('popstate', () => {
		// If the user typed a URL or used back/forward, parse the current path
		const path = getRoute();
		if (!pages[path]) {
			state.client.openPage = { name: Fallback.name };
		} else {
			state.client.openPage = { name: path };
		}
	});

	const token = getCookie('webCore') || '';
	if (token) (async () => await jobRequest('sync'))();

	state.enter = async (email, password) => {
		const response = await jobRequest('enter', {
			email: email.get(),
			password: password.get(),
		});
		if (response.sessionToken) {
			const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
			document.cookie = `webCore=${response.sessionToken}; expires=${expires}; path=/; SameSite=Lax`;
			window.location.reload();
		}
		return response;
	};

	state.check = async (email) => await jobRequest('check', { email: email.get() });

	const auth = state.observer.path('sync').shallow().ignore();
	const Router = () => Observer.all([auth, openPage]).map(([a, p]) => {
		const routeCmp = pages[p.name];
		if (!routeCmp) return <Fallback state={state} />;
		const page = routeCmp.default;
		const Page = page.page;
		if (a || !page.authenticated) return <Page state={state} />;
		else return <Fallback state={state} />;
	});

	mount(document.body,
		pages ? <App state={state}><Router /></App>
			: window.location.pathname === '/'
				? <App state={state} />
				: <Fallback state={state} />
	);
};

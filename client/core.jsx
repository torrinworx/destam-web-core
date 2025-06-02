import database from 'destam-db';
import { mount } from 'destam-dom';
import { v4 as uuidv4 } from 'uuid';
import indexeddb from 'destam-db/driver/indexeddb.js';
import { Observer, OObject, createNetwork } from 'destam';

import { parse, stringify } from '../common/clone';
import { getCookie, cookieUpdates } from './cookies';

let ws;
export const initWS = () => {
	const token = getCookie('webcore') || '';
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

export const modReq = (name, props) => new Promise(async (resolve, reject) => {
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
		try {
			ws.send(JSON.stringify({
				name: name,
				token: getCookie('webcore') || '',
				id: msgID,
				props: props ? props : null,
			}));
		} catch (error) {
			reject(new Error('Issue with server module request: ', error));
		}

	};

	ws.addEventListener('message', handleMessage);
	sendMessage();
});

export const syncNetwork = async (state) => {
	let network;
	const fromServer = {};

	ws.addEventListener('message', msg => {
		msg = parse(msg.data);
		// look for sync here because other data is returned from the server for modReq:
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

export const core = async ({ App, Fallback, pages, defaultPage = 'Landing' }) => {
	const driver = indexeddb('webcore');
	const DB = database(driver);
	const client = await DB.reuse('client', { state: 'client' });

	if (!App) throw new Error('App component is required.');
	if (!Fallback) throw new Error('Fallback component is required.');

	await initWS();

	// State is split in two: state.sync and state.client, this prevents
	// client only updates from needlessly updating the database.
	const state = OObject({
		client: client,
		sync: null
	});
	window.state = state;

	await syncNetwork(state);
	cookieUpdates();

	const openPage = state.client.observer.path('openPage').def({ name: defaultPage });

	// Listen for when web-core cookie is changed, re-init state if webcore cookie deleted (only deleted on signout)
	// document.addEventListener('cookiechange', async ({ detail: { newValue, oldValue } }) => {
	// 	console.log(newValue, '\n', oldValue);
	// 	if (oldValue.webcore && !newValue.webcore) {
	// 		state.client.openGig = { name: defaultPage };
	// 	}
	// });
	// TODO: Ensure logout even when user clears cookies

	const getRoute = () => {
		let path = window.location.pathname;
		if (path.startsWith('/')) path = path.slice(1);
		if (!path) path = defaultPage;
		return path;
	}

	const route = getRoute();
	// TODO: Issue here with fallback.name if in production without maps,
	// the namem will get obfiscated, need to find a way around this that
	// uses the proper name here at runtime:
	// state.client.openPage = { name: Fallback.name };
	if (pages[route]) state.client.openPage = { name: route };
	else state.client.openPage = { name: Fallback.name };

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

	const token = getCookie('webcore') || '';
	if (token) (async () => await modReq('sync'))();

	state.enter = async (email, password) => {
		const response = await modReq(
			'enter',
			{
				email: email.get(),
				password: password.get(),
			}
		);

		if (response.token) {
			const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
			document.cookie = `webcore=${response.token}; expires=${expires}; path=/; SameSite=Lax`;
			await modReq('sync')
		}
		return response;
	};

	state.check = async (email) => await modReq(
		'check',
		{ email: email.get() }
	);

	state.leave = () => {
		document.cookie = 'webcore=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
		const cookies = document.cookie.split("; ");
		for (const cookie of cookies) {
			const eqPos = cookie.indexOf("=");
			const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
			document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
		}
		state.client.openPage = { name: defaultPage };
		state.sync = null;
	};

	const Router = (_, cleanup) => {
		const auth = state.observer.path('sync');

		cleanup(openPage.effect(page => {
			const newPath = `/${page.name}`;
			if (newPath !== window.location.pathname) {
				// Push a new entry onto the history stack with the route name
				history.pushState({ name: page.name }, '', newPath);
			}
		}));

		return Observer.all([openPage, auth]).map(([p, a]) => {
			const pageCmp = pages[p.name];
			if (!pageCmp) return <Fallback state={state} />;
			const page = pageCmp.default;
			const Page = page.page;

			if (Page) return !page.authenticated
				? <Page state={state} />
				: (a && page.authenticated
					? <Page state={state} />
					: <Fallback state={state} />
				)
			else return <Fallback state={state} />;
		}).unwrap();
	};

	mount(document.body,
		pages ? <App state={state}><Router /></App>
			: window.location.pathname === '/'
				? <App state={state} />
				: <Fallback state={state} />
	);
};

import { v4 as uuidv4 } from 'uuid';

import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { ODB, initODB } from 'destam-db-core';
import { createServer as createViteServer } from 'vite';
import { Observer, OObject, createNetwork } from 'destam';

import initQ from './queue.js';
import Modules from './modules.js';
import http from './servers/http.js';
import { parse, stringify } from '../common/clone.js';

const authenticate = async (sessionToken) => {
	if (sessionToken && sessionToken != 'null') {
		const user = await ODB({
			driver: 'mongodb',
			collection: 'users',
			query: { 'sessions': sessionToken }
		});

		if (user) return true
		else return false
	}
};

/**
 * Sets up a synced observer with the client and db. Synchronizes changes from
 * the client/server and updates through WebSocket connection.
 * @param {Object} authenticated - An object that tracks user authentication status.
 * @param {WebSocket} ws - The WebSocket connection instance.
 * @param {OObject} [sync=OObject({})] - An observable object to sync.
 * @returns {OObject} - The synced observable object.
 */
const syncNetwork = (authenticated, ws, sync = OObject({})) => {
	let network = createNetwork(sync.observer);
	const fromClient = {};
	ws.send(JSON.stringify({ name: 'sync', result: stringify(sync) }));

	network.digest(async (changes, observerRefs) => {
		const serverChanges = stringify(
			changes, { observerRefs: observerRefs, observerNetwork: network }
		);
		ws.send(JSON.stringify({ name: 'sync', result: serverChanges }));
	}, 1000 / 30, (arg) => arg === fromClient);

	ws.on('message', async (msg) => {
		msg = parse(msg);

		if (authenticated.get() && msg.name === 'sync') {
			ws.send(JSON.stringify({ name: 'sync', result: stringify(sync) }));

			if (msg.clientChanges) {
				// TODO: validate changes follow the validator/schema
				network.apply(parse(msg.clientChanges), fromClient);
			}
		}
	});

	ws.on('close', () => {
		network.remove();
	});

	return sync;
};

const coreServer = async ({ server = null, root, modulesDir, onCon, onEnter, props }) => {
	await initODB();
	const modules = await Modules(modulesDir);
	const queue = await initQ({ modules });

	server = server ? server = server() : http();

	if (process.env.NODE_ENV === 'production') {
		server.production({ root });
	} else {
		const vite = await createViteServer({ server: { middlewareMode: 'html' } });
		server.development({ vite });
	}

	server = await server.listen();
	const wss = new WebSocketServer({ server });

	console.log("THIS IS QUEUE: ", queue);

	wss.on('connection', async (ws, req) => {
		let sync;
		let user;
		let conProps;
		const sessionToken = Observer.mutable('');
		const authenticated = Observer.mutable(false);

		authenticated.watch(d => {
			if (d.value) {
				(async () => {
					user = await ODB({
						driver: 'mongodb',
						collection: 'users',
						query: { 'sessions': sessionToken.get() }
					});
					sync = await ODB({
						driver: 'mongodb',
						collection: 'state',
						query: { userID: user.userID }
					});

					if (onCon) {
						conProps = await onCon(ws, req, user, sync, sessionToken);
					}

					syncNetwork(authenticated, ws, sync);
				})();
			} else if (sync) {
				ws.close();
			}
		});

		sessionToken.set(new URLSearchParams(req.url.split('?')[1]).get('sessionToken'));
		const status = await authenticate(sessionToken.get());
		authenticated.set(status);

		ws.on('message', async msg => {
			try {
				msg = parse(msg);

				if (!authenticated.get() && msg.sessionToken) {
					sessionToken.set(msg.sessionToken);
					const status = await authenticate(sessionToken.get());
					authenticated.set(status);
				}

				if (msg.name === 'sync') return;

				const module = modules[msg.name];
				if (!module || (!module.onMsg && !module.onMsgQ)) {
					throw new Error(`Module not found: ${msg.name}`);
				}

				if (!authenticated.get() && module.authenticated !== false) {
					throw new Error(`Unauthorized access attempt to module: ${msg.name}`);
				}

				let result;
				if (module.onMsgQ) {
					const request = OObject({
						id: msg.id,
						module: msg.name,
						props: {
							...(module.authenticated && { sync, user }),
							...conProps,
							...props,
						},
						status: 'pending',
						created: new Date()
					});

					queue.push(request);

					request.observer.path('status').watch(d => {
						console.log(d.value);
					})
				} else {
					result = await module.onMsg({
						...(module.authenticated && { sync, user }),
						...conProps,
						...props,
						onEnter: msg.name === 'enter' ? onEnter : null,
					});
				}
				ws.send(JSON.stringify({ name: msg.name, result: result, id: msg.id }));
			} catch (error) {
				console.error(error);
				ws.send(JSON.stringify({ error: error.message, id: msg.id }));
			}
		});
	});
};

export default coreServer;

import 'dotenv/config';
import database from 'destam-db';
import { WebSocketServer } from 'ws';
import mongodb from 'destam-db/driver/mongodb.js';
import { createServer as createViteServer } from 'vite';
import { Observer, OObject, createNetwork } from 'destam';

import Modules from './modules.js';
import http from './servers/http.js';
import { parse, stringify } from '../common/clone.js';

const validators = new Map()

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

/**
 * Initializes and manages the core server that handles WebSocket connections,
 * server environments, and modules loading. Facilitates communication between the client
 * and server, while managing user authentication and synchronization of state.
 *
 * At minimum coreServer needs to run an http server, and a ws websocket server.
 * 
 * The "server" variable allows you to configure your own special server for express, etc.
 *
 * @async
 * @function
 * @param {Object} options - Configuration options for setting up the server.
 * @param {Function} [options.server=null] - Custom server initialization function.
 * @param {string} options.root - Root directory for the server setup.
 * @param {string} options.modulesDir - Directory path where modules are stored.
 * @param {Function} [options.onCon] - Callback executed upon a new WebSocket connection.
 * @param {Function} [options.onEnter] - Callback executed when a client enters.
 * @param {Object} options.props - Additional properties passed to modules.
 */
const core = async ({ server = null, root, modulesDir, onCon, onEnter }) => {
	const driver = mongodb(process.env.db, process.env.table);
	const DB = database(driver);
	const modules = await Modules(modulesDir);
	server = server ? server = server() : http();

	if (process.env.NODE_ENV === 'production') {
		server.production({ root });
	} else {
		const vite = await createViteServer({ server: { middlewareMode: 'html' } });
		server.development({ vite });
	}

	server = await server.listen();
	const wss = new WebSocketServer({ server });

	wss.on('connection', async (ws, req) => {
		console.log(req);

		let sync;
		let user;
		let onConProps;
		const sessionToken = Observer.mutable('');
		const authenticated = Observer.mutable(false);

		authenticated.watch(d => {
			if (d.value) (async () => {
				const userQuery = await DB.query('users', { sessions: sessionToken.get() });
				user = await DB.instance(userQuery);

				console.log('user in coreServer:')

				sync = await DB.reuse('state', { id: user.observer.id });

				if (onCon) onConProps = await onCon(ws, req, user, sync, sessionToken);

				syncNetwork(authenticated, ws, sync);
			})();
			else if (sync) ws.close();
		});

		const authenticate = async (sessionToken) => {
			if (sessionToken && sessionToken != 'null') {
				const user = await DB.reuse('users', { 'sessions': sessionToken });
				if (user) return true
				else return false
			}
		};

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
				// module must have at least onMsg or onMsgQ to be called by client.
				if (!module || (!module.onMsg && !module.onMsgQ)) {
					throw new Error(`Module not found: ${msg.name}`);
				}

				if (!authenticated.get() && module.authenticated !== false) {
					throw new Error(`Unauthorized access attempt to module: ${msg.name}`);
				}

				// TODO: Better way to organize props and distinguish between where different
				// props are coming from, need to distinguish in case of conflicting prop names:

				const result = await module.onMsg(
					msg.props,
					onConProps,
					{
						authenticated: module.authenticated,
						sync,
						user,
						onEnter: msg.name === 'enter' ? onEnter : null,
						DB
					},
				)
				ws.send(JSON.stringify({ name: msg.name, result: result, id: msg.id }));
			} catch (error) {
				console.error(error);
				ws.send(JSON.stringify({ error: error.message, id: msg.id }));
			}
		});
	});
};

export default core;

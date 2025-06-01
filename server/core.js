import database from 'destam-db';
import { WebSocketServer } from 'ws';
import mongodb from 'destam-db/driver/mongodb.js';
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
const core = async ({ server = null, root, modulesDir, onCon, onEnter, db, table, env, port }) => {
	const driver = mongodb(db, table);
	const DB = database(driver);
	const modules = await Modules(modulesDir);
	server = server ? server = server() : http();


	if (env === 'production') server.production({ root });
	else {
		const { createServer: createViteServer } = await import('vite');
		const vite = await createViteServer({ server: { middlewareMode: 'html' } });
		server.development({ vite });
	}

	server = await server.listen(port);
	const wss = new WebSocketServer({ server });

	// on each connection to a client
	wss.on('connection', async (ws, req) => {
		let sync;
		let user;
		let onConProps;
		const token = Observer.mutable(new URLSearchParams(req.url.split('?')[1]).get('token'));
		const authenticated = Observer.mutable(false);

		authenticated.effect(a => {
			if (a) (async () => {
				try {
					let session = await DB.query('sessions', { uuid: token.get() });
					if (!session) throw new Error('Session not found.');

					session = await DB.instance(session);

					user = await DB.query('users', { uuid: session.query.user });
					if (!user) throw new Error('User not found.');

					user = await DB.instance(user);

					sync = await DB.reuse('state', { user: session.query.user });

					if (onCon) onConProps = await onCon(ws, req, user, sync, token);

					syncNetwork(authenticated, ws, sync);
				} catch (error) {
					console.error('Error in authentication watch:', error.message);
					if (sync) ws.close();
				}
			})();
			else if (sync) ws.close();
		});

		const authenticate = async (token) => {
			try {
				if (token && token !== 'null') {
					let session = await DB.query('sessions', { uuid: token });
					if (!session) return false;

					session = await DB.instance(session);

					if (new Date() < session.expires) {
						user = await DB.reuse('users', { uuid: session.query.user });
						if (user) return true;
						else return false;
					} else return false;
				} else return false;
			} catch (error) {
				console.error('Error during authentication:', error.message);
				return false;
			}
		};

		const status = await authenticate(token.get());
		authenticated.set(status);

		ws.on('message', async msg => {
			try {
				msg = parse(msg);

				if (!authenticated.get() && msg.token && msg.token !== token.get()) {
					token.set(msg.token);
					const status = await authenticate(token.get());
					authenticated.set(status);
				}

				if (msg.name === 'sync') return;

				const module = modules[msg.name];
				// Check if the module exists and has an onMsg function.
				if (!module || !module.onMsg) {
					return ws.send(JSON.stringify({ error: `Module not found: ${msg.name}`, id: msg.id }));
				}

				if (!authenticated.get() && module.authenticated !== false) {
					console.warn(`Unauthorized access attempt to module: ${msg.name}, msg id: ${msg.id}`);
					return ws.send(JSON.stringify({ error: `Module not found: ${msg.name}`, id: msg.id }));
				}

				const result = await module.onMsg(
					msg.props,
					onConProps ? onConProps : null,
					{
						sync,
						user,
						onEnter: msg.name === 'enter' ? onEnter : null,
						DB,
						env,
					}
				);
				ws.send(JSON.stringify({ result: result, id: msg.id }));
			} catch (error) {
				ws.send(JSON.stringify({ error: error.message, id: msg.id }));
				console.error(`An error occurred processing message ID ${msg.id}:`, error.message);
			}
		});
	});
};

export default core;

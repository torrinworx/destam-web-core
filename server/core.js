import database from 'destam-db';
import { WebSocketServer } from 'ws';
import mongodb from 'destam-db/driver/mongodb.js';

import { default as syncNet } from './sync.js';
import Modules from './modules.js';
import http from './servers/http.js';
import { parse } from '../common/clone.js';
import createValidation from './validate.js';
import createSchedule from './schedule.js';

const core = async ({ server = null, root, modulesDir, onCon, onEnter, db, table, env, port }) => {
	server = server ? server() : http();

	if (env === 'production') server.production({ root });
	else {
		const { createServer: createViteServer } = await import('vite');
		const vite = await createViteServer({ server: { middlewareMode: 'html' } });
		server.development({ vite, root });
	}

	const mongo = mongodb(db, table);
	const mongoDb = await mongo.database;

	const rawDB = database(mongo);
	const { DB, registerValidator } = createValidation(rawDB);

	const scheduler = createSchedule({
		onError: (err, job) => console.error(`schedule error (${job.name}):`, err),
	});

	const modules = await Modules(modulesDir, {
		serverProps: server.props,
		DB,
		registerSchedule: (name, scheduleDef, ctx = {}) => {
			if (typeof name !== 'string' || !name) throw new Error('registerSchedule(name, ...) name must be a non-empty string');
			return scheduler.registerSchedule(name, scheduleDef, {
				DB,
				env,
				server,
				client: mongo.client,
				database: mongoDb,
				...ctx,
			});
		},
	});

	// validators
	for (const [name, mod] of Object.entries(modules)) {
		const v = mod?.validate;
		if (!v) continue;

		if (typeof v !== 'object') throw new Error(`Module "${name}" validate must be an object`);
		if (typeof v.table !== 'string' || !v.table) throw new Error(`Module "${name}" validate.table must be a string`);
		if (typeof v.register !== 'function') throw new Error(`Module "${name}" validate.register must be a function`);

		const produced = (v.register.length === 0) ? await v.register() : v.register;
		const list = Array.isArray(produced) ? produced : [produced];

		for (const fn of list) {
			if (typeof fn !== 'function') throw new Error(`Module "${name}" validate.register must produce a function (or array)`);
			registerValidator(v.table, fn);
		}
	}

	// schedule-only modules (or declarative schedules)
	for (const [name, mod] of Object.entries(modules)) {
		const defs = mod?.schedule ?? null;
		if (!defs) continue;

		const list = Array.isArray(defs) ? defs : [defs];

		for (let i = 0; i < list.length; i++) {
			const def = list[i];
			const id = def?.name || String(i);

			scheduler.registerSchedule(`${name}:${id}`, def, {
				DB,
				env,
				server,
				client: mongo.client,
				database: mongoDb,
			});
		}
	}

	// now start server...
	const nodeServer = await server.listen(port);


	// websocket uses the node server
	const wss = new WebSocketServer({ server: nodeServer });

	wss.on('connection', async (ws, req) => {
		const send = obj => {
			if (ws.readyState === 1) ws.send(JSON.stringify(obj));
		};

		const normalizeToken = t => {
			if (typeof t !== 'string') return null;
			t = t.trim();
			if (!t || t === 'null' || t === 'undefined') return null;
			return t;
		};

		const getTokenFromReq = req => {
			try {
				const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
				return normalizeToken(url.searchParams.get('token'));
			} catch {
				return null;
			}
		};

		const resolveAuth = async token => {
			// sessions: never use reuse() here (don’t create on auth)
			const sessionQuery = await DB.query('sessions', { uuid: token });
			if (!sessionQuery) return null;

			const session = await DB.instance(sessionQuery, 'sessions');

			// make expires a number (supports old data too)
			const expires =
				typeof session.expires === 'number' ? session.expires : +new Date(session.expires);

			if (!expires || Date.now() >= expires) return null;
			if (session.status === false) return null;

			const userQuery = await DB.query('users', { uuid: session.query.user });
			if (!userQuery) return null;

			const user = await DB.instance(userQuery, 'users');

			const sync = await DB.reuse('state', { user: user.query.uuid });

			return { session, user, sync };
		};

		let authAttempt = 0;
		let authed = false;
		let token = getTokenFromReq(req);

		let user = null;
		let sync = null;
		let onConProps = null;

		let syncStarted = false;

		let stopSync = null;

		const startSyncOnce = () => {
			if (syncStarted) return;
			syncStarted = true;

			Promise.resolve()
				.then(() => syncNet(() => authed === true, ws, sync))
				.then(ret => {
					// if syncNet returns an unsubscribe/cleanup function, keep it
					if (typeof ret === 'function') stopSync = ret;
				})
				.catch(err => {
					console.error('syncNet error:', err);
					try { ws.close(); } catch { }
				});
		};

		const setAuthToken = async nextToken => {
			nextToken = normalizeToken(nextToken);
			token = nextToken;

			const myAttempt = ++authAttempt;

			authed = false;
			user = null;
			sync = null;

			if (!token) {
				send({ name: 'auth', ok: false });
				return false;
			}

			let auth;
			try {
				auth = await resolveAuth(token);
			} catch (e) {
				console.error('auth resolve error:', e);
				send({ name: 'auth', ok: false });
				return false;
			}

			// if another auth started while we awaited, ignore this result
			if (myAttempt !== authAttempt) return false;

			if (!auth) {
				send({ name: 'auth', ok: false });
				return false;
			}

			authed = true;
			user = auth.user;
			sync = auth.sync;

			// start sync BEFORE any slow onCon logic
			startSyncOnce();

			// tell client it’s safe to begin sync (client should wait for this)
			send({ name: 'auth', ok: true, token });

			if (onCon) {
				Promise.resolve(onCon(ws, req, user, sync, token))
					.then(v => (onConProps = v))
					.catch(err => console.error('onCon error:', err));
			}

			return true;
		};

		// attempt auth immediately from query token
		await setAuthToken(token);

		ws.on('message', async raw => {
			let msg;
			try {
				msg = parse(raw);
			} catch (e) {
				return send({ error: 'Bad message format' });
			}

			// let syncNet own "sync" messages; but only after auth_ok
			if (msg?.name === 'sync') {
				if (!authed) {
					// don’t silently drop; this is how clients “hang”
					return send({ error: 'Not authenticated yet (wait for auth.ok)' });
				}
				return;
			}

			// allow late token set (ex: after enter/login)
			if (!authed && msg?.token) {
				await setAuthToken(msg.token);
			}

			const module = modules[msg?.name];
			if (!module?.onMsg) {
				return send({ error: `Module not found: ${msg?.name}`, id: msg?.id });
			}

			if (!authed && module.authenticated !== false) {
				return send({ error: `Unauthorized`, id: msg?.id });
			}

			try {
				const result = await module.onMsg(
					msg.props,
					onConProps || null,
					{
						server,
						sync,
						user,
						onEnter: msg.name === 'enter' ? onEnter : null,
						DB,
						env,
						client: mongo.client,
						database: await mongo.database,
						token,
					}
				);

				send({ result, id: msg.id });
			} catch (e) {
				console.error(`module error (${msg?.name})`, e);
				send({ error: e.message, id: msg?.id });
			}
		});

		ws.isAlive = true;
		ws.on("pong", () => { ws.isAlive = true; });

		ws.on('close', () => {
			try { stopSync?.(); } catch { }
		});
	});

	const interval = setInterval(() => {
		for (const ws of wss.clients) {
			if (ws.isAlive === false) {
				try { ws.terminate(); } catch { }
				continue;
			}
			ws.isAlive = false;
			try { ws.ping(); } catch { }
		}
	}, 30000);

	wss.on("close", () => clearInterval(interval));

	const shutdown = async () => {
		try { scheduler.stopAll(); } catch { }
		try { await DB.close?.(); } catch { }
		try { await server.close?.(); } catch { }
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
};

export default core;

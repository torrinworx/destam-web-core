/*
The base of web-core, managing server setup, initialization, and WebSocket connections for real-time state synchronization between clients and the server.

State Management:
- state.client: State stored exclusively on the client, invisible to the server. This reduces unnecessary database updates.
- state.sync: State synchronized between the server and clients. It is automatically transmitted via WebSocket and stored in a MongoDB document for users.

Job Definition:
- A job is defined as an object with properties such as `authenticated` and `init`.
- By default, the `authenticated` property is true unless specified otherwise. It indicates whether authentication is required for the job.
- The `init` function is an extensive function that handles the logic for each message received from a job.

Connection Logic:
- The `coreServer` function accepts a `connection()` function parameter.
- This `connection()` function allows the execution of custom logic when a user establishes an authenticated connection.
- It is triggered when `authenticated` becomes true for the first time during a connection. If authentication turns false, the connection is terminated.

Philosophy:
- The inclusion of user authentication as a core component of webcore is intentional.
- This is opinionated, meant to simplify authentication concerns.
*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import { WebSocketServer } from 'ws';
import { createNetwork } from 'destam';
import { Observer, OObject } from 'destam-dom';
import { createServer as createViteServer } from 'vite';

import Jobs from './jobs.js';
import ODB, { initDB } from './odb.js';
import { parse, stringify } from '../common/clone.js';

const authenticate = async (sessionToken) => {
    if (sessionToken && sessionToken != 'null') {
        const user = await ODB('users', { "sessions": sessionToken });

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

    ws.on("message", async (msg) => {
        msg = parse(msg);

        if (authenticated.get() && msg.name === 'sync') {
            if (msg.clientChanges) {
                // TODO: validate changes follow the validator/schema
                network.apply(parse(msg.clientChanges), fromClient);
            }
        }
    });

    ws.on("close", () => {
        network.remove();
    });

    return sync;
};

/**
 * The core of web-core. It initializes the database, manages authentication
 * watch processes, and handles WebSocket connections with clients.
 * @param {Object} server - The HTTP server instance.
 * @param {string} jobs_dir - The directory of job definitions.
 * @param {Function} connection - A function executed when a user makes an authenticated connection.
 */
const core = async (server, jobs_dir, connection) => {
    await initDB();
    const wss = new WebSocketServer({ server });
    const jobs = await Jobs(jobs_dir);

    wss.on('connection', async (ws, req) => {
        let sync;
        let user;
        let connectionProps;
        const sessionToken = Observer.mutable('');
        const authenticated = Observer.mutable(false);

        authenticated.watch(d => {
            if (d.value) {
                (async () => {
                    if (connection) {
                        connectionProps = await connection(ws, req, sessionToken);
                        user = await ODB('users', { "sessions": sessionToken.get() });
                        sync = await ODB('state', { userID: user.userID });
                        syncNetwork(authenticated, ws, sync);
                    }
                })();
            } else if (sync) {
                ws.close();
            }
        });

        sessionToken.set(new URLSearchParams(req.url.split('?')[1]).get('sessionToken'));
        const status = await authenticate(sessionToken.get());
        authenticated.set(status);

        ws.on('message', async msg => {
            msg = parse(msg);

            if (!authenticated.get() && msg.sessionToken) {
                sessionToken.set(msg.sessionToken);
                const status = await authenticate(sessionToken.get());
                authenticated.set(status);
            }

            if (msg.name === 'sync') return;

            const job = jobs[msg.name];
            if (!job) {
                console.error(`Job not found: ${msg.name}`);
                return;
            }

            if (!authenticated.get() && job.authenticated) {
                console.error(`Unauthorized access attempt to job: ${msg.name}`);
                return;
            }

            try {
                const result = await job.init({
                    msg,
                    sync: job.authenticated ? sync : undefined,
                    user: job.authenticated ? user : undefined,
                    ...connectionProps
                });

                ws.send(JSON.stringify({ name: msg.name, result: result, id: msg.id }));
            } catch (error) {
                console.error(`Error running job "${msg.name}":`, error);
            }
        });
    });
};


/**
 * Sets up an Express-based server capable of working with the web-core
 * structure and integrates Vite during development for HMR support.
 * 
 * In the future we might want to make this some kind of optional thing
 * incase people want to use other servers, core doesn't really need to rely
 * on a specific server to run.
 * 
 * @param {string} jobs_dir - The directory, or list of directories, of job definitions.
 * @param {Function} connection - A function executed when a user makes an authenticated connection.
 */
const coreServer = async (jobs_dir, build_dir, connection) => {
    const app = express();

    // Log to see the resolved build_dir path
    console.log('Resolved build directory:', build_dir);

    if (process.env.ENV === 'production') {
        app.use(express.static(path.resolve(build_dir)));
        console.log('Serving index.html from:', path.join(build_dir, 'index.html'));

        app.get('*', (_req, res) => {
            res.sendFile(path.join(build_dir, 'index.html'));
        });
    } else {
        const vite = await createViteServer({ server: { middlewareMode: 'html' } });

        app.use(vite.middlewares);

        app.get('*', async (req, res, next) => {
            try {
                const html = await vite.transformIndexHtml(
                    req.originalUrl,
                    fs.readFileSync(
                        path.resolve(__dirname, 'index.html'),
                        'utf-8'
                    )
                );

                res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
            } catch (e) {
                vite.ssrFixStacktrace(e);
                next(e);
            }
        });
    }

    await core(app.listen(process.env.PORT || 3000, () => {
        console.log(`Server running on port ${process.env.PORT || 3000}`);
    }), jobs_dir, connection);
};


export default coreServer;

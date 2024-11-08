/* Core file that handles the ws connection and authentication.

This is the root of web-core.

No state stored within modules. All state that is needed can be stored in state.server
There should be three states:

state.client => state stored on the client, server will never see this, soley on the client to prevent excessive database updates.
state.sync => state that is synced between the server and the client, automatically passed through a websocket and stored in a mongodb document for users

job definition:

export default example = () => {
    authenticated: true, // Default is always true if it's not declared.
    init: (props) => { // Extensive function that allows you to react on each message received from job.
        ...
    },
};

coreServer will accept a connection() function, this function will allows you to run logic on a user makes an Authenticated connection.

connection() gets ran when authenticated = true for the first time in the connection. If authenticated turns false, then it disconnects
*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import { WebSocketServer } from 'ws';
import { createNetwork } from 'destam';
import { Observer, OObject, OArray } from 'destam-dom';
import { createServer as createViteServer } from 'vite';

import Jobs from './jobs.js';
import { initDB } from './db.js';
import { parse, stringify } from './clone.js';

// TODO: Determine if the users session token is valid.
const authenticate = (token) => {
    if (token && token != 'null') {
        // TODO: handle db lookup of user and all that stuff here.
        return true
    } else {
        return false;
    };
};

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

    ws.on("message", (msg) => {
        msg = parse(msg);
        authenticated.set(authenticate(msg.sessionToken));
        if (authenticated.get() && msg.name === 'sync') {
            // TODO: validate changes follow the validator/schema
            network.apply(parse(msg.clientChanges), fromClient);
        }
    });

    ws.on("close", () => {
        network.remove();
    });

    return sync;
};

const core = async (server, jobs_dir, connection) => {
    const wss = new WebSocketServer({ server });
    const jobs = await Jobs(jobs_dir);

    wss.on('connection', async (ws, req) => {
        let sync;
        let connectionProps;
        const authenticated = Observer.mutable(false);

        authenticated.watch(d => {
            if (d.value) {
                (async () => {
                    if (connection) {
                        connectionProps = await connection(ws, req);

                        // syncnetwork will only activate if the user wants it to.
                        if (connectionProps && connectionProps.sync) {
                            sync = connectionProps.sync;
                            syncNetwork(authenticated, ws, sync);
                        }
                    }
                })();
            } else if (sync) {
                ws.close();
            }
        });

        const sessionToken = new URLSearchParams(req.url.split('?')[1]).get('sessionToken');
        authenticated.set(authenticate(sessionToken));

        ws.on('message', async msg => {
            msg = parse(msg);
            authenticated.set(authenticate(msg.sessionToken));

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
                const result = await job.init(msg, job.authenticated ? sync : undefined, ...connectionProps);
                ws.send(JSON.stringify({ name: msg.name, result: result }));
            } catch (error) {
                console.error(`Error running job "${msg.name}":`, error);
            }
        });
    });
};

const coreServer = async (jobs_dir, connection) => {
    const app = express();
    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    if (process.env.ENV === 'production') {
        app.use(express.static(path.join(__dirname, '../build')));
        app.get('*', (_req, res) => {
            res.sendFile(path.resolve(__dirname, '../build', 'index.html'));
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

    await initDB();
    await core(app.listen(process.env.PORT || 3000, () => { }), jobs_dir, connection);
};

export default coreServer;

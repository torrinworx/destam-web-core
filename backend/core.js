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
*/

import { WebSocketServer } from 'ws';
import { createNetwork } from 'destam';
import { Observer, OObject, OArray } from 'destam-dom';

import Jobs from './jobs.js';
import { parse, stringify } from './clone.js';

// Determine if the users session token is valid.
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
        const encodedChanges = stringify(
            changes, { observerRefs: observerRefs, observerNetwork: network }
        );
        ws.send(JSON.stringify({ name: 'sync', result: encodedChanges }));
    }, 1000 / 30, (arg) => arg === fromClient);

    ws.on("message", (msg) => {
        msg = parse(msg);
        authenticated.set(authenticate(msg.sessionToken));
        if (authenticated.get() && msg.name === 'sync') {
            // TODO: validate changes follow the validator/schema
            network.apply(parse(msg.commit), fromClient);
        }
    });

    ws.on("close", () => {
        network.remove();
    });
    
    return sync;
};

export default async (server) => {
    const wss = new WebSocketServer({ server });
    const jobs = await Jobs('./backend/jobs');

    wss.on('connection', async (ws, req) => {
        let sync;
        const authenticated = Observer.mutable(false);

        authenticated.watch(d => {
            if (d.value) {
                sync = OObject({
                    notifications: OArray([
                        {
                            type: 'ok',
                            content: 'Message from the server!'
                        }
                    ])
                });
                syncNetwork(authenticated, ws, sync);
            }
        });

        const sessionToken = new URLSearchParams(req.url.split('?')[1]).get('sessionToken');

        authenticated.set(authenticate(sessionToken));

        ws.on('message', async msg => {
            msg = parse(msg);
            authenticated.set(authenticate(msg.sessionToken));

            const job = jobs[msg.name];
            if (job) {
                if (authenticated.get() || !job.authenticated) {
                    try {
                        const result = await job.init(msg, sync);
                        ws.send(JSON.stringify({ name: msg.name, result: result }));
                    } catch (error) {
                        console.error(`Error running job "${msg.name}":`, error);
                    }
                } else {
                    console.error(`Unauthorized access attempt to job: ${msg.name}`);
                }
            } else {
                console.error(`Job not found: ${msg.name}`);
            }
        });
    });
};

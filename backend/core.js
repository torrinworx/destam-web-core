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
import { Observer } from 'destam-dom';

import Jobs from './jobs.js';
import { parse } from './clone.js';

// Determine if the users session token is valid.
const authenticate = (token) => {
    if (token) {
        // handle db lookup of user and all that stuff here.
        return true
    } else {
        return false;
    };
};

export default async (server) => {
    const wss = new WebSocketServer({ server });
    const jobs = await Jobs('./backend/jobs');
    console.log(jobs);

    wss.on('connection', async (ws, req) => {
        const authenticated = Observer.mutable(authenticate(
            new URLSearchParams(req.url.split('?')[1]).get('sessionToken')
        ));

        ws.on('message', async msg => {
            msg = parse(msg);
            authenticated.set(authenticate(msg.sessionToken));

            const job = jobs[msg.name];
            if (job) {
                if (authenticated.get() || !job.authenticated) {
                    try {
                        await job.init(msg);
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

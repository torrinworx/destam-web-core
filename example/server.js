import { OArray, OObject } from "destam";

import ODB from "../server/db.js";
import { stringify, parse } from "../server/clone.js";
import coreServer from "../server/coreServer.js";


const user = {
    sessions: [
        'some session token'
    ],
    profile: {
        name: 'bob',
        email: 'bob@example.com'
    }
};

const createUser = async () => {
    const sessionsToken = crypto.randomUUID();

    // Create user for the first time:
    const user = await ODB('users', {}, OObject({
        sessions: OArray([
            sessionsToken
        ])
    }));

    console.log(user); // Should log a user OObject with the current valid session
    return sessionsToken;
};

// Logic that get's ran and mounted on an authenticated connection.
const connection = async (ws, req) => {
    // const sessionToken = new URLSearchParams(req.url.split('?')[1]).get('sessionToken');
    const sessionsToken = await createUser(); // Simulate a new user being created on each connection.

    // const sync = await ODB('users', { "sessions.token": sessionToken }); // TODO: search the users

    const sync = OObject({
        notifications: OArray([
            'test',
            'something',
            OObject({
                test: 'something'
            })
        ])
    });
    console.log(stringify(sync));
    console.log(typeof(stringify(sync)));

    const syncJSON = JSON.parse(stringify(sync));
    console.log(syncJSON);

    const syncObserver = parse(JSON.stringify(syncJSON));
    console.log(syncObserver.observer);

    return {
        sync: sync,
    }
}


coreServer('./example/jobs', connection);

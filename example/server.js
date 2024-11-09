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
    const sessionToken = crypto.randomUUID();
    console.log(sessionToken);
    // Create user for the first time:
    await ODB('users', {}, OObject({
        sessions: OArray([
            sessionToken
        ]),
        profile: OArray({
            name: 'bob',
            email: 'bob@example.com'
        })
    }));

    const user = await ODB('users', { "state_json.sessions": sessionToken });

    console.log(user)

    return sessionToken;
};

// Logic that get's ran and mounted on an authenticated connection.
const connection = async (ws, req) => {
    // const sessionToken = new URLSearchParams(req.url.split('?')[1]).get('sessionToken');
    const sessionsToken = await createUser(); // Simulate a new user being created on each connection.

    // const sync = await ODB('users', { "sessions.token": sessionToken }); // TODO: search the users

    // const sync = OObject({
    //     notifications: OArray([
    //         'test',
    //         'something',
    //         OObject({
    //             test: 'something'
    //         })
    //     ])
    // });
    // console.log(stringify(sync));
    // console.log(typeof(stringify(sync)));

    // const syncJSON = JSON.parse(stringify(sync));
    // console.log(syncJSON);

    // const syncObserver = parse(JSON.stringify(syncJSON));
    // console.log(syncObserver.observer);

    // return {
    //     sync: sync,
    // }
};

coreServer('./example/jobs', connection);

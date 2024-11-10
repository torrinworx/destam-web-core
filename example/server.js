import { OObject } from "destam";

import ODB from "../server/odb.js";
import coreServer from "../server/coreServer.js";

// Logic that get's ran and mounted on an authenticated connection.
const connection = async (ws, req) => {
    const sessionToken = new URLSearchParams(req.url.split('?')[1]).get('sessionToken');

    const user = await ODB('users', { "sessions": sessionToken });
    if (user) {
        let sync = await ODB('state', { userID: user.userID });
        if (!sync) {
            sync = await ODB('state', {}, OObject({
                userID: user.userID,
            }));
        }
    }

    return {
        sync: sync,
        user: user,
    }
};

coreServer('./example/jobs', connection);

import ODB from "../server/db.js";
import coreServer from "../server/coreServer.js";

// Logic that get's ran and mounted on an authenticated connection.
const connection = async (ws, req) => {
    const sessionToken = new URLSearchParams(req.url.split('?')[1]).get('sessionToken');

    const user = await ODB('users', { "sessions": sessionToken });
    
    // TODO: Sync cannot be the user, need to create a new document in a new
    // 'state' db with the users id or something, then the state can be stored
    // in that document, or we use the _id of the doucment and associate that
    // with the users document. something like that. Then we return sync here:

    return {
        // sync: sync,
        user: user,
        test: "this is a test"
    }
};

coreServer('./example/jobs', connection);

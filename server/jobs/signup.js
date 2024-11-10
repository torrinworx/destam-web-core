import bcryptjs from 'bcryptjs';
import { OObject, OArray } from 'destam';

import ODB from '../odb.js';

export default () => {
    return {
        authenticated: false,
        init: async ({ msg }) => {
            try {
                const saltRounds = 10;
                const salt = await bcryptjs.genSalt(saltRounds);
                const hashedPassword = await bcryptjs.hash(msg.password, salt);

                // TODO: Check if user exists already before creating a new account:

                await ODB('users', {}, OObject({
                    email: msg.email,
                    password: hashedPassword,
                    userID: crypto.randomUUID(),
                    sessions: OArray([])
                }));

                return { status: 'success' };
            } catch (error) {
                return { status: 'error', error: error };
            }
        },
    };
};

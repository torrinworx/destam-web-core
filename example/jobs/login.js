import bcryptjs from 'bcryptjs';
import { randomUUID } from 'crypto';

import ODB from '../../server/db.js';

export default () => {
    return {
        authenticated: false,
        init: async ({ msg }) => {
            try {
                const user = await ODB('users', { 'email': msg.email });
                if (user) {
                    const validPassword = await bcryptjs.compare(msg.password, user.password);
                    if (validPassword) {
                        const sessionToken = randomUUID();
                        user.sessions.push(sessionToken);
                        return { status: 'success', sessionToken };
                    }
                }

                return { status: 'error', error: 'Invalid email or password' };
            } catch (error) {
                return { status: 'error', error: error };

            }
        },
    };
};

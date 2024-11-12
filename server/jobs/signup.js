import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { OObject, OArray } from 'destam';

import ODB from '../odb.js';

export default () => {
	return {
		authenticated: false,
		init: async ({ msg }) => {
			try {
				if (msg.password.length < 10 && process.env.ENV === 'production') {
					return { status: 'error', error: 'Password must be at least 10 characters long' };
				}

				const existingUser = await ODB('users', { email: msg.email });
				if (existingUser) {
					return { status: 'error', error: 'Email already in use' };
				}

				const saltRounds = 10;
				const salt = await bcryptjs.genSalt(saltRounds);
				const hashedPassword = await bcryptjs.hash(msg.password, salt);

				const userID = uuidv4();
				await ODB('users', {}, OObject({
					email: msg.email,
					password: hashedPassword,
					userID: userID,
					sessions: OArray([])
				}));

				await ODB('state', {}, OObject({
					userID: userID,
				}))

				return { status: 'success' };
			} catch (error) {
				return { status: 'error', error: error };
			}
		},
	};
};

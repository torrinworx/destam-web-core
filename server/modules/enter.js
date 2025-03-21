import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { ODB } from 'destam-db-core';
import { OObject, OArray } from 'destam';

export default () => {
	return {
		authenticated: false,
		onMsg: async ({ email, password, onEnter }) => {
			try {
				const user = await ODB({
					driver: 'mongodb',
					collection: 'users',
					query: { 'email': email }
				});

				if (user) {
					const validPassword = await bcryptjs.compare(password, user.password);
					if (validPassword) {
						const sessionToken = uuidv4();
						user.sessions.push(sessionToken);
						return { sessionToken };
					}
				} else {
					if (password.length < 10 && process.env.NODE_ENV === 'production') {
						return { error: 'Password must be at least 10 characters long' };
					}

					const saltRounds = 10;
					const salt = await bcryptjs.genSalt(saltRounds);
					const hashedPassword = await bcryptjs.hash(password, salt);

					const userID = uuidv4();
					const user = await ODB({
						driver: 'mongodb',
						collection: 'users',
						value: OObject({
							email: email,
							password: hashedPassword,
							userID: userID,
							sessions: OArray([])
						})
					});

					await ODB({
						driver: 'mongodb',
						collection: 'state',
						value: OObject({
							userID: userID,
						})
					});

					const sessionToken = uuidv4();
					user.sessions.push(sessionToken);

					await onEnter({ email, userID, user });

					return { sessionToken };
				}

				return { error: 'Invalid email or password' };
			} catch (error) {
				console.error(error)
				return { error };

			}
		},
	};
};

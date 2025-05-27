import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const createSession = async (DB, user) => {
	const token = uuidv4();
	const expires = new Date();
	expires.setMonth(expires.getMonth() + 1);

	let session = await DB.reuse('sessions', { token, user: user.query.uuid });

	session.expires = expires;
	session.status = true;

	return token;
};

export default () => {
	return {
		authenticated: false,
		onMsg: async ({ email, password }, _, { DB, onEnter }) => {
			try {
				let user = await DB.reuse('users', { email });

				if (Object.keys(user).length !== 0) {
					const validPassword = await bcryptjs.compare(password, user.password);
					if (validPassword) return { token: await createSession(DB, user) };
				} else {
					if (password.length < 10 && process.env.ENV === 'production') {
						return { error: 'Password must be at least 10 characters long' };
					}

					const saltRounds = 10;
					const salt = await bcryptjs.genSalt(saltRounds);
					const hashedPassword = await bcryptjs.hash(password, salt);

					user.email = email;
					user.password = hashedPassword;

					await DB.reuse('state', { user: user.query.uuid });
					await onEnter({ email, user });
					return { token: await createSession(DB, user) };
				}

				return { error: 'Invalid email or password' };
			} catch (error) {
				// Log the error or take appropriate action
				console.error('Authentication error:', error);
				return { error: 'An internal error occurred, please try again later.' };
			}
		},
	};
};
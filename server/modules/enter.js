import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const createSession = async (DB, user) => {
	const token = uuidv4();
	const expires = new Date();
	expires.setMonth(expires.getMonth() + 1);

	const session = await DB('sessions');

	session.query.token = token;
	session.query.user = user.observer.id.toHex();

	session.expires = expires;
	session.status = true;

	return token;
};

export default () => {
	return {
		authenticated: false,
		onMsg: async ({ email, password }, _, { DB, onEnter }) => {
			const user = await DB.reuse('users', { 'email': email });

			if (Object.keys(user).length != 0) {
				const validPassword = await bcryptjs.compare(password, user.password);
				if (validPassword) return { token: await createSession(DB, user) };
			} else {
				if (password.length < 10 && process.env.NODE_ENV === 'production') {
					throw new Error('Password must be at least 10 characters long');
				}

				const saltRounds = 10;
				const salt = await bcryptjs.genSalt(saltRounds);
				const hashedPassword = await bcryptjs.hash(password, salt);

				user.email = email;
				user.password = hashedPassword;
				const state = await DB('state');
				state.query.user = user.observer.id.toHex(); 

				await onEnter({ email, user });
				return { token: await createSession(DB, user) };
			}
			throw new Error('Invalid email or password');
		},
	};
};

import bcryptjs from 'bcryptjs';

const createSession = async (DB, user) => {
	const expires = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
	const session = await DB('sessions');
	session.query.user = user.query.uuid;
	session.expires = expires;
	session.status = true;

	await DB.flush(session);

	return session.query.uuid;
};

const normalizeEmail = (email) =>
	typeof email === 'string' ? email.trim().toLowerCase() : '';

const normalizeName = (name) =>
	typeof name === 'string' ? name.trim() : '';

const isValidEmail = (email) =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export default () => {
	return {
		authenticated: false,

		onMsg: async ({ email, name, password }, { DB, onEnter }) => {
			try {
				const isDev =
					process.env.NODE_ENV === 'development' ||
					process.env.ENV === 'development';

				email = normalizeEmail(email);
				name = normalizeName(name);
				password = typeof password === 'string' ? password : '';

				if (!email) return { error: 'Email is required.' };
				if (!isValidEmail(email)) return { error: 'Please enter a valid email address.' };

				const userQuery = await DB.query('users', { email });

				// Login
				if (userQuery) {
					const user = await DB.instance(userQuery);

					if (!isDev && !password) return { error: 'Password is required.' };

					if (typeof user.password !== 'string' || user.password.length === 0) {
						return { error: 'Invalid email or password' };
					}

					const validPassword = await bcryptjs.compare(password, user.password);
					if (!validPassword) return { error: 'Invalid email or password' };

					return { token: await createSession(DB, user) };
				} else { // Signup
					if (!name) return { error: 'Name is required.' };
					if (name.length > 20) return { error: 'Name must be 20 characters or less.' };

					if (!isDev) {
						if (!password) return { error: 'Password is required.' };
						if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
					}

					const saltRounds = 10;
					const salt = await bcryptjs.genSalt(saltRounds);
					const hashedPassword = await bcryptjs.hash(password, salt);

					const user = await DB('users');
					user.query.email = email;
					user.email = email;
					user.name = name;
					user.password = hashedPassword;

					await DB.flush(user);

					await DB.reuse('state', { user: user.query.uuid });

					if (onEnter) await onEnter({ email, name, user });

					return { token: await createSession(DB, user) };
				}
			} catch (error) {
				console.error('enter.js error:', error);
				return { error: 'An internal error occurred, please try again later.' };
			}
		},
	};
};

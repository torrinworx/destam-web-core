import bcryptjs from 'bcryptjs';

const createSession = async (DB, user) => {
	const expires = new Date();
	expires.setMonth(expires.getMonth() + 1);

	let session = await DB('sessions');
	session.query.user = user.query.uuid;
	session.expires = expires;
	session.status = true;

	return session.query.uuid;
};

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
const normalizeName = (name) => (typeof name === 'string' ? name.trim() : '');

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export default () => {
	return {
		authenticated: false,
		onMsg: async ({ email, name, password }, _, { DB, onEnter }) => {
			try {
				const isDev =
					process.env.NODE_ENV === 'development' ||
					process.env.ENV === 'development';

				email = normalizeEmail(email);
				name = normalizeName(name);
				password = typeof password === 'string' ? password : '';

				if (!email) return { error: 'Email is required.' };
				if (!isValidEmail(email)) return { error: 'Please enter a valid email address.' };

				let user = await DB.reuse('users', { email });

				// enter
				if (Object.keys(user).length !== 0) {
					if (!isDev && !password) return { error: 'Password is required.' };

					// bcrypt compare needs strings; if user.password missing, treat as invalid
					if (typeof user.password !== 'string' || user.password.length === 0) {
						return { error: 'Invalid email or password' };
					}

					const validPassword = await bcryptjs.compare(password, user.password);
					if (validPassword) return { token: await createSession(DB, user) };

					return { error: 'Invalid email or password' };
				}

				// create account:
				if (!name) return { error: 'Name is required.' };
				if (name.length > 20) return { error: 'Name must be 20 characters or less.' };

				if (!isDev) {
					if (!password) return { error: 'Password is required.' };
					if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
				}

				const saltRounds = 10;
				const salt = await bcryptjs.genSalt(saltRounds);
				const hashedPassword = await bcryptjs.hash(password, salt);

				user.email = email;
				user.name = name;
				user.password = hashedPassword;

				await DB.reuse('state', { user: user.query.uuid });
				await onEnter({ email, name, user });

				return { token: await createSession(DB, user) };
			} catch (error) {
				return { error: 'An internal error occurred, please try again later.' };
			}
		},
	};
};
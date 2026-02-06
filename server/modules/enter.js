// Enter.js (ODB + Destam UUID.toHex tokens/ids)
import bcryptjs from 'bcryptjs';
import { OObject } from 'destam';
import UUID from 'destam/UUID.js';

const normalizeEmail = email =>
	typeof email === 'string' ? email.trim().toLowerCase() : '';

const normalizeName = name =>
	typeof name === 'string' ? name.trim() : '';

const isValidEmail = email =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const createSession = async (odb, user) => {
	const expires = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
	const token = UUID().toHex();

	if (!user?.uuid) throw new Error('createSession: user.uuid missing');

	const session = await odb.open({
		collection: 'sessions',
		query: { uuid: token },
		value: OObject({
			uuid: token,
			user: user.uuid,
			expires,
			status: true,
		}),
	});

	await session.$odb.flush();
	return token;
};

export default () => {
	return {
		authenticated: false,

		onMsg: async ({ email, name, password }, { odb, onEnter }) => {
			if (!odb) throw new Error('Enter.js: odb not provided');

			try {
				const isDev =
					process.env.NODE_ENV === 'development' ||
					process.env.ENV === 'development';

				email = normalizeEmail(email);
				name = normalizeName(name);
				password = typeof password === 'string' ? password : '';

				if (!email) return { error: 'Email is required.' };
				if (!isValidEmail(email)) return { error: 'Please enter a valid email address.' };

				const user = await odb.findOne({ collection: 'users', query: { email } });

				// Login
				if (user) {
					if (!isDev && !password) return { error: 'Password is required.' };

					if (typeof user.password !== 'string' || user.password.length === 0) {
						return { error: 'Invalid email or password' };
					}

					const validPassword = await bcryptjs.compare(password, user.password);
					if (!validPassword) return { error: 'Invalid email or password' };

					return { token: await createSession(odb, user) };
				}

				// Signup
				if (!name) return { error: 'Name is required.' };
				if (name.length > 20) return { error: 'Name must be 20 characters or less.' };

				if (!isDev) {
					if (!password) return { error: 'Password is required.' };
					if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
				}

				const saltRounds = 10;
				const salt = await bcryptjs.genSalt(saltRounds);
				const hashedPassword = await bcryptjs.hash(password, salt);

				const userUuid = UUID().toHex();

				const newUser = await odb.open({
					collection: 'users',
					query: { uuid: userUuid },
					value: OObject({
						uuid: userUuid,
						email,
						name,
						password: hashedPassword,
					}),
				});

				await newUser.$odb.flush();

				const state = await odb.open({
					collection: 'state',
					query: { user: userUuid },
					value: OObject({ user: userUuid }),
				});

				await state.$odb.flush();

				if (onEnter) await onEnter({ email, name, user: newUser });

				return { token: await createSession(odb, newUser) };
			} catch (error) {
				console.error('enter.js error:', error);
				return { error: 'An internal error occurred, please try again later.' };
			}
		},
	};
};

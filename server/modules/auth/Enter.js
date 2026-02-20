import bcryptjs from 'bcryptjs';
import { OObject } from 'destam';
import UUID from 'destam/UUID.js';

const isValidEmail = email =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isDevEnv = () =>
	process.env.NODE_ENV === 'development' ||
	process.env.ENV === 'development';

const createSession = async (odb, userId) => {
	const token = UUID().toHex();
	const expires = Date.now() + 1000 * 60 * 60 * 24 * 30;

	const session = await odb.open({
		collection: 'sessions',
		// session documents are keyed by uuid in index for lookup, and also stored as state.uuid
		query: { uuid: token },
		value: OObject({
			uuid: token,
			user: userId,
			expires,
			status: true,
		}),
	});

	await session.$odb.flush();
	return token;
};

export default () => ({
	authenticated: false,

	onMsg: async ({ email, name, password }, { odb, onEnter }) => {
		if (!odb) throw new Error('Enter.js: odb not provided');

		const isDev = isDevEnv();

		email = typeof email === 'string' ? email.trim().toLowerCase() : '';
		name = typeof name === 'string' ? name.trim() : '';
		password = typeof password === 'string' ? password : '';

		if (!email) return { error: 'Email is required.' };
		if (!isValidEmail(email)) return { error: 'Please enter a valid email address.' };

		try {
			const user = await odb.findOne({ collection: 'users', query: { email } });

			// login
			if (user) {
				const userId = user.$odb?.key || user.uuid; // new system prefers key; keep uuid fallback
				if (!userId) return { error: 'Invalid user record (missing id).' };

				if (!isDev && !password) return { error: 'Password is required.' };
				if (typeof user.password !== 'string' || !user.password) {
					return { error: 'Invalid email or password' };
				}

				const ok = await bcryptjs.compare(password, user.password);
				if (!ok) return { error: 'Invalid email or password' };

				return { token: await createSession(odb, userId) };
			}

			// signup
			if (!name) return { error: 'Name is required.' };
			if (name.length > 20) return { error: 'Name must be 20 characters or less.' };

			if (!isDev) {
				if (!password) return { error: 'Password is required.' };
				if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
			}

			const hashedPassword = await bcryptjs.hash(password, 10);

			const newUser = await odb.open({
				collection: 'users',
				value: OObject({
					email,
					name,
					password: hashedPassword,
					createdAt: Date.now(),
					modifiedAt: Date.now(),
				}),
			});
			await newUser.$odb.flush();

			const userId = newUser.$odb?.key;
			if (!userId) return { error: 'user_create_failed_no_id' };

			const state = await odb.open({
				collection: 'state',
				query: { user: userId },          // state is keyed by index.user
				value: OObject({ user: userId }),
			});
			await state.$odb.flush();

			await onEnter?.({ email, name, user: newUser });

			return { token: await createSession(odb, userId) };
		} catch (error) {
			console.error('enter.js error:', error);
			return { error: 'An internal error occurred, please try again later.' };
		}
	},
});
import bcryptjs from 'bcryptjs';
import { OObject } from 'destam';
import UUID from 'destam/UUID.js';

const isValidEmail = email =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const createSession = async (odb, user) => {
	if (!user?.uuid) throw new Error('createSession: user.uuid missing');

	const token = UUID().toHex();
	const expires = Date.now() + 1000 * 60 * 60 * 24 * 30;

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

export default () => ({
	authenticated: false,

	onMsg: async ({ email, name, password }, { odb, onEnter }) => {
		if (!odb) throw new Error('Enter.js: odb not provided');

		const isDev =
			process.env.NODE_ENV === 'development' ||
			process.env.ENV === 'development';

		email = typeof email === 'string' ? email.trim().toLowerCase() : '';
		name = typeof name === 'string' ? name.trim() : '';
		password = typeof password === 'string' ? password : '';

		if (!email) return { error: 'Email is required.' };
		if (!isValidEmail(email)) return { error: 'Please enter a valid email address.' };

		try {
			const user = await odb.findOne({ collection: 'users', query: { email } });

			// login
			if (user) {
				if (!isDev && !password) return { error: 'Password is required.' };
				if (typeof user.password !== 'string' || !user.password) {
					return { error: 'Invalid email or password' };
				}

				const ok = await bcryptjs.compare(password, user.password);
				if (!ok) return { error: 'Invalid email or password' };

				return { token: await createSession(odb, user) };
			}

			// signup
			if (!name) return { error: 'Name is required.' };
			if (name.length > 20) return { error: 'Name must be 20 characters or less.' };

			if (!isDev) {
				if (!password) return { error: 'Password is required.' };
				if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
			}

			const userUuid = UUID().toHex();
			const hashedPassword = await bcryptjs.hash(password, 10);

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

			await onEnter?.({ email, name, user: newUser });

			return { token: await createSession(odb, newUser) };
		} catch (error) {
			console.error('enter.js error:', error);
			return { error: 'An internal error occurred, please try again later.' };
		}
	},
});

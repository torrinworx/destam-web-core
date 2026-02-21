import bcryptjs from 'bcryptjs';

const DEV_ENVS = new Set(['development']);
export const MIN_LENGTH = 8;

export const isDevEnv = () => {
	const env = typeof process?.env?.NODE_ENV === 'string' ? process.env.NODE_ENV.toLowerCase() : '';
	const alt = typeof process?.env?.ENV === 'string' ? process.env.ENV.toLowerCase() : '';
	return DEV_ENVS.has(env) || DEV_ENVS.has(alt);
};

export const normalizePassword = value => (typeof value === 'string' ? value : '');

export const validatePassword = (value, { isDev } = {}) => {
	const password = normalizePassword(value);
	const dev = Boolean(isDev);
	if (!dev && !password) {
		return { ok: false, error: 'Password is required.' };
	}
	if (!dev && password.length < MIN_LENGTH) {
		return { ok: false, error: `Password must be at least ${MIN_LENGTH} characters.` };
	}
	return { ok: true, value: password };
};

export const hashPassword = value => bcryptjs.hash(normalizePassword(value), 10);
export const comparePassword = (input, stored) => bcryptjs.compare(normalizePassword(input), typeof stored === 'string' ? stored : '');

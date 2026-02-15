import { Delete, OObject } from 'destam';
import { Obridge } from '../../../common/index.js';

const normalizeName = v => (typeof v === 'string' ? v.trim() : '');
const normalizeImage = v => {
	if (v == null) return null;
	if (typeof v !== 'string') return null;
	const s = v.trim();
	return s.length ? s : null;
};
const normalizeRole = v => (v === 'admin' ? 'admin' : null);
const normalizeUserId = v => (typeof v === 'string' && v.trim() ? v : null);

const ensureOObject = v => (v instanceof OObject ? v : OObject(v && typeof v === 'object' ? v : {}));
const ensurePlainObject = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const bridged = new WeakSet();

export const defaults = {
	enabled: true,
	throttleMs: 200,
	userToProfile: {
		enabled: true,
		allow: [
			['id'],
			['name'],
			['role'],
			['image'],
		],
	},
	profileToUser: {
		enabled: true,
		allow: [
			['name'],
			['image'],
		],
	},
};

const normalizeUserValue = (key, value) => {
	switch (key) {
		case 'name':
			return normalizeName(value);
		case 'role':
			return normalizeRole(value);
		case 'image':
			return normalizeImage(value);
		case 'id':
			return normalizeUserId(value);
		default:
			return value;
	}
};

export default ({ odb, webCore }) => ({
	validate: {
		table: 'state',

		register: async state => {
			if (!state || typeof state !== 'object') return;

      const cfg = ensurePlainObject(webCore?.config);
      const throttleMs = Number.isFinite(cfg.throttleMs) && cfg.throttleMs >= 0 ? Math.floor(cfg.throttleMs) : 0;

      const userToProfileCfg = ensurePlainObject(cfg.userToProfile);
      const profileToUserCfg = ensurePlainObject(cfg.profileToUser);

      const userToProfileEnabled = userToProfileCfg.enabled !== false;
      const profileToUserEnabled = profileToUserCfg.enabled !== false;

			if (!userToProfileEnabled && !profileToUserEnabled) return;

			state.profile = ensureOObject(state.profile);
			const profile = state.profile;

			if (!('id' in profile)) profile.id = null;
			if (!('name' in profile)) profile.name = '';
			if (!('role' in profile)) profile.role = null;
			if (!('image' in profile)) profile.image = null;

			profile.name = normalizeName(profile.name);
			profile.role = normalizeRole(profile.role);
			profile.image = normalizeImage(profile.image);

			const userId = typeof state.user === 'string' && state.user ? state.user : profile.id;
			if (typeof userId !== 'string' || !userId) return;

			const user = await odb.findOne({ collection: 'users', query: { id: userId } });
			if (!user) return;

			const canonicalFromUser = () => {
				const id = user.id ?? user.$odb?.key ?? userId;
				const canonicalId = normalizeUserId(id);
				profile.id = canonicalId;
				profile.name = normalizeName(user.name);
				profile.role = normalizeRole(user.role);
				profile.image = normalizeImage(user.image);
				state.user = canonicalId;
			};

			canonicalFromUser();

			if (bridged.has(state)) return;
			bridged.add(state);

			const flushState = async () => {
				try {
					await state.$odb?.flush?.();
				} catch (err) {
					console.error('state validator flush error:', err);
				}
			};

			const flushUser = async () => {
				try {
					await user.$odb?.flush?.();
				} catch (err) {
					console.error('state validator user flush error:', err);
				}
			};

			const transform = (delta, dir) => {
				if (!delta || !Array.isArray(delta.path) || delta.path.length === 0) return null;
				const key = delta.path[0];

				if (dir === 'AtoB') {
					if (!['id', 'name', 'role', 'image'].includes(key)) return null;
					if (delta instanceof Delete) return delta;
					const normalized = normalizeUserValue(key, delta.value);
					if (key === 'id') state.user = normalized;
					return { ...delta, value: normalized };
				}

				if (dir === 'BtoA') {
					if (!['name', 'image'].includes(key)) return null;
					if (delta instanceof Delete) return delta;
					const normalized = key === 'name' ? normalizeName(delta.value) : normalizeImage(delta.value);
					return { ...delta, value: normalized };
				}

				return delta;
			};

			const userToProfileAllow = Array.isArray(userToProfileCfg.allow)
				? userToProfileCfg.allow
				: undefined;
			const profileToUserAllow = Array.isArray(profileToUserCfg.allow)
				? profileToUserCfg.allow
				: undefined;

			const stop = Obridge({
				a: user.observer,
				b: profile.observer,
				aToB: userToProfileEnabled,
				bToA: profileToUserEnabled,
				throttle: throttleMs,
				allowAtoB: userToProfileAllow,
				allowBtoA: profileToUserAllow,
				transform,
				flushA: profileToUserEnabled ? flushUser : null,
				flushB: userToProfileEnabled ? flushState : null,
			});

			return () => {
				if (stop) {
					try {
						stop();
					} catch (err) {
						console.error('state validator bridge cleanup error:', err);
					}
				}
				bridged.delete(state);
			};
		},
	},
});

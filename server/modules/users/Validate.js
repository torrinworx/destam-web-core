const normalizeEmail = email =>
	typeof email === 'string' ? email.trim().toLowerCase() : '';

const normalizeSocialLinksArray = (value) => {
	if (value === false) return false;
	const input = Array.isArray(value) ? value : [];
	const seen = new Set();
	const out = [];
	for (const entry of input) {
		if (typeof entry !== 'string') continue;
		const trimmed = entry.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
};

const socialLinksEqual = (a, b) => {
	if (a === false || b === false) return a === b;
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
};

export default () => {
	return {
		validate: {
			table: 'users',

			register: user => {
				if (!user || typeof user !== 'object') return;

				// normalize now
				const email = normalizeEmail(user.email);
				if (email && user.email !== email) user.email = email;

				const emailVerified = user.emailVerified === true;
				if (user.emailVerified !== emailVerified) user.emailVerified = emailVerified;

				user.name = typeof user.name === 'string' ? user.name.trim() : '';
				if (typeof user.password !== 'string') user.password = '';

				const applySocialLinksNormalization = () => {
					const normalized = normalizeSocialLinksArray(user.socialLinks);
					if (!socialLinksEqual(user.socialLinks, normalized)) {
						user.socialLinks = normalized;
					}
				};
				applySocialLinksNormalization();

				// keep email normalized if it changes later
				const stopEmail =
					user.observer
						?.path('email')
						.watch(() => {
							const e = normalizeEmail(user.email);
							if (e && user.email !== e) user.email = e;
						});

				const stopEmailVerified =
					user.observer
						?.path('emailVerified')
						.watch(() => {
							const v = user.emailVerified === true;
							if (user.emailVerified !== v) user.emailVerified = v;
						});

				const stopSocialLinks =
					user.observer
						?.path('socialLinks')
						.watch(() => {
							applySocialLinksNormalization();
						});

				// let the caller clean this up if they support it
				return () => {
					try { stopEmail?.(); } catch { }
					try { stopEmailVerified?.(); } catch { }
					try { stopSocialLinks?.(); } catch { }
				};
			},
		},
	};
};

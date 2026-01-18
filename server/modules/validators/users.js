const normalizeEmail = (email) =>
	typeof email === 'string' ? email.trim().toLowerCase() : '';

export default () => {
	return {
		validate: {
			table: 'users',
			register: (user) => {
				if (!user.query || typeof user.query !== 'object') user.query = {};

				const email = normalizeEmail(user.email || user.query.email);
				if (email) {
					user.email = email;
					user.query.email = email;
				}

				user.name = typeof user.name === 'string' ? user.name.trim() : '';

				if (typeof user.password !== 'string') user.password = '';

				user.observer?.path('email').watch(() => {
					const e = normalizeEmail(user.email);
					if (e && user.query.email !== e) user.query.email = e;
				});
			},
		},
	};
};

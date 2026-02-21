const normalizeEmail = email =>
	typeof email === 'string' ? email.trim().toLowerCase() : '';
const normalizeEmailVerified = value => value === true;

export default () => {
    return {
        validate: {
            table: 'users',

            register: user => {
                if (!user || typeof user !== 'object') return;

				// normalize now
				const email = normalizeEmail(user.email);
				if (email && user.email !== email) user.email = email;

				const emailVerified = normalizeEmailVerified(user.emailVerified);
				if (user.emailVerified !== emailVerified) user.emailVerified = emailVerified;

                user.name = typeof user.name === 'string' ? user.name.trim() : '';
                if (typeof user.password !== 'string') user.password = '';

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
							const v = normalizeEmailVerified(user.emailVerified);
							if (user.emailVerified !== v) user.emailVerified = v;
						});

                // let the caller clean this up if they support it
				return () => {
					try { stopEmail?.(); } catch { }
					try { stopEmailVerified?.(); } catch { }
				};
            },
        },
    };
};

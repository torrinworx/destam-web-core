const normalizeEmail = email =>
    typeof email === 'string' ? email.trim().toLowerCase() : '';

export default () => {
    return {
        validate: {
            table: 'users',

            register: user => {
                if (!user || typeof user !== 'object') return;

                // normalize now
                const email = normalizeEmail(user.email);
                if (email && user.email !== email) user.email = email;

                user.name = typeof user.name === 'string' ? user.name.trim() : '';
                if (typeof user.password !== 'string') user.password = '';

                // keep email normalized if it changes later
                const stop =
                    user.observer
                        ?.path('email')
                        .watch(() => {
                            const e = normalizeEmail(user.email);
                            if (e && user.email !== e) user.email = e;
                        });

                // let the caller clean this up if they support it
                return () => {
                    try { stop?.(); } catch { }
                };
            },
        },
    };
};

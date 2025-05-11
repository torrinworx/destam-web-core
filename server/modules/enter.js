import { OArray } from 'destam';
import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export default () => {
	return {
		authenticated: false,
		onMsg: async ({ email, password }, _, { DB, onEnter }) => {
			try {
				const user = await DB.reuse('users', { 'email': email });
				console.log(user);

				if (Object.keys(user).length != 0) {
					const validPassword = await bcryptjs.compare(password, user.password);
					if (validPassword) {
						const sessionToken = uuidv4();
						user.sessions.push(sessionToken);
						return { sessionToken };
					}
				} else {
					if (password.length < 10 && process.env.NODE_ENV === 'production') {
						return { error: 'Password must be at least 10 characters long' };
					}

					const saltRounds = 10;
					const salt = await bcryptjs.genSalt(saltRounds);
					const hashedPassword = await bcryptjs.hash(password, salt);

					user.email = email,
					user.password = hashedPassword,
					user.sessions =  OArray([])

					console.log(user.observer)
					await DB('state', { id: user.observer.id });

					const sessionToken = uuidv4();
					user.sessions.push(sessionToken);

					await onEnter({ email, user });

					return { sessionToken };
				}

				return { error: 'Invalid email or password' };
			} catch (error) {
				console.error(error)
				return { error };

			}
		},
	};
};

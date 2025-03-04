import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { ODB } from 'destam-db-core';
import { OObject, OArray } from 'destam';

export default () => {
    return {
        authenticated: false,
        init: async ({ email, password, onEnter }) => {
            try {
                const user = await ODB('mongodb', 'users', { 'email': email });
                if (user) {
                    const validPassword = await bcryptjs.compare(password, user.password);
                    if (validPassword) {
                        const sessionToken = uuidv4();
                        user.sessions.push(sessionToken);
                        return { sessionToken };
                    }
                } else {
                    if (password.length < 10 && process.env.ENV === 'production') {
                        return { error: 'Password must be at least 10 characters long' };
                    }

                    const saltRounds = 10;
                    const salt = await bcryptjs.genSalt(saltRounds);
                    const hashedPassword = await bcryptjs.hash(password, salt);

                    const userID = uuidv4();
                    const user = await ODB('mongodb', 'users', {}, OObject({
                        email: email,
                        password: hashedPassword,
                        userID: userID,
                        sessions: OArray([])
                    }));

                    await ODB('mongodb', 'state', {}, OObject({
                        userID: userID,
                    }))

                    const sessionToken = uuidv4();
                    user.sessions.push(sessionToken);

                    await onEnter({ email, userID, user });

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

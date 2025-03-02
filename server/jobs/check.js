import { ODB } from 'destam-db-core';

// Simple check to see if user exists
export default () => {
    return {
        authenticated: false,
        init: async ({ email }) => {
            try {
                const user = await ODB('mongodb', 'users', { 'email': email });
                if (user) return true;
                else return false;
            } catch (e) {
                console.log(e)
                return e;
            }
        },
    };
};

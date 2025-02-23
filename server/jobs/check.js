import { ODB } from 'destam-db-core';

// Simple check to see if user exists
export default () => {
    return {
        authenticated: false,
        init: async ({ email }) => {
            try {
                const user = await ODB('mongodb', 'users', { 'email': email });
                if (user) return { status: 'success', exists: true };
                else return { status: 'success', exists: false }
            } catch (e) {
                console.log(e)
                return { status: 'error', error: e };
            }
        },
    };
};

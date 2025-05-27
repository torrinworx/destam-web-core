export default () => {
	return {
		authenticated: false,
		onMsg: async ({ email }, _, { DB }) => {
			try {
				const user = await DB.query('users', { 'email': email });
				if (user) return true;
				else return false;
			} catch (e) {
				console.log(e)
				return e;
			}
		},
	};
};

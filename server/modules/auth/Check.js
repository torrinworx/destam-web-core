export default () => {
	return {
		authenticated: false,
		onMsg: async ({ email }, { odb }) => {
			try {
				const user = await odb.findOne({
					collection: 'users',
					query: { email },
				});

				return !!user;
			} catch (e) {
				console.log(e);
				return e;
			}
		},
	};
};

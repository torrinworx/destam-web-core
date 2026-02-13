const isPlainObject = (v) =>
	v && typeof v === 'object' && (v.constructor === Object || Object.getPrototypeOf(v) === null);

const toUserId = (user) =>
	user?.$odb?.key ?? user?.observer?.id?.toHex?.() ?? null;

const toArray = (input) => {
	if (input == null) return null;
	if (Array.isArray(input)) return input;
	if (typeof input?.[Symbol.iterator] === 'function') return [...input];
	return null;
};

const serializePost = (post) => {
	const out = JSON.parse(JSON.stringify(post));
	if (!isPlainObject(out)) return { id: post.$odb?.key ?? null };
	out.id = post.$odb?.key ?? out.id;
	return out;
};

export default () => ({
	authenticated: false,

	onMsg: async (props, ctx) => {
		const p = props || {};
		const odb = ctx?.odb;
		if (!odb) throw new Error('posts/Read: odb not provided');

		const deleted = p?.deleted === true;
		const userId = toUserId(ctx?.user);

		if (deleted && !userId) {
			return { error: 'Unauthorized' };
		}

		const id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : null;
		const ids = toArray(p.ids);

		const limit = Number.isFinite(p.limit) ? Math.max(0, Math.floor(p.limit)) : undefined;
		const skip = Number.isFinite(p.skip) ? Math.max(0, Math.floor(p.skip)) : undefined;

		const filter = {};
		filter['index.deleteAt'] = deleted ? { $exists: true } : { $exists: false };
		if (deleted) filter['index.user'] = userId; // strict: only caller's deleted posts

		if (id) {
			filter['index.id'] = id;
			const post = await odb.driver.findOne({ collection: 'posts', filter });
			if (!post) return false;

			const out = serializePost(post);
			await post.$odb.dispose();
			return out;
		}

		if (ids) {
			const clean = ids.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
			if (clean.length === 0) return [];

			filter['index.id'] = { $in: clean };
			const posts = await odb.driver.findMany({ collection: 'posts', filter });
			const map = new Map();
			for (const post of posts) {
				const pid = post.$odb?.key;
				map.set(pid, serializePost(post));
				await post.$odb.dispose();
			}

			// align output to input order
			return clean.map(pid => map.get(pid) ?? null);
		}

		// list deleted posts only when explicitly requested
		if (!deleted) {
			return [];
		}

		const options = {};
		if (typeof limit === 'number') options.limit = limit;
		if (typeof skip === 'number') options.skip = skip;

		const posts = await odb.driver.findMany({ collection: 'posts', filter, options });
		const out = [];
		for (const post of posts) {
			out.push(serializePost(post));
			await post.$odb.dispose();
		}
		return out;
	},
});

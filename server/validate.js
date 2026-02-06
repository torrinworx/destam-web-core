export const createValidation = odb => {
	if (!odb) throw new Error('createValidation(odb): odb is required');

	const validators = new Map(); // collection -> Set<fn>
	const validated = new WeakSet(); // doc -> validated once per process lifetime

	const cleanupMap = new WeakMap(); // doc -> Array<fn>
	const patched = new WeakSet(); // doc -> patched $odb.dispose/remove

	const registerValidator = (collection, fn) => {
		if (typeof collection !== 'string' || !collection) throw new Error('collection must be a non-empty string');
		if (typeof fn !== 'function') throw new Error('validator must be a function');

		let set = validators.get(collection);
		if (!set) validators.set(collection, (set = new Set()));
		set.add(fn);

		return () => set.delete(fn);
	};

	const addCleanup = (doc, ret) => {
		if (!ret) return;

		const list = cleanupMap.get(doc) ?? [];
		const push = fn => {
			if (typeof fn === 'function') list.push(fn);
		};

		if (typeof ret === 'function') push(ret);
		else if (Array.isArray(ret)) for (const item of ret) addCleanup(doc, item);

		if (list.length) cleanupMap.set(doc, list);
	};

	const runCleanups = doc => {
		const list = cleanupMap.get(doc);
		if (!list) return;

		cleanupMap.delete(doc);
		for (const fn of list) {
			try { fn(); } catch (e) { console.error('validator cleanup error:', e); }
		}
	};

	const patchDocHandle = doc => {
		if (!doc || typeof doc !== 'object') return;
		if (!doc.$odb || patched.has(doc)) return;

		patched.add(doc);

		// best-effort: if $odb is frozen/non-writable, skip patching
		try {
			const origDispose = typeof doc.$odb.dispose === 'function' ? doc.$odb.dispose.bind(doc.$odb) : null;
			const origRemove = typeof doc.$odb.remove === 'function' ? doc.$odb.remove.bind(doc.$odb) : null;

			if (origDispose) {
				doc.$odb.dispose = async (...args) => {
					runCleanups(doc);
					return await origDispose(...args);
				};
			}

			if (origRemove) {
				doc.$odb.remove = async (...args) => {
					runCleanups(doc);
					return await origRemove(...args);
				};
			}
		} catch {
			// ignore
		}
	};

	const validate = async (collection, doc) => {
		if (!doc) return null;
		if (typeof doc !== 'object') return doc;

		// ODB caches docs, so this is effectively once per document per process
		if (validated.has(doc)) return doc;

		const set = validators.get(collection);
		if (set) {
			for (const fn of set) {
				// compat: returning true means "reject"
				const ret = await fn(doc);

				// allow validators to return cleanup(s)
				addCleanup(doc, ret);

				if (ret === true) return null;
			}
		}

		patchDocHandle(doc);
		validated.add(doc);
		return doc;
	};

	// Create a validated wrapper that still behaves like odb (driver, etc via prototype)
	const vodb = Object.create(odb);

	vodb.open = async ({ collection, query, value }) =>
		validate(collection, await odb.open({ collection, query, value }));

	vodb.findOne = async ({ collection, query }) =>
		validate(collection, await odb.findOne({ collection, query }));

	vodb.findMany = async ({ collection, query, options }) => {
		const docs = await odb.findMany({ collection, query, options });
		for (let i = 0; i < docs.length; i++) docs[i] = await validate(collection, docs[i]);
		return docs.filter(Boolean);
	};

	// passthrough
	vodb.remove = args => odb.remove(args);
	vodb.close = () => odb.close();

	return { odb: vodb, registerValidator, validate };
};

export default createValidation;

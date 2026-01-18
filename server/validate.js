export const createValidation = (db) => {
	const validators = new Map(); // table -> Set<fn>
	const validated = new WeakSet(); // doc -> validated once per process lifetime

	const registerValidator = (table, fn) => {
		if (typeof table !== 'string' || !table) throw new Error('table must be a non-empty string');
		if (typeof fn !== 'function') throw new Error('validator must be a function');

		let set = validators.get(table);
		if (!set) validators.set(table, (set = new Set()));
		set.add(fn);

		return () => set.delete(fn);
	};

	const validate = async (table, doc) => {
		if (!doc) return null;
		if (typeof doc !== 'object') return doc;

		if (validated.has(doc)) return doc;

		const set = validators.get(table);
		if (set) {
			for (const fn of set) {
				// compat w/ your old behavior: truthy => reject
				if (await fn(doc)) return null;
			}
		}

		validated.add(doc);
		return doc;
	};

	const DB = async (table, query) => {
		return await validate(table, await db(table, query));
	};

	// passthrough stuff
	for (const k of Object.keys(db)) DB[k] = db[k];

	DB.reuse = async (table, query) => {
		return await validate(table, await db.reuse(table, query));
	};

	// Optional: validate instance() only if caller provides table
	DB.instance = async (storeOrQuery, table = null) => {
		const doc = await db.instance(storeOrQuery);
		return table ? validate(table, doc) : doc;
	};

	DB.registerValidator = registerValidator;
	DB.validate = validate;

	return { DB, registerValidator, validate };
};

export default createValidation;

export const defaults = {
	// If set to false, the scheduler module will not register any jobs.
	schedule: {
		// Run every 30 days by default.
		// Users can override via moduleConfig['posts/Scheduler'].schedule.every (ms) or .schedule.cron.
		every: 1000 * 60 * 60 * 24 * 30,
		runOnStart: false,
		tz: 'UTC',
	},

	// Max number of posts to delete per tick.
	batchSize: 500,
};

const normalizeEvery = (every, fallback) => {
	if (typeof every === 'number' && Number.isFinite(every) && every > 0) return every;
	if (typeof every === 'string') {
		const n = Number(every.trim());
		if (Number.isFinite(n) && n > 0) return n;
	}
	return fallback;
};

export default ({ webCore }) => {
	const cfg = webCore?.config || {};

	// Allow disabling schedule without disabling the whole module.
	if (cfg.schedule === false) return {};

	// The module system has already merged defaults with user config through deepMerge()
	// cfg now contains the final merged configuration
	const scheduleCfg = cfg.schedule || {};

	// Use the merged config directly - all validation already done by module system
	const batchSize = Number.isFinite(cfg.batchSize) && cfg.batchSize > 0
		? Math.floor(cfg.batchSize)
		: defaults.batchSize;

	const tz = typeof scheduleCfg.tz === 'string' && scheduleCfg.tz.trim()
		? scheduleCfg.tz.trim()
		: defaults.schedule.tz;

	const runOnStart = scheduleCfg.runOnStart === true;
	const cron = typeof scheduleCfg.cron === 'string' && scheduleCfg.cron.trim()
		? scheduleCfg.cron.trim()
		: null;

	const every = cron
		? null
		: normalizeEvery(scheduleCfg.every, defaults.schedule.every);

	const findExpiredBatch = async (odb, now) => {
		// MongoDB driver supports dot paths + operators; in-memory and IndexedDB drivers do not.
		// So we try the Mongo-style filter first, then fall back to a full scan predicate.
		let posts = [];
		try {
			posts = await odb.driver.findMany({
				collection: 'posts',
				filter: { 'index.deleteAt': { $lte: now } },
				options: { limit: batchSize },
			});
		} catch {
			posts = [];
		}

		if (posts.length > 0) return posts;

		try {
			posts = await odb.driver.findMany({
				collection: 'posts',
				filter: (rec) => {
					const t = rec?.index?.deleteAt;
					return typeof t === 'number' && t <= now;
				},
				options: { limit: batchSize },
			});
		} catch {
			posts = [];
		}

		return posts;
	};

	const cleanup = async ({ odb }) => {
		if (!odb) throw new Error('posts/Scheduler: odb not provided');

		const now = Date.now();
		let deleted = 0;

		for (;;) {
			const posts = await findExpiredBatch(odb, now);
			if (!posts || posts.length === 0) break;

			for (const post of posts) {
				// $odb.remove() disposes the handle too.
				await post.$odb.remove();
				deleted++;
			}

			// If we didn't fill the batch, we likely drained all matches.
			if (posts.length < batchSize) break;
		}

		return { ok: true, deleted };
	};

	return {
		schedule: {
			name: 'cleanup',
			fn: cleanup,
			runOnStart,
			tz,
			...(cron ? { cron } : { every }),
		},
	};
};

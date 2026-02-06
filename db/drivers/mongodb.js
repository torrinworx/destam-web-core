import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

const ensureIndex = async (col) => {
	await col.createIndex({ key: 1 }, { unique: true });
};

const isPlainObject = v =>
	v && typeof v === 'object' && (v.constructor === Object || Object.getPrototypeOf(v) === null);

const withDotNotation = (obj, prefix = '') => {
	const out = {};
	for (const [k, v] of Object.entries(obj || {})) {
		const key = prefix ? `${prefix}.${k}` : k;

		if (isPlainObject(v)) {
			Object.assign(out, withDotNotation(v, key));
		} else {
			out[key] = v;
		}
	}
	return out;
};

export default async function mongodbDriver({
	// test mode (like your older driver)
	test = false,

	// prod mode: can be passed explicitly, or pulled from env like old driver
	uri = process.env.DB,
	dbName = process.env.DB_TABLE,

	// test mode defaults
	testDbName = 'webcore',

	// mongo client + collections
	clientOptions = { serverSelectionTimeoutMS: 1000 },
	collectionPrefix = '',

	// change stream options
	enableWatch = true,
	fullDocument = 'updateLookup',
} = {}) {
	let mongoServer = null;

	if (!test) {
		if (!uri) throw new Error('mongodbDriver: missing DB (uri). Set opts.uri or env DB.');
		if (!dbName) throw new Error('mongodbDriver: missing DB_TABLE (dbName). Set opts.dbName or env DB_TABLE.');
	} else {
		mongoServer = await MongoMemoryServer.create();
		uri = mongoServer.getUri();
		dbName = testDbName;
	}

	const client = new MongoClient(uri, clientOptions);
	await client.connect();

	const db = client.db(dbName);

	// cache collections and ensure indexes once
	const colCache = new Map();
	const getCol = async (name) => {
		const colName = `${collectionPrefix}${name}`;
		let entry = colCache.get(colName);
		if (!entry) {
			const col = db.collection(colName);
			entry = { col, ready: ensureIndex(col) };
			colCache.set(colName, entry);
		}
		await entry.ready;
		return entry.col;
	};

	const api = {
		async create({ collection, record }) {
			if (!collection) throw new Error('mongodbDriver.create: missing collection');
			if (!record?.key) throw new Error('mongodbDriver.create: record.key required');

			const col = await getCol(collection);

			await col.insertOne({
				key: record.key,
				state_tree: record.state_tree,
				index: record.index,
			});

			return { key: record.key, state_tree: record.state_tree, index: record.index };
		},

		async get({ collection, key }) {
			const col = await getCol(collection);

			const doc = await col.findOne(
				{ key },
				{ projection: { _id: 0, key: 1, state_tree: 1, index: 1 } }
			);

			return doc || false;
		},

		async update({ collection, key, record }) {
			const col = await getCol(collection);

			const res = await col.updateOne(
				{ key },
				{
					$set: {
						key,
						state_tree: record.state_tree,
						index: record.index,
					},
				},
				{ upsert: false }
			);

			return res.matchedCount > 0;
		},

		async remove({ collection, key }) {
			const col = await getCol(collection);
			const res = await col.deleteOne({ key });
			return res.deletedCount > 0;
		},

		async queryOne({ collection, query }) {
			const col = await getCol(collection);

			// Query against record.index with dot notation for nested objects
			const filter = withDotNotation(query, 'index');

			const doc = await col.findOne(filter, {
				projection: { _id: 0, key: 1, state_tree: 1, index: 1 },
				sort: { _id: 1 },
			});

			return doc || false;
		},

		async queryMany({ collection, query, options }) {
			const col = await getCol(collection);
			const filter = withDotNotation(query, 'index');

			const limit = options?.limit ?? 0;

			const cursor = col.find(filter, {
				projection: { _id: 0, key: 1, state_tree: 1, index: 1 },
				sort: { _id: 1 },
			});

			if (limit && limit !== Infinity) cursor.limit(limit);

			return await cursor.toArray();
		},

		async watch({ collection, key, onRecord }) {
			if (!enableWatch) return () => { };
			if (typeof onRecord !== 'function') throw new Error('mongodbDriver.watch: onRecord must be a function');

			const col = await getCol(collection);

			const startPollingWatch = () => {
				let stopped = false;
				let lastJson;
				let initialized = false;

				const tick = async () => {
					if (stopped) return;

					const rec = await api.get({ collection, key });
					const json = rec ? JSON.stringify(rec) : 'null';

					// prime without emitting (prevents overwriting local state on startup)
					if (!initialized) {
						initialized = true;
						lastJson = json;
						return;
					}

					if (json !== lastJson) {
						lastJson = json;
						onRecord(rec || null);
					}
				};

				const timer = setInterval(() => tick().catch(() => { }), 25);
				tick().catch(() => { }); // ok to prime immediately now

				return () => {
					stopped = true;
					clearInterval(timer);
				};
			};

			// In test mode: always poll (avoids change stream weirdness)
			if (test) return startPollingWatch();

			let closed = false;
			let stopPoll = null;
			let stream = null;

			try {
				stream = col.watch([{ $match: { 'fullDocument.key': key } }], { fullDocument });
			} catch {
				return startPollingWatch();
			}

			stream.on('change', (change) => {
				if (closed) return;
				if (!change.fullDocument) return onRecord(null);

				const { key, state_tree, index } = change.fullDocument;
				onRecord({ key, state_tree, index });
			});

			stream.on('error', () => {
				if (!closed) {
					// fallback to polling in prod too if you want:
					stopPoll = startPollingWatch();
				}
			});

			return async () => {
				closed = true;
				try { if (stopPoll) stopPoll(); } catch { }
				try { if (stream) await stream.close(); } catch { }
			};
		},

		async close() {
			try { await client.close(); } catch { }
			if (mongoServer) {
				try { await mongoServer.stop(); } catch { }
			}
		},
	};

	return api;
}

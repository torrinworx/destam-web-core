import binaryDriver from '../util/binaryDriver.js';
import OObject from 'destam/Object.js';
import { assert } from 'destam/util.js';

/**
 * Compare the "persistent" object within a stored doc against a given query.
 * This is akin to a subset check. If `doc.persistent[someKey] === query[someKey]`
 * for all keys, a match is found.
 *
 * @param {Object} persistent The object to check against the query.
 * @param {Object} query The query object with key-value pairs to check against the persistent object.
 * @returns {boolean} `true` if all query criteria match the persistent object, `false` otherwise.
 */
const compareQuery = (persistent, query) => {
	if (!persistent) return false;
	for (const [key, value] of Object.entries(query)) {
		// navigate using dot-notation:
		let cur = persistent;
		const path = key.split('.');
		for (const part of path) {
			if (cur && typeof cur === 'object') {
				cur = cur[part];
			} else {
				cur = undefined;
			}
		}

		// if doc's property is an array, require the queried value to be in the array:
		if (Array.isArray(cur)) {
			if (!cur.includes(value)) {
				return false;
			}
		} else if (cur !== value) {
			// direct match otherwise
			return false;
		}
	}

	// also skip if doc is marked deleted
	if (persistent.deletedAt) {
		return false;
	}
	return true;
}

/**
 * IndexedDB driver.
 * Documents are stored in "DBTableDocsStore" and parted data in "DBTablePartsStore",
 * within a single IndexedDB database table. The same doc record can have many parted docs
 * for incremental changes, plus optionally a "cache" which is a full snapshot to avoid reapplying
 * old parted commits every time we load it.
 *
 * @param {string} table The name of the table within IndexedDB.
 * @param {boolean} [readonly=false] Determines if the driver operates in read-only mode.
 */
export default binaryDriver((table, readonly = false) => {
	assert(typeof table === 'string', 'table must be a string');

	const DOCS_STORE = 'DBTableDocsStore';
	const PARTS_STORE = 'DBTablePartsStore';

	let dbPromise = null;

	/**
	 * Opens the IDB database. If the required object stores do not exist,
	 * performs a version upgrade and creates them.
	 *
	 * @returns {Promise<IDBDatabase>} The open IndexedDB instance.
	 */
	const openDB = () => {
		if (dbPromise) return dbPromise;

		dbPromise = new Promise((resolve, reject) => {
			// open with no specified version. If upgrade is needed, it is handled below.
			const req = indexedDB.open(table);
			req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
			req.onsuccess = (evt) => {
				const db = evt.target.result;
				// Check for existence of our stores
				if (db.objectStoreNames.contains(DOCS_STORE) && db.objectStoreNames.contains(PARTS_STORE)) {
					resolve(db);
				} else {
					// we must upgrade
					const currentVersion = db.version;
					db.close();

					const req2 = indexedDB.open(table, currentVersion + 1);
					req2.onupgradeneeded = (evt2) => {
						const upgradeDB = evt2.target.result;
						if (!upgradeDB.objectStoreNames.contains(DOCS_STORE)) {
							upgradeDB.createObjectStore(DOCS_STORE, { keyPath: '_id', autoIncrement: true });
						}
						if (!upgradeDB.objectStoreNames.contains(PARTS_STORE)) {
							upgradeDB.createObjectStore(PARTS_STORE, { keyPath: '_id', autoIncrement: true });
						}
					};
					req2.onsuccess = (evt2) => resolve(evt2.target.result);
					req2.onerror = () => reject(req2.error || new Error('Failed to upgrade IndexedDB'));
				}
			};
		});

		return dbPromise;
	}

	/**
	 * Obtains a transaction and object store in the specified mode.
	 *
	 * @param {IDBDatabase} db The database object.
	 * @param {string} storeName The name of the object store.
	 * @param {string} [mode='readonly'] The transaction mode, either "readonly" or "readwrite".
	 * @returns {IDBObjectStore} The requested object store.
	 */
	const getStore = (db, storeName, mode = 'readonly') => {
		const tx = db.transaction(storeName, mode);
		return tx.objectStore(storeName);
	}

	/**
	 * Wraps a stored document into the "binaryDriver item" interface.
	 *
	 * @param {Object} doc The document to wrap.
	 * @returns {Object} An object conforming to the binaryDriver item interface.
	 */
	const makeDriverRecord = (doc) => {
		return {
			query: OObject(doc?.persistent || {}),
			currentPart: doc?.parts?.[doc.parts.length - 1] ?? null,
			id: doc?._id ?? null,

			/**
			 * Reads from the document and returns a cache and deltas.
			 *
			 * @returns {Promise<Object>} An object containing `cache` and `deltas`,
			 *                            where `cache` is a full snapshot (Uint8Array) or null,
			 *                            and `deltas` is an async iterator of parted commits.
			 */
			async read() {
				if (!doc || !doc._id) {
					return { cache: null, deltas: [] };
				}

				const db = await openDB();

				let cache = null;
				let partedIds = doc.parts || [];

				if (doc.cache?.data) {
					cache = new Uint8Array(doc.cache.data);
					if (doc.cache.find != null) {
						const index = partedIds.indexOf(doc.cache.find);
						if (index >= 0) {
							partedIds = partedIds.slice(index);
						}
					}
				}

				const partedGenerator = async function* () {
					for (const partId of partedIds) {
						const store = getStore(db, PARTS_STORE, 'readonly');
						const partReq = store.get(partId);
						const part = await new Promise((res, rej) => {
							partReq.onsuccess = () => res(partReq.result);
							partReq.onerror = () => rej(new Error('Failed to get parted doc'));
						});
						if (!part || !part.changes) continue;

						for (const commitBinary of part.changes) {
							yield new Uint8Array(commitBinary);
						}
					}
				}

				return { cache, deltas: partedGenerator(), strict: true };
			},

			/**
			 * Writes parted commits and updates the document in the docs store.
			 *
			 * @param {Object} params Parameters for the write operation.
			 * @param {Array} params.query The updates to be applied to the persistent object.
			 * @param {Uint8Array} params.commit The commit to be stored.
			 * @param {Uint8Array} params.cache A full snapshot to be used as a cache.
			 * @throws Will throw if the driver is in read-only mode.
			 */
			async write({ query, commit, cache: newCheckpoint }) {
				if (readonly) {
					throw new Error('This IndexedDB driver is in read-only mode');
				}
				const db = await openDB();

				if (!doc || doc._id == null) {
					const persistentObj = {};
					if (query) {
						for (const delta of query) {
							let ref = persistentObj;
							const pathArr = delta.path();
							for (let i = 0; i < pathArr.length - 1; i++) {
								if (!ref[pathArr[i]]) ref[pathArr[i]] = {};
								ref = ref[pathArr[i]];
							}
							ref[pathArr[pathArr.length - 1]] = delta.value;
						}
					}

					let partedId = null;
					if (commit) {
						const newPart = { changes: [commit] };
						partedId = await new Promise((res, rej) => {
							const ps = getStore(db, PARTS_STORE, 'readwrite');
							const pr = ps.add(newPart);
							pr.onsuccess = () => res(pr.result);
							pr.onerror = () => rej(new Error('Failed to create parted record'));
						});
					}

					const newDoc = {
						collection: doc?.collection || '',
						persistent: persistentObj,
						parts: partedId != null ? [partedId] : [],
					};

					if (newCheckpoint) {
						newDoc.cache = {
							find: partedId,
							date: new Date(),
							data: newCheckpoint,
						};
					}

					if (!newDoc.collection && doc?.collection) {
						newDoc.collection = doc.collection;
					}

					const ds = getStore(db, DOCS_STORE, 'readwrite');
					const newID = await new Promise((res, rej) => {
						const rq = ds.add(newDoc);
						rq.onsuccess = () => res(rq.result);
						rq.onerror = () => rej(new Error('Failed to store new doc'));
					});
					doc = { ...newDoc, _id: newID };
				} else {
					if (query) {
						for (const delta of query) {
							let ref = doc.persistent;
							const pathArr = delta.path();
							for (let i = 0; i < pathArr.length - 1; i++) {
								if (!ref[pathArr[i]]) ref[pathArr[i]] = {};
								ref = ref[pathArr[i]];
							}
							ref[pathArr[pathArr.length - 1]] = delta.value;
						}
					}

					let partedToUse = doc.parts?.[doc.parts.length - 1] ?? null;
					if (commit) {
						if (partedToUse == null) {
							partedToUse = await new Promise((res, rej) => {
								const newPart = { changes: [commit] };
								const ps = getStore(db, PARTS_STORE, 'readwrite');
								const pr = ps.add(newPart);
								pr.onsuccess = () => res(pr.result);
								pr.onerror = () => rej(new Error('Failed to create parted doc'));
							});
							doc.parts.push(partedToUse);
						} else {
							const ps = getStore(db, PARTS_STORE, 'readwrite');
							const partedRec = await new Promise((res, rej) => {
								const gr = ps.get(partedToUse);
								gr.onsuccess = () => res(gr.result);
								gr.onerror = () => rej(new Error('Failed to read parted doc for update'));
							});

							if (!partedRec) {
								partedToUse = await new Promise((res, rej) => {
									const newPart = { changes: [commit] };
									const pr = ps.add(newPart);
									pr.onsuccess = () => res(pr.result);
									pr.onerror = () => rej(new Error('Failed to create parted doc (missing)'));
								});
								doc.parts.push(partedToUse);
							} else {
								partedRec.changes.push(commit);
								await new Promise((res, rej) => {
									const pr = ps.put(partedRec);
									pr.onsuccess = () => res();
									pr.onerror = () => rej(new Error('Failed to update parted doc'));
								});
							}
						}
					}

					if (newCheckpoint) {
						const ps = getStore(db, PARTS_STORE, 'readwrite');
						partedToUse = await new Promise((res, rej) => {
							const newPart = { changes: [] };
							const pr = ps.add(newPart);
							pr.onsuccess = () => res(pr.result);
							pr.onerror = () => rej(new Error('Failed to create parted doc (for checkpoint)'));
						});
						doc.parts.push(partedToUse);

						doc.cache = {
							find: partedToUse,
							date: new Date(),
							data: newCheckpoint,
						};
					}

					const ds = getStore(db, DOCS_STORE, 'readwrite');
					await new Promise((res, rej) => {
						const putReq = ds.put(doc);
						putReq.onsuccess = () => res();
						putReq.onerror = () => rej(new Error('Failed to update doc in store'));
					});
				}
			},
		};
	}

	/**
	 * The main driver function returned by binaryDriver.
	 * Returns an async iterator that yields items matching (collectionName, query).
	 *
	 * @param {string} collectionName The name of the collection to search.
	 * @param {Object} query The query criteria to use for matching documents.
	 * @returns {AsyncIterable} An async iterator that yields documents matching the query.
	 */
	const out = (collectionName, query) => {
		if (!query) {
			const partialDoc = {
				collection: collectionName,
				persistent: {},
				parts: [],
			};
			return (async function* () {
				yield makeDriverRecord(partialDoc);
			})();
		}

		let dbRef;
		let cursor = null;
		let finished = false;

		return {
			next: async () => {
				if (finished) {
					return { done: true };
				}

				if (!dbRef) {
					dbRef = await openDB();
					const ds = getStore(dbRef, DOCS_STORE, 'readonly');
					cursor = await new Promise((resolve, reject) => {
						const rq = ds.openCursor();
						rq.onsuccess = (e) => resolve(e.target.result);
						rq.onerror = () => reject(new Error('Failed to open docs cursor'));
					});
				}

				while (cursor) {
					const docRecord = cursor.value;
					if (
						docRecord.collection === collectionName &&
						compareQuery(docRecord.persistent, query)
					) {
						const record = makeDriverRecord(docRecord);

						cursor = await new Promise((resolve, reject) => {
							cursor.continue();
							cursor.request.onsuccess = (e) => resolve(e.target.result);
							cursor.request.onerror = () => reject(new Error('Failed to continue cursor'));
						});

						return { done: false, value: record };
					} else {
						cursor = await new Promise((resolve, reject) => {
							cursor.continue();
							cursor.request.onsuccess = (e) => resolve(e.target.result);
							cursor.request.onerror = () => reject(new Error('Cursor continue error'));
						});
					}
				}

				finished = true;
				return { done: true };
			},
			return: async () => {
				finished = true;
				return { done: true };
			},
		};
	};

	/**
	 * Closes the IndexedDB database connection.
	 */
	out.close = async () => {
		const db = await openDB().catch(() => null);
		if (db) {
			db.close();
			dbPromise = null;
		}
	};

	/**
	 * Ensures any in-flight transactions are finished by reopening and closing the database.
	 */
	out.flush = async () => {
		const db = await openDB().catch(() => null);
		if (db) {
			db.close();
			dbPromise = null;
		}
	};

	/**
	 * Retrieves the driver's statistics.
	 *
	 * @returns {Object} An object containing driver statistics.
	 */
	out.stats = () => ({
		readonly,
	});

	out.readonly = readonly;
	return out;
});

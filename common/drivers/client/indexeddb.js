import { stringify } from '../../clone';

export default async () => {
	const dbName = 'webcore';
	const dbVersion = 1;
	let db;

	const openDB = async (collectionName) => {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(dbName, dbVersion);
			request.onupgradeneeded = (event) => {
				db = event.target.result;
				if (!db.objectStoreNames.contains(collectionName)) {
					db.createObjectStore(collectionName, { keyPath: '_id', autoIncrement: true });
					console.log(`Object store '${collectionName}' created.`);
				}
			};
			request.onsuccess = () => {
				db = request.result;
				resolve();
			};
			request.onerror = () => {
				reject('Failed to open IndexedDB');
			};
		});
	};

	const createStateDoc = (value) => {
		return {
			state_tree: JSON.parse(stringify(value)),
			state_json: JSON.parse(JSON.stringify(value))
		};
	};

	const transformQueryKeys = (query) => {
		const transformedQuery = {};
		for (const key in query) {
			transformedQuery[key] = query[key];
		}
		return transformedQuery;
	};

	return {
		init: async (collectionName, query, value) => {
			await openDB(collectionName);
			const transaction = db.transaction([collectionName], 'readwrite');
			const store = transaction.objectStore(collectionName);
			let dbDocument;

			if (Object.keys(query).length === 0) {
				const stateDoc = createStateDoc(value);
				const request = store.add(stateDoc);

				const result = await new Promise((resolve, reject) => {
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject('Error adding document');
				});

				dbDocument = { _id: result, ...stateDoc };
			} else {
				const transformedQuery = transformQueryKeys(query);
				dbDocument = await new Promise((resolve, reject) => {
					let found = false;
					store.openCursor().onsuccess = (event) => {
						const cursor = event.target.result;
						if (cursor) {
							const matches = Object.keys(transformedQuery).every((key) => {
								return cursor.value.state_json[key] === transformedQuery[key];
							});

							if (matches) {
								found = true;
								resolve(cursor.value);
							} else {
								cursor.continue();
							}
						} else if (!found) {
							resolve(null);
						}
					};
					store.onerror = () => reject('Error finding document');
				});

				if (!dbDocument) {
					return false;
				}
			}

			return { state_tree: dbDocument.state_tree, id: dbDocument._id };
		},

		update: async (collectionName, id, state) => {
			await openDB(collectionName);
			const transaction = db.transaction([collectionName], 'readwrite');
			const store = transaction.objectStore(collectionName);

			const result = await new Promise((resolve, reject) => {
				const request = store.put({ _id: id, ...createStateDoc(state) });
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject('Error updating document');
			});

			return result;
		}
	};
};

import { v4 as uuidv4 } from 'uuid';
import { stringify } from '../../clone.js';

// Open a connection to IndexedDB with dynamic object stores
const openDB = (dbName, version, collectionName) => {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, version);

		request.onupgradeneeded = (event) => {
			const db = event.target.result;
			if (!db.objectStoreNames.contains(collectionName)) {
				db.createObjectStore(collectionName, { keyPath: 'wcid' });
			}
		};

		request.onsuccess = (event) => {
			resolve(event.target.result);
		};

		request.onerror = (event) => {
			reject(`Failed to open IndexedDB: ${event.target.errorCode}`);
		};
	});
}

// Helper function to create the document
const createStateDoc = (wcid, value) => {
	return {
		wcid: wcid,
		state_tree: JSON.parse(stringify(value)),
		state_json: JSON.parse(JSON.stringify(value))
	};
};

// Helper function to transform queries
const transformQueryKeys = (query) => {
	const transformedQuery = {};
	for (const key in query) {
		transformedQuery[`state_json.${key}`] = query[key];
	}
	return transformedQuery;
};

export default async () => {
	const dbName = 'webcore';

	return {
		init: async (collectionName, query, value) => {
			const db = await openDB(dbName, 1, collectionName);
			let dbDocument;
			const transaction = db.transaction(collectionName, 'readwrite');
			const store = transaction.objectStore(collectionName);

			const transformedQuery = Object.keys(query).length === 0 ? query : transformQueryKeys(query);

			if (Object.keys(transformedQuery).length === 0) {
				const wcid = uuidv4();
				const stateDoc = createStateDoc(wcid, value);
				store.add(stateDoc);
				dbDocument = stateDoc;
			} else {
				dbDocument = await new Promise((resolve, reject) => {
					const request = store.openCursor();
					request.onsuccess = (event) => {
						const cursor = event.target.result;
						if (cursor) {
							const matchesQuery = Object.keys(transformedQuery).every(key => cursor.value.state_json[key] === transformedQuery[key]);
							if (matchesQuery) {
								resolve(cursor.value);
							} else {
								cursor.continue();
							}
						} else {
							resolve(null);
						}
					};
					request.onerror = () => reject('Query failed');
				});

				if (!dbDocument) {
					return false;
				}
			}

			return { state_tree: dbDocument.state_tree, id: dbDocument.wcid };
		},
		
		update: async (collectionName, wcid, state) => {
			const db = await openDB(dbName, 1, collectionName);
			const transaction = db.transaction(collectionName, 'readwrite');
			const store = transaction.objectStore(collectionName);
			const updatedDoc = createStateDoc(wcid, state);

			return new Promise((resolve, reject) => {
				const request = store.put(updatedDoc);
				request.onsuccess = () => resolve(true);
				request.onerror = () => reject('Update failed');
			});
		}
	};
};

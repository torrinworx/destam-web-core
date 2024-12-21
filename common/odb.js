/*
Serves as a data storage abstraction with multiple methods of storing observers, ODB supports storage,
and querying of data. ODB has collections, each collection contains a list of documents. These documents
contain the data you wish to store.

Each document has it's own uuid. This is included in the document stored in the drivers method regardless
of it's underlying tracking methods, this is for concistency accross driver methods.

db types:
- mongodb => wrapper for mongodb
- indexddb => wrapper for indexddb, meant for storing stuff in the browser
- fs => handle data storage directly on files
- s3 => storing in s3 buckets

Each driver has a set of functions:
init() => initializes the individual ODB instances that is used within the application.
update() => Takes a document id and updates it to the provided value.
*/
import { OObject } from 'destam';
import { parse } from './clone.js';

const isClient = typeof window !== 'undefined';
let drivers = isClient ? { indexeddb: {} } : { mongodb: {}, fs: {} };

export const initODB = async () => {
	const basePath = isClient ? './drivers/client/' : './drivers/server/';

	for (const driverName in drivers) {
		try {
			let module;
			if (isClient) {
				// Use Vite's import.meta.glob for client
				const modules = import.meta.glob('./drivers/client/*.js', { eager: true });

				for (const path in modules) {
					if (path.includes(driverName)) {
						module = modules[path];
					}
				}
			} else {
				// Use dynamic imports for server
				module = await import(/* @vite-ignore */ `${basePath}${driverName}.js`);
			}

			if (module && module.default) {
				let driverInstance = module.default();

				if (driverInstance instanceof Promise) {
					driverInstance = await driverInstance;
				}

				drivers[driverName] = driverInstance;

				console.log(`${driverName} driver mounted.`);
			} else {
				throw new Error('No default export found.');
			}
		} catch (error) {
			console.warn(`Driver for ${driverName} wasn't mounted: ${error.message}. If you need this driver, check its setup is correct.`);
		}
	}
};

/*
The goal of ODB is to get rid of the confusing of when to create, search, update, and delete data in 
an underlying storage method. This abstracts that confusion and will prevent developer errors from
increasing complexity in applications.

collection: collection name to search for the document.
query: query to search for the correct document within the specified collection.
value: the default value of the doucment if no query is specified and creating a new document.
*/
export const ODB = async (driver, collection, query, value = OObject({})) => {
	driver = drivers[driver]
	const { state_tree, id } = await driver.init(collection, query, value)

	if (state_tree) {
		const state = parse(JSON.stringify(state_tree));
		state.observer.watch(async () => {
			await driver.update(collection, id, state)
		});
		return state;
	} else return false;
};

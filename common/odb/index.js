// Serves as a data storage abstraction with multiple methods of storing observers
/*
ODB supports storage, and querying of data. 

ODB has collections, each collection contains a list of documents. These documents contain the data you wish to store.

Each document has it's own uuid. This is included in the document stored in the drivers method regardless of it's underlying tracking methods,
this is for concistency accross driver methods.

db types:
- mongodb => wrapper for mongodb
- indexddb => wrapper for indexddb, meant for storing stuff in the browser
- fs => handle data storage directly on files
- s3 => storing in s3 buckets

Each driver has a set of functions:
init() => initializes the individual ODB instances that is used within the application.
update() => Takes a document id and updates it to the provided value.
*/
import { OObject } from "destam";
import { parse } from "../clone.js";

let drivers = {
    indexeddb: {},
    mongodb: {},
    fs: {},
}; // An object of all the mounted drivers and their methods, similar to jobs.js. their keys are the driver names (file names without extensions), and the values are a list of the functions they export:

// init the an ODB given the driver found in ./drivers that matches ./drivers/<driver>.js and run it's init() function.
// Dynamically imports a driver from the ./drivers folder

// Determines the environment: true for client, false for server
const isClient = typeof window !== 'undefined';

// Initializes appropriate drivers based on the environment
export const initODB = async () => {
    for (const driverName in drivers) {
        try {
            const module = await import(`./drivers/${driverName}.js`);
            try {
                if (module && module.default) {
                    let driverInstance = module.default();

                    if (driverInstance instanceof Promise) {
                        driverInstance = await driverInstance;
                    }

                    const driverType = driverInstance.type;
                    if ((isClient && driverType === "client") || (!isClient && driverType === "server")) {
                        const { type, ...driverMethods } = driverInstance;
                        drivers[driverName] = driverMethods;
                        console.log(`${driverName} driver mounted.`);
                    }
                } else {
                    throw new Error('No default export found.');
                }
            } catch (error) {
                console.warn(`Error executing default export function for ${driverName}: ${error.message}. Ensure the driver setup is correct.`);
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

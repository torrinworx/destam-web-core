/* Mongodb observer storage
The idea here is this: An observers data is stored in a single document.

Problem: for something like user sessions and other data nested in an observer
how do we search for it inside mongodb when it's stored as a single string?

{
  "_id": {
    "$oid": "672d07f876789e711b207dd8"
  },
  "userId": [],
  "state": "{\n  \"OBJECT_TYPE\": \"observer_object\",\n  \"id\": \"#2F46183FFCFAD0D366AA2CF507E72343\",\n  \"vals\": []\n}"
}

in the above example we have state, an OObject observer, stored as a string via the stringify method.

We need to be able to either re-design the way observers are stored in the db so that they are more searchable using mongodb's
traditional querying methods.

Right now the query will only search for 
*/

import { config } from 'dotenv';
import { OObject } from 'destam';
import { MongoClient } from 'mongodb';

import { clone, stringify, parse } from './clone.js';

config();

const dbName = process.env.DB;
const dbURL = process.env.DB_URL;
let dbClient;

export const initDB = async () => {
	dbClient = new MongoClient(dbURL, { serverSelectionTimeoutMS: 1000 });
	try {
		await dbClient.connect();
		console.log('\x1b[32mConnected to mongodb\x1b[0m');
	} catch (error) {
		console.error('Failed to connect to MongoDB:', error);
		process.exit(1);
	}
	return dbClient
};

// Stores and manages an Observer in a mongo document given the name of the table.
// if there is a default value presented
const ODB = async (collectionName, query, defaultValue = OObject({})) => {
	const db = dbClient.db(dbName);
	const collection = db.collection(collectionName);

	let dbDocument = await collection.findOne(query);

	if (!dbDocument) {
		const initialEmptyState = stringify(defaultValue);
		const result = await collection.insertOne(initialEmptyState);
		dbDocument = { ...initialEmptyState, _id: result.insertedId };
	}

	let state = parse(dbDocument.state);

	state.observer.watchCommit(async () => {
		await collection.updateOne(
			{ _id: dbDocument._id },
			{ $set: { state: stringify(clone(state)) } }
		);
	});

	return state;
};

export default ODB;

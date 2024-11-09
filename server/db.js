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

import { stringify, parse } from './clone.js';

config();

const dbURL = process.env.DB;
let dbClient;
let db;

export const initDB = async () => {
	dbClient = new MongoClient(dbURL, { serverSelectionTimeoutMS: 1000 });
	try {
		await dbClient.connect();
		console.log('\x1b[32mConnected to mongodb\x1b[0m');
	} catch (error) {
		console.error('Failed to connect to MongoDB:', error);
		process.exit(1);
	}
	db = dbClient.db('webcore');

	return dbClient
};

/*
Stores and manages an Observer in a mongo document given the name of the table.

- If no query provided, it will create a new document given the value
- Value will be ignored if query provided

How this works:
Store two versions of the state, one that is the Observer state tree, the other
is a simplified json structure stored as json that we can search via simple mongodb
query commands.

The state tree is stored in the key state_tree, and the simple json version is stored
in the state_json key of the document.

These both get updated in the db with the watchCommit. Querying takes place and is applied,
not to the whole document, but only to the state_json. So we need to handle this accordingly
by converting the queries to search the state_json as they will assume that the document is
only the state_json
*/

const createStateDoc = (value) => {
	return {
		state_tree: JSON.parse(stringify(value)),
		state_json: JSON.parse(JSON.stringify(value))
	}
}

const ODB = async (collectionName, query, value = OObject({})) => {
	const collection = db.collection(collectionName);
	let dbDocument;

	if (Object.keys(query).length === 0) {
		const stateDoc = createStateDoc(value)
		const result = await collection.insertOne(stateDoc);
		dbDocument = {
			_id: result.insertedId,
			...stateDoc
		};
	} else {
		const searchQuery = {
			"state_json.sessions": query
		};
		dbDocument = await collection.findOne(searchQuery);
		if (!dbDocument) {
			return false;
		}
	}

	let state = parse(JSON.stringify(dbDocument.state_tree));

	state.observer.watch(async () => {
		await collection.updateOne(
			{ _id: dbDocument._id },
			{
				$set: createStateDoc(state)
			}
		);
	});
	return state;
};

export default ODB;

/*
Observer Database Storage

Overview:
The goal is to store an observer's data within a single MongoDB document. The big issue with this is querying nested data, such as user sessions, which are stored as a single string or a complex observer object.

Example Document:
{
	"_id": {
		"$oid": "672d07f876789e711b207dd8"
	},
	"state": "{\n  \"OBJECT_TYPE\": \"observer_object\",\n  \"id\": \"#2F46183FFCFAD0D366AA2CF507E72343\",\n  \"vals\": []\n}"
}

The state data is stored as a stringified OObject observer, making it not feasably searchable using MongoDB's query methods.

To improve searchability, we redefine how observers are stored in the database. Instead of a single string, we store two versions of the state:
1. Observer State Tree - Stored in the `state_tree` key.
2. Simplified JSON Structure - Stored in the `state_json` key.

The `state_tree` is the serialized observer state in a json object, while `state_json` is a searchable JSON version. We update both versions in the database with each commit.

Querying involves searching only the `state_json`. So we transform queries accordingly to only target the `state_json` field.
*/

import { config } from 'dotenv';
import { OObject } from 'destam';
import { MongoClient } from 'mongodb';

import { stringify, parse } from '../common/clone.js';

config();

const dbURL = process.env.DB;
let dbClient;
let db;

/**
 * Initializes the MongoDB connection.
 * @returns {Promise<MongoClient>} A promise that resolves to the MongoDB client instance.
 */
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
	return dbClient;
};

/**
 * Creates a database document from an observer state value.
 * @param {Object} value - The observer state value.
 * @returns {Object} The document containing a state tree and its simplified JSON version used for querying.
 */
const createStateDoc = (value) => {
	return {
		state_tree: JSON.parse(stringify(value)),
		state_json: JSON.parse(JSON.stringify(value))
	};
};

/**
 * Transforms the query keys to target the 'state_json' document field.
 * @param {Object} query - The original query object.
 * @returns {Object} The transformed query object.
 */
const transformQueryKeys = (query) => {
	const transformedQuery = {};
	for (const key in query) {
		transformedQuery[`state_json.${key}`] = query[key];
	}
	return transformedQuery;
};

/**
 * Stores and manages an Observer in a MongoDB document.
 * 
 * - If no query is provided, a new document is created with the given value.
 * - Value will be ignored if a query is provided.
 *
 * @param {string} collectionName - The name of the MongoDB collection.
 * @param {Object} [query={}] - The query object for searching the document.
 * @param {OObject} [value=OObject({})] - The observer state value.
 * @returns {Promise<Object|boolean>} The observer state object or false if no document is found.
 */
const ODB = async (collectionName, query = {}, value = OObject({})) => {
	let dbDocument;
	const collection = db.collection(collectionName);

	const transformedQuery = Object.keys(query).length === 0 ? query : transformQueryKeys(query);

	if (Object.keys(transformedQuery).length === 0) {
		const stateDoc = createStateDoc(value);
		const result = await collection.insertOne(stateDoc);
		dbDocument = {
			_id: result.insertedId,
			...stateDoc
		};
	} else {
		dbDocument = await collection.findOne(transformedQuery);
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

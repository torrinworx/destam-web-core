import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

import { stringify } from '../../clone.js';

config();

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

export default async () => {
    const dbURL = process.env.DB;
    const dbClient = new MongoClient(dbURL, { serverSelectionTimeoutMS: 1000 });

    try {
        await dbClient.connect();
        console.log('\x1b[32mConnected to mongodb\x1b[0m');
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
    const db = dbClient.db('webcore');

    return {
        /*
        init():
        Takes in generic collectionName and maps it to mongodb collections.

        - if query provided, it's assumed that there is a document in the db matching
            that query.  Value will be ignored if a query is provided. If no document
            found matching query, returns error.
        - If no query is provided, a new document is created with the given value.
        */
        init: async (collectionName, query, value) => {
            let dbDocument;
            const collection = db.collection(collectionName);
            const transformedQuery = Object.keys(query).length === 0 ? query : transformQueryKeys(query);

            // No query, create doc
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
            return { state_tree: dbDocument.state_tree, id: dbDocument._id }
        },
        /*
        update():
        Takes in generic collectionName and maps it to mongodb collections.
        */
        update: async (collectionName, id, state) => {
            const collection = db.collection(collectionName);
            const result = await collection.updateOne(
                { _id: id },
                {
                    $set: createStateDoc(state)
                }
            );
            return result;
        }
    };
};

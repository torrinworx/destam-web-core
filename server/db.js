/* Mongodb observer storage
The idea here is this: An observers data is stored in a single document.
*/
import { config } from 'dotenv';
import { OObject } from 'destam';

import { clone, stringify, parse } from './clone.js';

config();

const dbName = process.env.DB_TABLE;

export default async (client, collectionName, userId, defaultValue = OObject({})) => {
	const db = client.db(dbName);
	const collection = db.collection(collectionName);

	let dbDocument = await collection.findOne({ userId: userId });

	if (!dbDocument) {
		const initialEmptyState = { userId: userId, state: stringify(defaultValue) };
		await collection.insertOne(initialEmptyState);
		dbDocument = initialEmptyState;
	}

	let state = parse(dbDocument.state);

	state.observer.watchCommit(async () => {
		await collection.updateOne(
			{ userId: userId },
			{ $set: { state: stringify(clone(state)) } },
			{ upsert: true }
		);
	});

	return state;
};

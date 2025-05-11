import {MongoClient, Binary, ObjectId} from 'mongodb';
import {assert} from 'destam/util.js';
import binaryDriver from '../util/binaryDriver.js';

import OObject from 'destam/Object.js';

export default binaryDriver((databaseLocation, table, readonly = false) => {
	assert(typeof databaseLocation === 'string', "databaseLocation must be a string");
	assert(typeof table === 'string', "table must be a string");
	assert(typeof readonly === 'boolean', "readonly must be a boolean");

	const client = new MongoClient(databaseLocation);
	const connection = client.connect();

	const database = client.db(table);
	const store = database.collection('DBTableDataStore');

	const out = (collectionName, query) => {
		const col = database.collection(collectionName);

		const create = item => ({
			query: OObject(item?.persistent),
			currentPart: item ? item.parts[item.parts.length - 1] : null,
			id: item?._id,

			read: async () => {
				let instance;
				let parts = [];
				if (item) {
					if (item.cache) {
						instance = item.cache.data.read(0, item.cache.data.length());
						parts = item.parts.slice(item.parts.findIndex(id => id.equals(item.cache.find)));
					} else {
						parts = item.parts;
					}
				}

				return {
					cache: instance,
					deltas: (async function *() {
						const cursor = await store.find({_id: { $in: parts }});
						const waitingOn = Array(parts.length).fill(null);
						let ii = 0;

						while (await cursor.hasNext()) {
							const {_id: id, changes} = await cursor.next();
							const index = parts.findIndex(i => i.equals(id));
							waitingOn[index] = changes;

							while (ii <= index) {
								const changes = waitingOn[ii];
								if (!changes) {
									break;
								}

								for (let i = 0; i < changes.length; i++) {
									const commit = changes[i];
									yield commit.read(0, commit.length());
								}

								ii++;
							}
						}
					})(),
				};
			},

			write ({query, commit, cache}) {
				const updates = [];
				const binary = commit ? new Binary(commit, 0x80) : null;

				if (!this.id) {
					this.id = new ObjectId();

					const persistent = {};
					for (const delta of query) {
						persistent[delta.path().join('.')] = delta.value;
					}

					this.currentPart = new ObjectId();
					updates.push(
						store.insertOne({_id: this.currentPart, changes: binary ? [binary] : []}),
						col.insertOne({_id: this.id, persistent, parts: [this.currentPart]}),
					);
				} else {
					if (binary) updates.push(store.updateOne(
						{_id: this.currentPart},
						{$push: {changes: binary}}
					));

					if (query || cache) {
						const update = {};
						if (query) {
							update.$set = {};

							for (const delta of query) {
								update.$set['persistent.' + delta.path().join('.')] = delta.value;
							}
						}

						if (cache) {
							update.$set = update.$set || {};

							this.currentPart = new ObjectId();
							updates.push(store.insertOne({_id: this.currentPart, changes: []}));

							update.$push = {parts: this.currentPart};
							update.$set.cache = {
								find: this.currentPart,
								date: new Date(),
								data: new Binary(cache, 0x80),
							};
						}

						updates.push(col.updateOne({_id: this.id}, update));
					}
				}

				return Promise.all(updates);
			}
		});

		if (query) {
			const lookupQuery = Object.fromEntries(Object.entries(query)
				.map(([key, val]) => ['persistent.' + key, val]));
			lookupQuery['persistent.deletedAt'] = {"$exists": false};

			let found;
			return {
				next: async () => {
					await connection;

					if (!found) {
						found = await col.find(lookupQuery);
					}

					const hasNext = await found.hasNext();
					return {
						value: hasNext ? create(await found.next()) : null,
						done: !hasNext,
					};
				},

				return: async () => {
					if (found) await found.close();
				},
			};
		} else {
			return [create()][Symbol.iterator]();
		}
	};

	out.close = async () => {
		await client.close();
	};

	out.client = client;
	out.database = connection.then(() => database);
	out.readonly = readonly;

	return out;
});

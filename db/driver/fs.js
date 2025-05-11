import {encode, decode, copy} from '../message/Message.js';
import createNetwork from 'destam/Tracking.js';
import OObject from 'destam/Object.js';
import UUID from 'destam/UUID.js';
import binaryDriver from '../util/binaryDriver.js';

import ReadStream from '../stream/read.js';
import WriteStream from '../stream/write.js';

import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';

const compareQuery = (query, elements) => {
	for (const [key, value] of elements) {
		let cur = query;
		for (const path of key) cur = cur?.[path];

		if (Array.isArray(cur)) {
			if (!cur.includes(value)) return false;
		} else if (cur !== value) {
			return false;
		}
	}

	return true;
};

export default binaryDriver(location => {
	return (table, query) => {
		const tableLocation = location + '/' + table;

		const create = async (uuid, query) => {
			let entryLocation = uuid ? tableLocation + '/' + uuid.toHex() : null;
			const qureyNetwork = createNetwork(query.observer);

			return {
				query,

				write: async ({query: queryDeltas, commit, cache}) => {
					// we are writing a brand new record for the first time
					if (!uuid) {
						uuid = UUID(query.uuid);
						entryLocation = tableLocation + '/' + uuid.toHex();
						await fs.mkdir(entryLocation);
					}

					if (commit || cache) {
						const deltasfd = await fs.open(entryLocation + '/deltas.bin', 'a');

						if (commit) {
							await deltasfd.appendFile(commit);
						}

						if (cache) {
							let {size} = await deltasfd.stat();

							const stream = WriteStream.create(createWriteStream(entryLocation + '/checkpoint.bin'));
							stream.writeUInt32LE(size);
							await stream.write(cache);
							await stream.flush(true);
						}

						await deltasfd.close();
					}

					if (queryDeltas) {
						await encode(query).then(bin => fs.writeFile(entryLocation + '/query.bin', bin));
					}
				},

				read: async () => {
					let deltasfd;

					try {
						deltasfd = await fs.open(entryLocation + '/deltas.bin');
					} catch (e) {
						// deltas file does not exist - assume there are no deltas
						return {deltas: []};
					}

					let checkpointfd, cache, ptr = 0;
					try {
						checkpointfd = await fs.open(entryLocation + '/checkpoint.bin');
						const stream = ReadStream.create(checkpointfd.createReadStream());
						await stream.ensureRead(8);

						ptr = stream.readUInt32LE();
						cache = stream;
					} catch (e) {

					}

					return {
						cache: cache,
						deltas: (async function *() {
							if (checkpointfd) {
								await checkpointfd.close();
								checkpointfd = null;
							}

							try {
								const stream = ReadStream.create(deltasfd.createReadStream({start: ptr}));

								while (!stream.closed) {
									await stream.ensureRead();
									if (stream.closed) break;

									yield stream;
								}
							} finally {
								await deltasfd.close();
							}
						})(),
					};
				},
			}
		};

		if (!query) {
			return (async function * () {
				await fs.mkdir(tableLocation).catch(() => {});

				yield await create(null, OObject());
			})();
		}

		const queryElements = [];
		let uuidLookup = null;

		for (let o in query) {
			// special case uuids to implement a fastpath
			if (o === 'uuid') {
				uuidLookup = query[o];
			} else {
				queryElements.push([o.split('.'), query[o]]);
			}
		}

		// optimize uuid lookups
		if (uuidLookup) {
			try {
				const uuid = UUID(uuidLookup);

				return (async function * () {
					let stream;
					try {
						stream = await fs.open(tableLocation + '/' + uuid.toHex() + '/query.bin');
					} catch (e) {
						return;
					}

					const queryable = await decode(stream.createReadStream());
					await stream.close();

					if (!compareQuery(queryable, queryElements)) return;
					yield await create(uuid, queryable);
				})();
			} catch (e) {
				return [][Symbol.iterator]();
			}
		}

		let dir;
		return {
			next: async () => {
				if (!dir) {
					dir = await fs.opendir(tableLocation).catch(() => null);
					if (!dir) {
						return {done: true};
					}
				}

				while (true) {
					const entry = await dir.read();
					if (!entry) {
						await dir.close();
						dir = null;

						return {done: true};
					}

					if (entry.name[0] !== '#') {
						continue;
					}

					const queryable = await decode(createReadStream(tableLocation + '/' + entry.name + '/query.bin'));
					if (!compareQuery(queryable, queryElements)) continue;

					return { value: await create(UUID(entry.name), queryable) };
				}
			},
			return: async () => {
				if (dir) await dir.close();
			},
		};
	}
});

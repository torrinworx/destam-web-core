import { copy } from '../message/Message.js';
import createNetwork from 'destam/Tracking.js';
import OObject from 'destam/Object.js';
import binaryDriver from '../util/binaryDriver.js';

/**
 * Memory backed binary driver. Similar to the dummy driver, except it lets
 * database items be reclaimed and stored in a smaller in memory buffer.
 */
export default binaryDriver(() => {
	const tables = new Map();

	return (table, query) => {
		let all = tables.get(table);
		if (!all) tables.set(table, all = []);

		if (!query) {
			const query = OObject();
			const qureyNetwork = createNetwork(query.observer);

			const item = {
				query,
				commits: [],
				written: false,

				write: ({query, commit, cache}) => {
					if (!item.written) {
						all.push(item);
						item.written = true;
					}

					if (query) {
						qureyNetwork.apply(copy(query));

						if (item.query.deletedAt) {
							const i = all.indexOf(item);
							all.splice(i, 1);
						}
					}

					if (commit) item.commits.push(commit);

					if (cache) {
						item.commits.splice(0, item.commits.length);
						item.cache = cache;
					}
				},

				read: () => ({
					cache: item.cache,
					deltas: item.commits,
					strict: true,
				}),

				user: () => ({
					// copy the query object because the underlying implementation assumes
					// they will be different. If we return the same reference,
					// it becomes possible to create duplicate deltas that will then clash
					query: copy(item.query),
					read: item.read,
					write: item.write,
				}),
			};

			return [item.user()][Symbol.iterator]();
		}

		return (async function * () {
			main:for (const item of all) {
				for (const o in query) {
					let cur = item.query;
					for (const path of o.split('.')) cur = cur?.[path];

					if (Array.isArray(cur)) {
						if (!cur.includes(query[o])) continue main;
					} else if (cur !== query[o]) {
						continue main;
					}
				}

				yield item.user();
			}
		})();
	}
});

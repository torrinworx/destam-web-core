// utility to further abstract away a lot of the details of the database to
// a simple stream of binary data. This is ideal for implementing low level
// drivers such as to real databases or the filesystem.

/*
const getStubs = () => {
	const out = [];

	for (const val of globalMappings.nameMapping.values()) {
		if (val.extend === 'o_obj') {
			out.push({type: 'o_obj', name: val.name});
		} else if (val.alloc && !val.preallocate) {
			out.push({type: 'fixed', name: val.name, alloc: val.alloc});
		}
	}

	return out;
};
*/

import {encode, decode} from '../message/Message.js';
import createNetwork from 'destam/Tracking.js';

import {assert} from 'destam/util.js';
import OObject from 'destam/Object.js';
import UUID from 'destam/UUID.js';
import Observer from 'destam/Observer.js';

import '../message/observers.js';
import '../message/primitives.js';

const MAX_DELTA_LENGTH = 512;
const SQUASH_TIME = 5000; // 5 seconds

const FLUSH_TYPE_QUERY = 1;
const FLUSH_TYPE_INSTANCE = 2;

const mapAsyncIterator = (iter, map) => ({
	next: async () => {
		const {done, value, ...props} = await iter.next();
		if (done) return {done: true, ...props};

		return {
			done: false,
			value: await map(value),
			...props,
		};
	},
	return: () => {
		if (iter.return) iter.return();
	},
});

const map = (table, isNew, currentTransactions, readonly, result) => {
	const stateGovernor = (obs) => {
		if (readonly) {
			return Observer.immutable(null);
		}

		return Observer(() => obs.get(), v => obs.set(v), (listener, governor) => obs.register_(listener, (info, child) => {
			const str = child.query_;
			if (typeof str === 'string' && str[0] === '$') return false;
			return governor(info, child);
		}));
	};

	const query = result.query;
	let network, instance, deltaLength = 0;

	let flushing = null;
	const flush = (flushType, changes, observerRefs) => {
		if (flushing) return [changes, observerRefs];

		flushing = (async () => {
			try {
				const [queryFlush, instanceFlush] = await Promise.all(
					[FLUSH_TYPE_QUERY, FLUSH_TYPE_INSTANCE].map(type => {
						if (type === flushType) {
							return Promise.resolve([changes, observerRefs]);
						}

						return [null, queryNetwork, network][type]?.flush()
							// because we only ever register one digest to the network,
							// we can just take the first one.
							.then(digests => digests[0]);
					}));

				let commit, cache;
				if (instanceFlush) {
					const cacheInstance = instance && await instance;

					commit = await encode(instanceFlush[0], null, {
						observerRefs: instanceFlush[1]
					});

					if (cacheInstance && deltaLength >= MAX_DELTA_LENGTH) {
						deltaLength = 0;
						cache = await encode(cacheInstance);
					} else {
						deltaLength++;
					}
				}

				await result.write({
					query: queryFlush?.[0],
					commit,
					cache
				});
			} finally {
				currentTransactions.delete(flushing);
				flushing = false;
			}
		})();

		currentTransactions.add(flushing);
		return flushing;
	};

	const queryNetwork = createNetwork(stateGovernor(query.observer));
	queryNetwork.digest(flush.bind(null, FLUSH_TYPE_QUERY), SQUASH_TIME);

	if (!query.uuid) {
		query.uuid = UUID().toHex();
		query.createdAt = new Date();
	}

	return {
		query,
		flush: () => {
			if (flushing) return flushing;
			return flush(0);
		},

		instance: () => {
			return instance = instance ?? (async () => {
				const {deltas, cache, strict} = isNew ? {} : await result.read();

				let instance;
				if (cache) {
					instance = await decode(cache);
					assert(UUID.compare(instance.observer.id, query.uuid));
				} else {
					instance = OObject({}, UUID(query.uuid));
				}

				network = createNetwork(stateGovernor(instance.observer));
				deltaLength = 0;

				if (deltas) {
					let failedDeltas = [];
					for await (const binary of deltas) {
						try {
							deltaLength++;
							const decoded = await decode(binary, {
								observerNetwork: network,
							});

							network.apply(decoded);
						} catch (e) {
							failedDeltas.push(e);
						}
					}

					if (failedDeltas.length) {
						const err = new Error(`failed to apply ${failedDeltas.length}/${deltaLength} deltas in ${table} for: ${query.uuid}`, {cause: failedDeltas});

						if (strict) {
							instance = null;
							throw err;
						} else {
							console.error(err);
						}
					}
				}

				network.digest(flush.bind(null, FLUSH_TYPE_INSTANCE), SQUASH_TIME);
				return instance;
			})();
		},
	};
};

export default driver => (...init) => {
	const driverInstance = driver(...init);
	const currentTransactions = new Set();

	const out = (table, queryDesc) => {
		return mapAsyncIterator(
			driverInstance(table, queryDesc),
			map.bind(null, table, !queryDesc, currentTransactions, driverInstance.readonly)
		);
	};

	Object.assign(out, driverInstance);

	out.flush = async () => {
		await Promise.all([...currentTransactions]);
	};

	out.stats = () => ({
		pendingTransactions: currentTransactions.size,
		...driverInstance.stats?.()
	});

	out.close = () => driverInstance.close?.();

	return out;
};

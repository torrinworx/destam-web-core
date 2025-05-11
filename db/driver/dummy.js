import OObject from 'destam/Object.js';
import UUID from 'destam/UUID.js';

// Dummy backend that just generates fresh database items. Combined with a cache, it
// serves as an in-memory db store.

export default () => {
	// store everything in an array so the garbage collector doesn't remove our objects.
	const memory = [];

	const out = (name, query) => {
		if (query) {
			return [][Symbol.iterator]();
		}

		const id = UUID();
		const instance = OObject({}, id);

		const item = {
			query: OObject({
				uuid: id.toHex(),
				createdAt: new Date(),
			}),
			instance: () => instance,
			flush: () => {},
		};

		memory.push(item);
		return [item][Symbol.iterator]();
	};

	out.close = out.stats = out.flush = () => {};
	out.memory = memory;

	return out;
};

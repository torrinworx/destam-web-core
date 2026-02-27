import { Delete, Insert } from 'destam';
import { indexPosition } from 'destam/Array.js';
import { getRef, observerGetter } from 'destam/Observer.js';
import * as Network from 'destam/Network.js';

const Obridge = ({
	a,
	b,

	aToB = true,
	bToA = false,

	throttle = 0,

	allowAtoB = null,
	allowBtoA = null,

	transform = null,

	flushA = null,
	flushB = null,
} = {}) => {
	let lock = 0;
	const removers = [];

	const isPrefix = (prefix, path) => {
		if (!prefix || !prefix.length) return true;
		if (!path || path.length < prefix.length) return false;
		for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
		return true;
	};

	// helper to build allow fn from a list of prefixes
	const allowFromPrefixes = (prefixes) => (delta) => {
		const p = delta?.path;
		if (!prefixes || !prefixes.length) return true;
		for (const pref of prefixes) if (isPrefix(pref, p)) return true;
		return false;
	};

	// if user passed arrays as allow*, treat as prefix lists
	const normalizeAllow = (allow) => {
		if (!allow) return null;
		if (typeof allow === 'function') return allow;
		if (Array.isArray(allow)) return allowFromPrefixes(allow);
		throw new Error('allow* must be a function or an array of path prefixes');
	};

	allowAtoB = normalizeAllow(allowAtoB);
	allowBtoA = normalizeAllow(allowBtoA);

	const insertArrayByRef = (array, ref, value) => {
		const reg = array?.[observerGetter];
		const indexes = reg?.indexes_;
		const init = reg?.init_;
		if (!reg || !indexes || !init) return false;

		const index = indexPosition(array, ref);
		const insertLink = indexes[index] ?? reg;
		const link = Network.link({ reg_: reg, query_: ref }, value?.[observerGetter], insertLink);
		indexes.splice(index, 0, link);
		init.splice(index, 0, value);

		const events = [];
		Network.linkApply(link, events, Insert, undefined, value, ref, reg.id);
		Network.callListeners(events);
		return true;
	};

	const applyDeltaByPath = (rootObserver, delta) => {
		// delta.path is an array of keys/refs from the root observable
		const path = delta.path;
		if (!Array.isArray(path) || path.length === 0) return;

		// parent object that owns the final ref
		const parentObs = rootObserver.path(path.slice(0, -1));
		const ref = path[path.length - 1];
		const parentVal = parentObs.get();

		if (Array.isArray(ref) && parentVal?.[getRef]) {
			const refInfo = parentVal[getRef](ref);
			const hasRef = Array.isArray(refInfo) && refInfo.length > 1;

			if (delta instanceof Delete) {
				if (hasRef) {
					const index = indexPosition(parentVal, ref);
					if (index >= 0) parentVal.splice(index, 1);
				}
				return;
			}

			if (hasRef) {
				refInfo[1](delta.value);
				return;
			}

			if (insertArrayByRef(parentVal, ref, delta.value)) return;

			const index = indexPosition(parentVal, ref);
			parentVal.splice(index, 0, delta.value);
			return;
		}

		if (delta instanceof Delete) {
			// for OObject, deleting a prop triggers proper delta behavior
			delete parentVal[ref];
			return;
		}

		// Insert or Modify
		parentVal[ref] = delta.value;
	};

	const wire = (src, dst, dir, allow, flush) => {
		const srcObs = throttle > 0 ? src.throttle(throttle) : src;

		return srcObs.watchCommit(async (commit) => {
			if (lock) return;
			lock++;

			try {
				for (let delta of commit) {
					if (allow && !allow(delta)) continue;

					if (transform) {
						const out = transform(delta, dir);
						if (!out) continue;
						delta = out;
					}

					applyDeltaByPath(dst, delta);
				}
			} finally {
				lock--;
			}

			if (flush) await flush();
		});
	};

	if (aToB) removers.push(wire(a, b, 'AtoB', allowAtoB, flushB));
	if (bToA) removers.push(wire(b, a, 'BtoA', allowBtoA, flushA));

	return () => removers.forEach((r) => r());
};

export default Obridge;

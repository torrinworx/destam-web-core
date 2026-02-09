import { Delete } from 'destam';

/**
 * State-tree relay bridge (commit/delta based).
 *
 * @param {Object} opts
 * @param {Observer} opts.a - root observer for tree A (usually someObservable.observer)
 * @param {Observer} opts.b - root observer for tree B
 *
 * @param {boolean} [opts.aToB=true] - forward commits A -> B
 * @param {boolean} [opts.bToA=false] - forward commits B -> A
 *
 * @param {number} [opts.throttle=0] - ms; if > 0 uses .throttle(throttle) before watchCommit
 *
 * @param {(delta:any)=>boolean} [opts.allowAtoB] - filter which deltas from A are forwarded to B
 * @param {(delta:any)=>boolean} [opts.allowBtoA] - filter which deltas from B are forwarded to A
 *
 * @param {(delta:any, dir:'AtoB'|'BtoA')=>any|null|false} [opts.transform]
 *   - return:
 *     - a (possibly modified) delta to forward
 *     - null/false to drop the delta
 *
 * @param {null|(()=>Promise<void>|void)} [opts.flushA=null] - called after writing into A
 * @param {null|(()=>Promise<void>|void)} [opts.flushB=null] - called after writing into B
 *
 * @returns {() => void} cleanup
 */
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

	const applyDeltaByPath = (rootObserver, delta) => {
		// delta.path is an array of keys/refs from the root observable
		const path = delta.path;
		if (!Array.isArray(path) || path.length === 0) return;

		// parent object that owns the final ref
		const parentObs = rootObserver.path(path.slice(0, -1));
		const ref = path[path.length - 1];

		if (delta instanceof Delete) {
			const parentVal = parentObs.get();
			// for OObject, deleting a prop triggers proper delta behavior
			delete parentVal[ref];
			return;
		}

		// Insert or Modify
		const parentVal = parentObs.get();
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

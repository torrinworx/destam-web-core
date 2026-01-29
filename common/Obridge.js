import { Observer } from 'destam';

/**
 * Bridges two Observers with optional direction(s), normalization, throttling, and loop protection.
 *
 * @param {Object} opts
 * @param {Observer} opts.a - source/side A observer
 * @param {Observer} opts.b - source/side B observer
 * @param {boolean} [opts.aToB=true] - sync A -> B
 * @param {boolean} [opts.bToA=false] - sync B -> A
 * @param {(v:any)=>any} [opts.normalizeA=(x)=>x] - normalize value read from A before writing into B
 * @param {(v:any)=>any} [opts.normalizeB=(x)=>x] - normalize value read from B before writing into A
 * @param {number} [opts.throttle=150] - ms throttle for each direction
 * @param {null|(()=>Promise<void>|void)} [opts.flushA=null] - called after writing into A (B -> A direction)
 * @param {null|(()=>Promise<void>|void)} [opts.flushB=null] - called after writing into B (A -> B direction)
 * @returns {() => void} cleanup
 */
const Obridge = ({
	a,
	b,
	aToB = true,
	bToA = false,
	normalizeA = (x) => x,
	normalizeB = (x) => x,
	throttle = 150,
	flushA = null,
	flushB = null,
}) => {
	let lock = 0;
	const removers = [];

	const wire = (src, dst, normalize, flush) =>
		src.throttle(throttle).watch(async () => {
			if (lock) return;
			lock++;

			const next = normalize(src.get());
			if (dst.get() !== next) dst.set(next);

			lock--;
			if (flush) await flush();
		});

	if (aToB) removers.push(wire(a, b, normalizeA, flushB));
	if (bToA) removers.push(wire(b, a, normalizeB, flushA));

	return () => removers.forEach(r => r());
};

export default Obridge;

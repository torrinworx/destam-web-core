import { Synthetic } from "destam/Events.js";
import Observer, { watchGovernor } from "destam/Observer.js";

export const asyncSwitch = (obs, asyncFn) => {
	let cache;

	return Observer(
		() => cache,
		null,
		(listener) => {
			const cleanupFns = [];
			let seq = 0;

			const run = () => {
				// cleanup previous run resources
				while (cleanupFns.length) cleanupFns.pop()();

				const cur = ++seq;
				let cancelled = false;
				cleanupFns.push(() => { cancelled = true; });

				Promise.resolve(asyncFn(obs.get(), fn => cleanupFns.push(fn)))
					.then((val) => {
						if (cancelled) return;
						if (cur !== seq) return; // latest wins
						listener([Synthetic(cache, (cache = val))]);
					})
					.catch(() => {
						// todo
					});
			};

			const parent = obs.register_(run, watchGovernor);
			run();

			return () => {
				parent();
				while (cleanupFns.length) cleanupFns.pop()();
			};
		}
	).memo();
};

import { createNetwork } from 'destam';
import { parse, stringify } from '../common/clone.js';

/*
Handles destam network setup and variable synchronization.
Returns a cleanup function.
*/
const sync = (state, ws) => {
	if (!ws) throw new Error('sync: ws is null/undefined');

	let network = null;
	const fromServer = {};
	let alive = true;

	const send = (obj) => {
		if (!alive) return;
		if (ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify(obj));
	};

	const stop = () => {
		if (!alive) return;
		alive = false;

		try { ws.removeEventListener('message', onMessage); } catch { }
		try { ws.removeEventListener('close', onClose); } catch { }
		try { ws.removeEventListener('error', onError); } catch { }

		try { network?.remove(); } catch { }
		network = null;

		// keep this consistent: no sync network => no state.sync
		state.sync = null;
	};

	const onError = (e) => {
		console.error('WebSocket error:', e?.message || e);
	};

	const onClose = () => {
		stop();
	};

	const onMessage = (evt) => {
		let msg;
		try {
			msg = parse(evt.data);
		} catch {
			return;
		}

		if (msg?.name !== 'sync') return;

		// support both error shapes
		if (msg.error || msg?.result?.error) return;

		let serverPayload;
		try {
			serverPayload = parse(msg.result);
		} catch (e) {
			console.error('sync: failed to parse msg.result', e);
			return;
		}

		// first sync packet should be the full store (not an array of deltas)
		if (!state.sync) {
			if (Array.isArray(serverPayload)) {
				console.error('sync: first sync message must be a store object, got delta array.');
				return;
			}

			state.sync = serverPayload;
			network = createNetwork(state.sync.observer);

			network.digest(
				(changes, observerRefs) => {
					if (!network) return;

					const clientChanges = stringify(changes, {
						observerRefs,
						observerNetwork: network,
					});
					send({
						name: 'sync',
						clientChanges,
					});
				},
				1000 / 30,
				(arg) => arg === fromServer
			);

			return;
		}

		// subsequent packets should be arrays of deltas
		if (network && Array.isArray(serverPayload)) {
			network.apply(serverPayload, fromServer);
		}
	};

	ws.addEventListener('message', onMessage);
	ws.addEventListener('close', onClose);
	ws.addEventListener('error', onError);

	queueMicrotask(() => send({ name: 'sync' }));

	return stop;
};

export default sync;

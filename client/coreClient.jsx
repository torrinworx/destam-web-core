/*
TODO: This could be strucutred a bit neater imo to allow for more flexibilitiy when it comes to the sync stuff maybe?
*/

import { mount } from 'destam-dom';
import { OObject, createNetwork } from 'destam';
import { parse, stringify } from '../common/clone.js';

export const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
};

let ws;

export const initWS = () => {
    const tokenValue = getCookie('webCore') || '';
    const wsURL = tokenValue
        ? `ws://${window.location.hostname}:${window.location.port}/?sessionToken=${encodeURIComponent(tokenValue)}`
        : `ws://${window.location.hostname}:${window.location.port}`;
    ws = new WebSocket(wsURL);
    return new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve(ws));
        ws.addEventListener('error', (err) => reject(err));
        ws.addEventListener('close', () => console.warn('WebSocket closed unexpectedly.'));
    });
};

export const jobRequest = (name, params) => {
    return new Promise((resolve, reject) => {
        const msgID = crypto.randomUUID();

        const handleMessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                if (response.id === msgID) {
                    ws.removeEventListener('message', handleMessage);
                    resolve(response);
                }
            } catch (error) {
                console.error("Failed to parse incoming message:", error);
            }
        };

        ws.addEventListener('message', handleMessage);

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                name: name,
                sessionToken: getCookie('webCore') || '',
                id: msgID,
                ...params
            }));
        } else {
            ws.removeEventListener('message', handleMessage);
            reject(new Error('WebSocket is not open. Ready state is: ' + ws.readyState));
        }
    });
};

export const syncNetwork = () => {
    let remove;
    let network;
    const fromServer = {};

    // State is split in two: state.sync and state.client, this prevents
    // client only updates from needlessly updating the database.
    const state = OObject({
        client: OObject({}),
        sync: null
    });
    window.state = state;

    ws.addEventListener('message', (msg) => {
        const data = parse(msg.data);

        // look for sync here because other data is returned from the server for jobRequest:
        if (data.name === 'sync') {
            const serverChanges = parse(data.result);
            if (!state.sync) {
                if (!Array.isArray(serverChanges)) {
                    state.sync = serverChanges; // Clone of OServer
                    network = createNetwork(state.sync.observer);

                    network.digest(async (changes, observerRefs) => {
                        const clientChanges = stringify(
                            changes,
                            { observerRefs: observerRefs, observerNetwork: network }
                        );
                        jobRequest('sync', { clientChanges: clientChanges })
                    }, 1000 / 30, arg => arg === fromServer);

                    window.addEventListener('unload', () => {
                        if (remove) remove();
                        if (ws) ws.close();
                        if (network) network.remove();
                    });
                } else {
                    console.error("First message should establish sync, received an array instead.");
                }
            } else {
                if (Array.isArray(serverChanges)) {
                    network.apply(serverChanges, fromServer);
                }
            }
        }
    });

    ws.addEventListener('close', () => {
        if (network) network.remove();
        console.log('WebSocket connection closed.');
    });

    ws.addEventListener('error', (error) => {
        console.error('WebSocket error:', error.message);
    });

    return state
};

export const coreClient = async (App, NotFound) => {
    await initWS();
    const state = syncNetwork();
    mount(document.body, window.location.pathname === '/' ? <App state={state} /> : <NotFound />);
};

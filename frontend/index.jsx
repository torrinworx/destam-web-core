import { mount } from 'destam-dom';
import { Button } from 'destamatic-ui';

let ws;
const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
};
const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
const sessionToken = null;
document.cookie = `webCore=${sessionToken}; expires=${expires}; path=/; SameSite=Lax`;

const initWS = () => {
    const tokenValue = getCookie('webCore') || '';
    const wsURL = tokenValue
        ? `ws://${window.location.hostname}:${window.location.port}/?sessionToken=${encodeURIComponent(tokenValue)}`
        : `ws://${window.location.hostname}:${window.location.port}`;
    ws = new WebSocket(wsURL);
    return ws;
};

// Request a job from the server
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
                sessionToken: sessionToken,
                id: msgID,
                ...params
            }));
        } else {
            ws.removeEventListener('message', handleMessage);
            reject(new Error('WebSocket is not open. Ready state is: ' + ws.readyState));
        }
    });
};

ws = initWS();
ws.addEventListener('message', (msg) => {
    const data = parse(msg.data);

    if (data.name === 'sync') { // look for sync here because other data is returned from the server for jobRequest.
        const decodedChanges = parse(data.result);
        if (!state.sync) {
            if (!Array.isArray(decodedChanges)) {
                state.sync = decodedChanges; // Clone of OServer
                network = createNetwork(state.sync.observer);

                network.digest(async (changes, observerRefs) => {
                    const encodedChanges = stringify(
                        changes,
                        { observerRefs: observerRefs, observerNetwork: network }
                    );
                    jobRequest('sync', { encodedChanges: encodedChanges })
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
            if (Array.isArray(decodedChanges)) {
                network.apply(decodedChanges, fromServer);
            }
        }
    }
})

const path = window.location.pathname;

const content = path === '/'
    ? <div>
        <Button
            type='contained'
            label='authenticated'
            onMouseDown={async () => {
                const test = await jobRequest('authenticated', { test: 'hello world' });
                console.log(test);
            }}
        />
        <Button
            type='contained'
            label='unauthenticated'
            onMouseDown={async () => {
                const test = await jobRequest('unauthenticated', { test: 'hello world' });
                console.log(test);
            }}
        />
    </div>
    : <div style={{ color: 'red', fontSize: '24px' }}>NotFound</div>;

mount(document.body, content);

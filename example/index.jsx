import { coreClient, jobRequest } from '../client/coreClient.jsx';
import { Button } from 'destamatic-ui';

// Setting the session token:
const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
const sessionToken = 'asasdasd';
document.cookie = `webCore=${sessionToken}; expires=${expires}; path=/; SameSite=Lax`;

const App = ({ state }) => {
    console.log(state);
    return <>
        <Button
            type='contained'
            label='authenticated'
            onMouseDown={async () => {
                const test = await jobRequest('authenticated', { test: 'hello wzxfasda sdasdasdasdasdasdorld' });
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
    </>;
};

const NotFound = () => <div style={{ color: 'red' }}>Not Found 404</div>;

coreClient(App, NotFound);

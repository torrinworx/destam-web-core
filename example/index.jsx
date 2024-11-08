import { Observer } from 'destam-dom';
import { coreClient, jobRequest } from '../client/coreClient.jsx';
import { Typography, TextField, Button } from 'destamatic-ui';

// Setting the session token:
const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
const sessionToken = 'asasdasd';
document.cookie = `webCore=${sessionToken}; expires=${expires}; path=/; SameSite=Lax`;

const App = ({ state }) => {
    // const email = state.client.observer.path('email').def('');
	const email = Observer.mutable();
    console.log(email);
    console.log(TextField);

    return <div>
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
		<TextField value={email} placeholder="Email" />

    </div>;
};

const NotFound = () => <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Typography type='h4'>Not Found 404</Typography>
</div>;


coreClient(App, NotFound);

import { Observer } from 'destam';
import { coreClient, jobRequest } from '../client/coreClient.jsx';
import { Typography, TextField, Button } from 'destamatic-ui';

// Setting the session token:

const App = ({ state }) => {
    // const email = state.client.observer.path('email').def('');
    const email = Observer.mutable('');
    const password = Observer.mutable('');

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
        <br />
        <div style={{ display: 'flex', flexDirection: 'column', width: '200px' }}>
            <TextField value={email} placeholder="Email" />
            <TextField value={password} placeholder="Password" />
        </div>
        <Button
            type='contained'
            label='Signup'
            onMouseDown={async () => {
                const response = await jobRequest('signup', { email: email.get(), password: password.get() });
                console.log(response);
            }}
        />
        <Button
            type='contained'
            label='Login'
            onMouseDown={async () => {
                console.log("Attempting login")
                const response = await jobRequest('login', { email: email.get(), password: password.get() });
                console.log(response);

                const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
                const sessionToken = response.result.sessionToken;
                document.cookie = `webCore=${sessionToken}; expires=${expires}; path=/; SameSite=Lax`;

                await jobRequest('sync');
            }}
        />
    </div>;
};

const NotFound = () => <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Typography type='h4'>Not Found 404</Typography>
</div>;

coreClient(App, NotFound);

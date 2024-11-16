# web-core

This package abstracts the core functionality of [OpenGig.org](https://github.com/torrinworx/OpenGig.org) into a reusable client-server setup for any web project. It is built on websockets for communication between the client and server.

Features:

- **Websockets Communication**: Real-time, two-way interaction between client and server.
- **Observer-based State Syncing**: Uses [destam](https://github.com/equator-studios/destam), [destam-dom](https://github.com/Nefsen402/destam-dom) for reactivity and to synchronize state seamlessly between client and server.
- **MongoDB Integration**: A simple built in wrapper for storing state in MongoDB.
- **Flexible Job System**: Infrastructure for code execution on websocket connection and client request.
- **Opinionated Authentication**: Offers a built-in authentication that secures state syncing and job execution, managing user signups and logins.

Upon page load, a websocket connection is established. The server is designed to serve unauthenticated and authenticated apps.

### Server Configuration

`coreServer` allows for a custom connection function, which is loaded and mounted. Values returned from this connection are passed to authenticated jobs, enabling seamless database logic execution per job.

### Full stack example
This is a full stack web application using web-core, it uses mongodb to store the state server-side.

**server.js**
```javascript
import { coreServer } from "web-core/server";

const connection = async (ws, req) => {
    console.log("User connected!")
	return;
};

coreServer(
	'./backend/jobs',
	'./frontend',
	connection
);
```

**client.jsx**
```javascript
import { coreClient } from 'web-core/client';

const App = ({ state }) => {
	const counter = state.client.counter.def(0);

	return <div>
        {counter}
		<button onClick={() => counter.set(counter.get() + 1)}>
            Counter
		</button>
	</div>;
};

const NotFound = () => <>Not Found 404</>;

coreClient(App, NotFound);
```

**index.html**
```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>web-core</title>
	</head>
	<body style="margin: 0px;">
		<script type="module" src="./client.jsx"></script>
	</body>
</html>
```

That's all the code needed to create a full stack app with web-core, destam, and destam-dom.

With web-core, you can focus on building out features, rather than setting up boilerplate infrasturcture.

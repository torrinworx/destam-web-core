# web-core

This simple package contains the abstractred core of OpenGig.org, meant to be a reusable client-server setup I can use for any web project.

It's designed to use websockets for communication between the client and server. The name means both websockets, and because it's a web server.

Building on destam and destam-dom, it uses these observer based libraries to sync state between a client and a server.

web-core also contains a database wrapper that allows a state to be stored in Mongodb.

web-core also has a built in jobs system, allowing developers to build out code that can run both on websocket connection, and on request of the
client.

The server is opinionated, having a built in authentication mechanism that protects both state syncing and specified jobs to be executed. The authentcation
system is opinionated to take away a lot of the worry about users, signup, logins.

The server is desigend to host a secure open landing page, with an authenticated webpage. On page load a websocket is loaded.

coreServer accepts a connection function, this function get's loaded and mounted. All returned values from connection get passed to Authenticated jobs.

This allows us to have database logic run for each job as they are ran.

# web-core

This is a simple package that contains the abstracted core of OpenGig.org. The idea here is to have a reusable, abstracted web server I can use for any project.

The server is desigend to host a secure open landing page, with an authenticated webpage. On page load a websocket is loaded.

coreServer accepts a connection function, this function get's loaded and mounted. All returned values from connection get passed to Authenticated jobs.

This allows us to have database logic run for each job as they are ran.

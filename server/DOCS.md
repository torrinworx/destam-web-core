# Server docs

coreServer.js is the main entry point/import, users can use ./servers to run the web-core server off of http, express, etc (to be built).

modules loads by deafult the modules directory a user provides to coreServer. They are loaded in memory, then a router routes requests to 
them based on session token authentication and the module's authenticated status.

ODir is a special observer that provides an OArray that updates a directory based on changes in that directory using node fs watchers.
Similar to ODir is OFile that watches a file for updates. These two are experimental and need improvement.

./modules provides default modules that are loaded into the system in adition to the ones the user loads. check.js is part of the simplified
login system that checks if the users entered email address exists, enter.js logs the user in or signs them up based on the check.js output/
client request.

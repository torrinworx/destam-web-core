# destam-db

This library provides persistent storage for [destam](https://github.com/equator-studios/destam) state trees.

See the [documentation](docs/doc.md)

## Basic Example
```js
// create an new table
const store = await DB('Table');

// create query data so we can query for this later
store.query.myQuery = 1;

// manipulate the OObject however you want
store.myData = 'my data';

// later, retrieve the data.
const store = await DB('Table', {myQuery: 1})
console.log(store.myData);
```

Since destam provides an observable interface into an entire object graph, destam-db was created to listen to those observable events and write them persistently to the disk or some the database. Destam-db provides multiple drivers to store the data.

## Setting up a database

```js
import fs from 'destam-db/driver/fs.js';
import database from 'destam-db';

// use the filesystem to store our data.
const driver = fs('./myPersistentStorage');
const DB = database(driver);

// now we can use DB like the above example.
```

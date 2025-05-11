Note that this documentation assumes that you already know about [destam](https://github.com/Equator-Studios/destam/blob/HEAD/destam/README.md), which this library is built on. This library heavily depends on destam and simply builds on top of it.

Destam-db is based on muliple pieces hooked together. Understanding them is important for implementing a proper database. The basic mental model for these layers is as follows:
- driver
- cache
- API interface (index.js)

## driver
A driver implements the actual backend for the database. It implements how the data gets stored and where. destam-db provides a variety of backends:
- fs (stores documents on the fs directly)
- mongodb (stores documents in a mongodb database)

Non persistent drivers (lost on restart):
- memory (stores documents in binary format in memory and lets the garbage collector work. Should reduce memory for long running programs)
- dummy (Prevents the garbage collector from ever collecting database documents. This means that the cache will continue to hold the raw document references in memory)

Note that all the backends will store mutations to the state tree as a list of deltas. This is important to keep in mind for performance reasons. Deltas are preferrable because they mean that data is never truly lost, a delta can always be reverted, but it takes time to apply the deltas to retrieve the current state. Therefore the backends implement a checkpoint system where if the list of deltas grows too large, a checkpoint is created so that when the document needs to be decoded later, decoding starts from the checkpoint instead of resolving deltas from the beginning.

## cache
As destam provides observable objects, and users expect observability to persist even when using destam-db, we cache currently used destam-db documents weakly in memory so that if there are multiple users of the same document, they are handed the same observable in memory. This ensures that listeners and mutations work across the same document that was querried mulitple times.

## API
The driver and cache both implement a lower level interface that destam-db uses internally. However, its not a ergonomic API to use day to day. `index.js` provides a wrapper that automatically applies a cache to the driver and a more ergonomic interface. The API includes these functions:
- DB()
- DB.query()
- DB.queryAll()
- DB.reuse()
- DB.instance()
- DB.flush()
- DB.delete()
- DB.close()

### Creating a database
```js
import memory from 'destam-db/driver/memory.js';
import database from 'destam-db';

// create the backend driver that will be used
const driver = memory();

// create a database from the backend
const DB = database(driver);
```

### async DB(table, query) -> OObject
Returns a document from a table. If the query is present, it will query the table for the an arbitrary document that matches the query. If the query does not exist a new table entry is created. This function will return the entire store for the object. The store has one special property on it: `query`. Which represents the query object that is used when trying to query the store later. If the query does not match, null is returned.

### async DB.query(table, query) -> query
Returns the query section of a document. Since DB() returns the entire document, it has to decode all the deltas. The query section represents the section that is not delta encoded, and so therefore can be queried using the query paramater. This function will return an arbitrary document matching the query. If the query does not match, null is returned.

### async DB.queryAll(table, query, reactive) -> [query]
Same as `DB.query()` except will return a list of all documents matching the query. If nothing matches, an empty array is returned. An optional reactive bool can be given which will make queryAll reactive in case a new document is added while we are still interested in the query. However, special care has to be ginen for lifetimes:

```js
const query = DB.queryAll('table', {}, true);

// query.array is an OArray that can be watched for new additions
query.array.observer.watch(delta => {
	console.log(delta.value);
});

// after we are finished with the query, we can remove the reactivity.
query.remove();

```

### async DB.instance(store/query) -> OObject
Will return the generic store for any document passed. This is useful when calling `DB.query()` or `DB.queryAll()` and later deciding you want the store for it. For example:

```js
const query = await DB.query('table', {myQuery: 1});

// ah, this query is what I was looking for, let me load the generic store for it.

const store = await DB.instance(query);
```

### async DB.reuse(table, query) -> store
Similar to `DB()` except will automatically create a store if it doesn't already exist and build the query automatically.

```js
// oh, the table doesn't have a document that matches the query. It's going to create a new one
const store = await DB.reuse('table', {myQuery: 2});

assert (store.query.myQuery === 2);

// The query exists in the store, return that.
const store2 = await DB.reuse('table', {myQuery: 2});
assert(store === store2);
```

### async DB.flush(store/query) -> void
Flushes the document to persistent storage. After awaiting the call, it's guaranteed that the data is safe against unexpected shutdown.

### async DB.delete(store/query) -> void
Deletes the document from the table and flushes the contents.

## Querying
The query engine destam-db uses exact match semantics. It does not support inequalities such as querying if certain properties are greater than a value. This is done to keep the engine as simple as possible. If more advance querying is needed, querying the backend driver directly (such as mongodb) is advised.

Every document in destam-db has a query object. This object is used only for query
purposes and only supports a subset of what is supported in the main store. In fact,
it only supports:
 - Strings
 - Integers
 - Booleans
 - Objects
 - Arrays (to allow multiple queries)

These values can be nested arbitrarily.


```js
const store = await DB('table');

// Querying is based on an object with keys that are dot separated to query into deeper objects.
store.query.profile = {
	email: "address@example.com",
	name: "bob",
};

store.query.admin = true;

// we can then query later using:
const store = await DB('table', {
	'profile.email': "address@example.com",
});

// multiple queries will only return a document which matches all queries.
const store = await DB('table', {
	'admin': true,
	'profile.name': 'bob',
});

// matches everything in the table
const store = await DB('table', {});

// querying for a property that isn't contained in any document won't match anything
const store = await DB('table', {
	nonsense: true
});
assert(store == null);

```

import indexeddbDriver from '../drivers/indexeddb.js';
import { runODBDriverTests } from './test.js';

runODBDriverTests({
	name: 'indexeddb',
	driver: indexeddbDriver,
	driverProps: { test: true },
	throttleMs: 10,
	crossInstanceLive: true,
});

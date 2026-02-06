import memoryDriver from '../drivers/memory.js';
import { runODBDriverTests } from './test.js';

runODBDriverTests({
	name: 'mongodb',
	driver: memoryDriver,
	driverProps: { test: true },
	throttleMs: 10,
	crossInstanceLive: true,
});

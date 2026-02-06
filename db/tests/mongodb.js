import mongodbDriver from '../drivers/mongodb.js';
import { runODBDriverTests } from './test.js';

process.env.DB = 'test'
process.env.DB_TABLE = 'test'

runODBDriverTests({
  name: 'mongodb',
  driver: mongodbDriver,
  driverProps: { test: true },
});

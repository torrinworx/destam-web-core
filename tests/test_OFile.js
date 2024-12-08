import fs from 'fs';
import OFile from "../server/OFile.js";
import Path from 'path';
import { Observer } from 'destam';

// Normal Observer:
const thing = Observer.mutable(false);
thing.watch(d => console.log(d));
thing.set(true);

// test.txt file
const filePath = Path.resolve('./web-core/server/test.txt');
fs.writeFileSync(filePath, 'Initial content', 'utf8');

// OFile Observer:
const testTXT = OFile(filePath);
testTXT.watch(d => {
	console.log(d);
});
fs.writeFileSync(filePath, 'Edited content', 'utf8');
console.log("From testTXT.get(): ", testTXT.get());
testTXT.set("New test file content from testTXT.set()")
console.log("From testTXT.get(): ", testTXT.get());

fs.rm(filePath, (err) => {
	if (err) console.error('Error deleting file:', err);
	else console.log('File successfully deleted.');
});

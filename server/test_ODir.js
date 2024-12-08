import fs from 'fs';
import path from 'path';
import ODir from './ODir.js';

const testDirPath = path.resolve('./test-dir');
if (!fs.existsSync(testDirPath)) {
	fs.mkdirSync(testDirPath, { recursive: true });
}

// Initial file setup
fs.writeFileSync(path.join(testDirPath, 'file1.txt'), 'Initial content of file1', 'utf8');
fs.writeFileSync(path.join(testDirPath, 'file2.txt'), 'Initial content of file2', 'utf8');

// Initialize ODir
const dirObserver = ODir(testDirPath);
dirObserver.watch(delta => {
	console.log('Directory changed:', delta);
});

// Demonstrating array-like methods:
console.log("Initial files:", dirObserver.getFiles());

// Using addFile method to add a file
dirObserver.addFile('file3.txt', 'Content of new file3');
console.log("After addFile:", dirObserver.getFiles());

// Using pop method to remove the last file
const poppedFile = dirObserver.pop();
console.log("Popped file name:", poppedFile);
console.log("After pop:", dirObserver.getFiles());

// Using splice method: removing one and adding two new files
dirObserver.splice(1, 1, { fileName: 'file4.txt', content: 'New content for file4' }, { fileName: 'file5.txt', content: 'New content for file5' });
console.log("After splice:", dirObserver.getFiles());

// Use traditional file operations alongside the custom methods
fs.writeFileSync(path.join(testDirPath, 'file6.txt'), 'Directly added file6 content', 'utf8');
dirObserver.addFile('file7.txt', 'Content added via dirObserver');
console.log("After direct file operation and addFile:", dirObserver.getFiles());

// Clean up: remove directory
fs.rm(testDirPath, { recursive: true }, (err) => {
	if (err) console.error('Error deleting dir:', err);
	else console.log('Dir successfully deleted.');
});

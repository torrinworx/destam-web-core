import test from "node:test";
import { expect } from "chai";
import fs from "fs";
import path from "path";
import ODir from "../server/ODir.js";

const testDirPath = path.resolve("./test-dir");

test.before(async () => {
  // Ensure test directory is created before tests
  if (!fs.existsSync(testDirPath)) {
    fs.mkdirSync(testDirPath, { recursive: true });
  }

  // Initial files
  fs.writeFileSync(path.join(testDirPath, "file1.txt"), "Initial content of file1", "utf8");
  fs.writeFileSync(path.join(testDirPath, "file2.txt"), "Initial content of file2", "utf8");
});

test("Initialize and watch ODir", async () => {
  const dirObserver = ODir(testDirPath);
  expect(dirObserver).to.be.an("object");
  
  // Set up a watch callback to verify directory change events
  let watchCalled = false;
  dirObserver.watch(() => {
    watchCalled = true;
  });

  // Trigger a directory change by adding a file
  dirObserver.addFile("file3.txt", "Content of new file3");

  // Give the file system a brief moment to register the event
  await new Promise((resolve) => setTimeout(resolve, 100));

  // The watch callback should have been called
  expect(watchCalled).to.be.true;
});

test("Check initial files via getFiles", () => {
  const dirObserver = ODir(testDirPath);
  const files = dirObserver.getFiles();
  expect(files).to.be.an("array");
  expect(files).to.include("file1.txt");
  expect(files).to.include("file2.txt");
  expect(files).to.include("file3.txt"); // We added this in the previous test
});

test("Array-like operations: pop() on ODir", () => {
  const dirObserver = ODir(testDirPath);
  const initialFiles = dirObserver.getFiles();
  // pop() should remove the last file
  const poppedFile = dirObserver.pop();
  expect(typeof poppedFile).to.equal("string");
  const afterPopFiles = dirObserver.getFiles();
  expect(afterPopFiles.length).to.equal(initialFiles.length - 1);
  // The popped file should no longer be in the list
  expect(afterPopFiles).not.to.include(poppedFile);
});

test("Array-like operations: splice() on ODir", () => {
  const dirObserver = ODir(testDirPath);

  // For demo, splice out the second file (index = 1 if it exists),
  // and add two new files
  const beforeSpliceFiles = dirObserver.getFiles();
  dirObserver.splice(
    1,
    1, 
    { fileName: "file4.txt", content: "New content for file4" },
    { fileName: "file5.txt", content: "New content for file5" }
  );

  const afterSpliceFiles = dirObserver.getFiles();
  expect(afterSpliceFiles.length).to.be.gte(beforeSpliceFiles.length);

  // Verify new files
  expect(afterSpliceFiles).to.include("file4.txt");
  expect(afterSpliceFiles).to.include("file5.txt");
});

test("Direct FS operations alongside ODir methods", () => {
  const dirObserver = ODir(testDirPath);

  // Create a file with FS
  fs.writeFileSync(path.join(testDirPath, "file6.txt"), "Directly added file6 content", "utf8");
  // Create file7 via ODir
  dirObserver.addFile("file7.txt", "Content added via dirObserver");

  const currentFiles = dirObserver.getFiles();
  expect(currentFiles).to.include("file6.txt");
  expect(currentFiles).to.include("file7.txt");
});

test.after(async () => {
  try {
    fs.rmSync(testDirPath, { recursive: true, force: true });
  } catch (err) {
    console.error("Error deleting test directory:", err);
  }
});

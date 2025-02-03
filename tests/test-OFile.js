import test from "node:test";
import { expect } from "chai";
import fs from "fs";
import path from "path";
import OFile from "../server/OFile.js";

const filePath = path.resolve("./test.txt");

test.before(() => {
	fs.writeFileSync(filePath, "Initial content", "utf8");
});

test("OFile initialization and watch", async () => {
	const testTXT = OFile(filePath);
	expect(testTXT).to.be.an("object");

	let watchTriggeredData = null;
	testTXT.watch((delta) => {
		watchTriggeredData = delta;
	});

	// Change file externally
	fs.writeFileSync(filePath, "Edited content", "utf8");

	// Wait briefly so fs.watch can detect changes
	await new Promise((resolve) => setTimeout(resolve, 100));

	// Watch callback should have fired
	expect(watchTriggeredData).to.not.be.null;

	// The actual file content in OFile
	const actualContent = testTXT.get();
	expect(actualContent).to.equal("Edited content");
});

test("OFile get() and set()", () => {
	const testTXT = OFile(filePath);

	// The current file content after we just edited it
	const original = testTXT.get();
	expect(original).to.equal("Edited content");

	// Now we set new content via OFile
	testTXT.set("New test file content from testTXT.set()");
	const updated = testTXT.get();
	expect(updated).to.equal("New test file content from testTXT.set()");
});

test.after(async () => {
	// Remove file
	await fs.rm(filePath, (err) => {
		if (err) console.error("Error deleting file:", err);
	});
});

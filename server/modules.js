/*
Modules System

This system provides a way to load functions that need some kind of async setup
on server start or need custom parameters for specific use cases.

A module file simply exports a function that returns a dictionary. The intent is
that this dictionary defines the modules functions and parameters. For example,
the check.js module returns "authenticated: false", signaling to coreServer that
the module is allowed to be called by unauthenticated connections. It also returns
an "onMsg" function that get's called everytime the websocket receives a message
requesting the "check" module.

TODO: Allow dynamic import methods so that modules works on both client and server,
use methods in odb.js for driver loading.

module definition:
// example.js

// List of modules file names to be imported before this module is initialized
export const deps = ['someModuleName', 'anotherModuleName'];

// Dependencies (deps) int(), or "internal" function are imported as props
export default ({ someModuleName, anotherModuleName }) => {
	console.log("Module setup goes here.")

	// Module default function is run on module load, when the server starts up.
	// This is key for async setup of tools, say like a connection/validation of a database,
	// or waiting on a connection to another server.

	return {
		  // Internal functoin of module, used when other modules need to import this module.
		// Cannot be requested by the client.
		int: () => {...},

		// If false, clients can make requests to this module without an authenticated connection.
		// Authenticated default value is true for all modules that don't specify it, meaning they cannot
		// be run by the client when requested on a non-authenticated connection
		// Authenticated is only really useful if onMsg or onMsgQ is defined, otherwise it's useless.
		authenticated: false,

		// Function that runs on message/request from client. props include client provided props, and ws
		// from the websocket server to send multiple responses back to the client if needed to stream data.
		// in conjunction with Authenticated, this function can be set to run on both authenticated and non-
		// authenticated connections.
		onMsg: () => {...},

		// TODO: Functions that are added to the web-core multi threaded worker queue system.
		// When requested, either internally by other modules, or from the client (if defined with onMsgQ)
		// adds the call to a queue system which runs the request on a separate thread when a worker is
		// available to fullfill the request.
		intQ: () => {...},
		onMsgQ () => {...},
	};	
};

Modules can be defined with all of these combined, you can have a module that can be called internally
by other modules (.int()), have it 



TODO: Make modules system self contained, move code from coreServer into here so that we are just importing
a helper that runs on startup.

Restriction: Modules are designed to be imported and used by other modules, they are not meant to be imported
by non module code.

It should be best practice if you need module code in a non module to do something like this:
// example.js

export const example (...) => {
	console.log("core functionality of exmaple");
	return result;
};

export const deps = ['someDep', 'anotherDep'];

export default ({ someDep, anotherDep }) => {
	return {
		int: (props) => example(props, someDep, anotherDep),
		onMsg: (props) => example(props, someDep, anotherDep),
		...
	}	
};

In the above example, if your function `example()` needs deps, then the code importing exmaple should be
a module itself.

Modules can also just run on startup without having to return anything for internal or client use:

export const deps = ['someDep', 'anotherDep'];

export default ({ someDep, anotherDep }) => {
	console.log('This doesn't even have to return anything, and just runs on startup');
};

TODO: modules system tests
*/

import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";

/**
 * Recursively find all files within the given directories.
 * Returns an array of objects: [{ directory, filePath }, ...]
 */
const findFiles = async (directories) => {
	const dirs = Array.isArray(directories) ? directories : [directories];

	const recurseDirectory = async (dir) => {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const results = await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					return recurseDirectory(fullPath);
				} else if (entry.name.endsWith(".js")) {
					return { directory: dir, filePath: fullPath };
				}
				return null;
			})
		);
		return results.flat().filter(Boolean);
	}

	const allFiles = [];
	for (const dir of dirs) {
		const found = await recurseDirectory(dir);
		allFiles.push(...found);
	}
	return allFiles;
};

/**
 * Discover module metadata:
 *    - moduleName (based on relative path)
 *    - deps (named export)
 *    - factory (default export)
 */
const moduleMetadata = async (directories) => {
	const moduleFiles = await findFiles(directories);
	let discoveredCount = 0;
	const modulesMap = {};

	await Promise.all(
		moduleFiles.map(async ({ directory, filePath }) => {
			try {
				const mod = await import(filePath);
				const moduleRoot = directories.find(dir => filePath.startsWith(dir));
				const relativePath = path.relative(moduleRoot, filePath);
				const moduleName = relativePath.replace(/\\/g, "/").replace(/\.js$/, "");

				// TODO: if module is a web-core default module and user specifies their own
				// override the webcore one with the user defined one to allow for customization.
				if (modulesMap[moduleName]) {
					throw new Error(`Duplicate module name found: "${moduleName}". Each module name must be unique.`);
				}

				const deps = Array.isArray(mod.deps) ? mod.deps : [];
				const factory = typeof mod.default === "function" ? mod.default : null;

				modulesMap[moduleName] = {
					directory,
					filePath,
					deps,
					factory,
				};

				discoveredCount++;
				process.stdout.write(`\rDiscovered ${discoveredCount}/${moduleFiles.length} modules...`);
			} catch (err) {
				console.error(`Failed to discover module at ${filePath}:`, err);
			}
		})
	);

	process.stdout.write("\n");
	return modulesMap;
}

/**
 * Sort modules based on dependencies. Assume each dep
 * is a moduleName in modulesMap. Throws if a cycle or
 * unresolved dependency is found.
 */
const topoSort = (modulesMap) => {
	const allNames = Object.keys(modulesMap);

	// adjacencyList: for A depends on B, we add an edge B->A
	const adjacencyList = {};
	const inDegree = {};

	// Initialize adjacency lists and inDegree counts
	for (const name of allNames) {
		adjacencyList[name] = [];
		inDegree[name] = 0;
	}

	// Build the graph
	for (const name of allNames) {
		const { deps } = modulesMap[name];
		for (const d of deps) {
			if (!modulesMap[d]) {
				throw new Error(`Module "${name}" depends on "${d}", but "${d}" was not found.`);
			}
			adjacencyList[d].push(name);
			inDegree[name]++;
		}
	}

	// Collect all nodes with inDegree=0 in a queue
	const queue = [];
	for (const name of allNames) {
		if (inDegree[name] === 0) {
			queue.push(name);
		}
	}

	const sorted = [];
	while (queue.length) {
		const current = queue.shift();
		sorted.push(current);

		for (const neighbor of adjacencyList[current]) {
			inDegree[neighbor]--;
			if (inDegree[neighbor] === 0) {
				queue.push(neighbor);
			}
		}
	}

	// If we didn't process all modules, there is a cycle
	if (sorted.length !== allNames.length) {
		throw new Error(
			"Detected a cycle in module dependencies; cannot topologically sort."
		);
	}

	return sorted;
}

/**
 * Instantiate modules in topological order.  
 *    - Instead of providing all modules in one object, we convert
 *      each dependency, e.g. "stripe/payment", into an injection like:
 *        payment: (args) => instantiated["stripe/payment"].int(args)
 *    - Also pass "props" (global extra data) for convenience.
 */
const instantiateModules = async (modulesMap, sortedNames, props) => {
	const instantiated = {};
	const total = sortedNames.length;
	let loadedCount = 0;

	for (const name of sortedNames) {
		const { deps, factory } = modulesMap[name];
		if (!factory) {
			console.warn(
				`\nNo valid default export function for module "${name}". Skipping instantiation.`
			);
			continue;
		}

		// Build the injection object
		const injection = {};

		for (const depName of deps) {
			const depInstance = instantiated[depName];
			if (!depInstance) {
				throw new Error(`\nCannot instantiate "${name}" - missing dependency "${depName}".`);
			}

			const shortName = depName.split("/").pop();

			if (typeof depInstance.int !== "function") {
				throw new Error(
					`\nDependency "${depName}" does not have an int() method, but is expected to be called as a function.`
				);
			}

			injection[shortName] = (...args) => {
				return depInstance.int(...args);
			};
		}

		injection.props = props;
		const instance = await factory(injection);

		if (instance && typeof instance !== "object") {
			throw new Error(`\nModule "${name}" did not return a valid object from its default function.`);
		}

		instantiated[name] = instance;
		loadedCount++;
		process.stdout.write(`\rLoaded ${loadedCount}/${total} modules...`);
	}

	process.stdout.write("\n");
	return instantiated;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const Modules = async (dirs, props = {}) => {
	const directories = [
		...(Array.isArray(dirs) ? dirs : [dirs]),
		path.resolve(__dirname, "modules"), // webcore modules
	];

	const modulesMap = await moduleMetadata(directories);
	const sortedNames = topoSort(modulesMap);
	return await instantiateModules(modulesMap, sortedNames, props);
};

export default Modules;

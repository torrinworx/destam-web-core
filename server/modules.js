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
const mapModules = async (directories) => {
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
		path.resolve(__dirname, "modules"),
	];

	const modulesMap = await mapModules(directories);
	const sortedNames = topoSort(modulesMap);
	return await instantiateModules(modulesMap, sortedNames, props);
};

export default Modules;

/**
 * Modules System
 *
 * This system provides a function to load and initialize modules from specified directory or directories, including a default
 * `./modules` directory to load webcore modules. It dynamically imports module files, executes optional initialization logic, and creates
 * handlers for managing module execution.
 *
 * @param {(string|string[])} directories - The directory path or an array of directory paths containing module files.
 * @param {Object} [props={}] - An optional object of properties to be passed to each module instance.
 * @returns {Promise<Object>} A promise that resolves to an object containing module handlers.
 *
 * Usage:
 *   1. Specify a directory or an array of directories containing module files.
 *   2. Each module file should export a default function that returns an object with:
 *      - `authenticated` (optional): A boolean indicating if the module requires authentication (default is true if undefined).
 *      - `init` (optional): A function for the module's logic.
 *   3. The handlers object returned can be used to manage modules, including executing their initialization logic with the
 *      specified properties.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ModulesSystem = async (directories, props = {}) => {
	const modules = new Map();
	const directoryPaths = Array.isArray(directories)
		? directories.map(dir => path.resolve(dir))
		: [path.resolve(directories)];
	directoryPaths.push(path.resolve(__dirname, 'modules'));

	const findModuleFiles = async dir => {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const filesPromises = entries.map(async entry => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				return findModuleFiles(fullPath);
			} else if (entry.name.endsWith('.js')) {
				return fullPath;
			}
		});
		const files = await Promise.all(filesPromises);
		return files.flat().filter(Boolean);
	};

	let allModuleFiles = [];
	for (const directory of directoryPaths) {
		const moduleFiles = await findModuleFiles(directory);
		allModuleFiles.push(
			...moduleFiles.map(filePath => ({ directory, filePath }))
		);
	}

	const totalModules = allModuleFiles.length;
	let loadedModulesCount = 0;

	try {
		await Promise.all(
			allModuleFiles.map(async ({ directory, filePath }) => {
				try {
					const module = await import(filePath);
					const relativePath = path.relative(directory, filePath);
					const moduleName = relativePath.replace(/[/\\]/g, '/').replace(/\.js$/, '');
					if (typeof module.default === 'function') {
						modules.set(moduleName, module.default);
						loadedModulesCount++;

						// Update the same line for each successfully loaded module
						process.stdout.write(`\rLoaded ${loadedModulesCount}/${totalModules} modules.`);
					}
				} catch (e) {
					console.error(`Failed to load module from ${filePath}:`, e);
				}
			})
		);
		process.stdout.write('\n');
		console.log('All modules loaded.');
	} catch (error) {
		console.error('Error loading modules:', error);
	}

	const moduleHandlers = {};

	for (const [moduleName, moduleFactory] of modules.entries()) {
		try {
			const moduleInstance = await Promise.resolve(moduleFactory(props));

			if (typeof moduleInstance !== 'object' || moduleInstance === null) {
				throw new TypeError(`Module factory for '${moduleName}' did not return a valid object.`);
			}
			moduleHandlers[moduleName] = {
				authenticated: moduleInstance.authenticated !== undefined ? moduleInstance.authenticated : true,
				...moduleInstance
			};
		} catch (e) {
			console.error(`Failed to initialize module '${moduleName}':`, e);
		}
	}

	return moduleHandlers;
};

export default ModulesSystem;
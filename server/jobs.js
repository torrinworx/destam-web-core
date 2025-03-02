/**
 * Jobs Module
 *
 * This module provides a function to load and initialize job modules from specified directory or directories, including a default
 * `./jobs` directory to load webcore jobs. It dynamically imports job modules, executes optional initialization logic, and creates
 * handlers for managing job execution.
 *
 * @param {(string|string[])} directories - The directory path or an array of directory paths containing job module files.
 * @param {Object} [props={}] - An optional object of properties to be passed to each job instance.
 * @returns {Promise<Object>} A promise that resolves to an object containing job handlers.
 *
 * Usage:
 *   1. Specify a directory or an array of directories containing job files.
 *   2. Each job file should export a default function that returns an object with:
 *      - `authenticated` (optional): A boolean indicating if the job requires authentication (default is true if undefined).
 *      - `init` (optional): A function for the jobs logic.
 *   3. The handlers object returned can be used to manage jobs, including executing their initialization logic with the
 *      specified properties.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const Jobs = async (directories, props = {}) => {
	const jobs = new Map();
	const directoryPaths = Array.isArray(directories)
		? directories.map(dir => path.resolve(dir))
		: [path.resolve(directories)];
	directoryPaths.push(path.resolve(__dirname, 'jobs'));

	const findJobFiles = async dir => {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const filesPromises = entries.map(async entry => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				return findJobFiles(fullPath);
			} else if (entry.name.endsWith('.js')) {
				return fullPath;
			}
		});
		const files = await Promise.all(filesPromises);
		return files.flat().filter(Boolean);
	};

	let allJobFiles = [];
	for (const directory of directoryPaths) {
		const jobFiles = await findJobFiles(directory);
		allJobFiles.push(
			...jobFiles.map(filePath => ({ directory, filePath }))
		);
	}

	const totalJobs = allJobFiles.length;
	let loadedJobsCount = 0;

	try {
		await Promise.all(
			allJobFiles.map(async ({ directory, filePath }) => {
				try {
					const module = await import(filePath);
					const relativePath = path.relative(directory, filePath);
					const jobName = relativePath.replace(/[/\\]/g, '/').replace(/\.js$/, '');
					if (typeof module.default === 'function') {
						jobs.set(jobName, module.default);
						loadedJobsCount++;

						// Update the same line for each successfully loaded job
						process.stdout.write(`\r${loadedJobsCount}/${totalJobs} jobs loaded.`);
					}
				} catch (e) {
					console.error(`Failed to load module from ${filePath}:`, e);
				}
			})
		);
		process.stdout.write('\n');
		console.log('All jobs loaded.');
	} catch (error) {
		console.error('Error loading jobs:', error);
	}

	const jobHandlers = {};

	for (const [jobName, jobFactory] of jobs.entries()) {
		try {
			const jobInstance = await Promise.resolve(jobFactory(props));

			if (typeof jobInstance !== 'object' || jobInstance === null) {
				throw new TypeError(`Job factory for '${jobName}' did not return a valid object.`);
			}

			jobHandlers[jobName] = {
				authenticated: jobInstance.authenticated !== undefined ? jobInstance.authenticated : true,
				init: typeof jobInstance.init === 'function' ? jobInstance.init : () => { },
			};
		} catch (e) {
			console.error(`Failed to initialize job '${jobName}':`, e);
		}
	}

	return jobHandlers;
};

export default Jobs;
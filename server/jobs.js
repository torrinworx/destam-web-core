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
import { promises as fs } from 'fs';

const Jobs = async (directories, props = {}) => {
	const jobs = new Map();
	const directoryPaths = Array.isArray(directories) ? directories.map(dir => path.resolve(dir)) : [path.resolve(directories)];
	directoryPaths.push(path.resolve('./server/jobs'));

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

	try {
		for (let jobsDirectory of directoryPaths) {
			const jobFiles = await findJobFiles(jobsDirectory);
			await Promise.all(jobFiles.map(async filePath => {
				try {
					const module = await import(filePath);
					const relativePath = path.relative(jobsDirectory, filePath);
					const jobName = relativePath.replace(/[/\\]/g, '_').replace(/\.js$/, '');
					if (typeof module.default === 'function') {
						jobs.set(jobName, module.default);
					}
					console.log(`Job \x1b[36m"${jobName}"\x1b[0m loaded`);
				} catch (e) {
					console.error(`Failed to load module from ${filePath}:`, e);
				}
			}));
		}
		console.log('All jobs loaded.');
	} catch (error) {
		console.error('Error loading jobs:', error);
	}

	const jobHandlers = {};

	for (const [jobName, jobFactory] of jobs.entries()) {
		const jobInstance = jobFactory(props);
		jobHandlers[jobName] = {
			authenticated: jobInstance.authenticated !== undefined ? jobInstance.authenticated : true,
			init: jobInstance.init || (() => { }),
		};
	}

	return jobHandlers;
};

export default Jobs;

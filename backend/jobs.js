import path from 'path';
import { promises as fs } from 'fs';

// Function to handle initialization of jobs within the new server structure.
const Jobs = async (directory = '../jobs', props = {}) => {
    const jobs = new Map();
    const jobsDirectory = path.resolve(directory);

    // Recursively find all job files in the directory.
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
        const jobFiles = await findJobFiles(jobsDirectory);
        await Promise.all(jobFiles.map(async filePath => {
            try {
                const module = await import(filePath);
                const relativePath = path.relative(jobsDirectory, filePath);
                const jobName = relativePath.replace(/[/\\]/g, '_').replace(/\.js$/, '');
                if (typeof module.default === 'function') {
                    jobs.set(jobName, module.default);
                }
                console.log(`Job "${jobName}" loaded`);
            } catch (e) {
                console.error(`Failed to load module from ${filePath}:`, e);
            }
        }));
        console.log('All jobs are loaded');
    } catch (error) {
        console.error('Error loading jobs:', error);
    }

    const jobHandlers = {};

    // Process each loaded job and prepare handlers
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

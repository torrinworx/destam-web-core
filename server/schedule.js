import { CronExpressionParser } from 'cron-parser';
import { DateTime } from 'luxon';

export const createSchedule = ({ onError = null } = {}) => {
	const jobs = new Set();
	const timers = new Set();

	const normalizeEvery = (every) => {
		if (every == null) return null;
		if (typeof every === 'number' && Number.isFinite(every) && every > 0) return every;
		if (typeof every === 'string') {
			const n = Number(every.trim());
			if (Number.isFinite(n) && n > 0) return n;
		}
		return null;
	};

	const runJob = async (job) => {
		if (job.running) return;
		job.running = true;
		job.lastStart = Date.now();

		try {
			await job.fn(job.ctx);
			job.lastError = null;
		} catch (err) {
			job.lastError = err;
			if (onError) onError(err, job);
			else console.error(`[schedule:${job.name}]`, err);
		} finally {
			job.lastEnd = Date.now();
			job.running = false;
		}
	};

	const startEvery = (job) => {
		if (job.runOnStart) Promise.resolve().then(() => runJob(job));

		const t = setInterval(() => {
			Promise.resolve().then(() => runJob(job));
		}, job.every);

		timers.add(t);
		return () => { clearInterval(t); timers.delete(t); };
	};

	const startCron = (job) => {
		let stopped = false;
		let timeout = null;

		const scheduleNext = () => {
			if (stopped) return;

			const now = DateTime.now().setZone(job.tz || 'UTC').toJSDate();

			// cron-parser calculates next occurrence from "currentDate"
			const it = CronExpressionParser.parse(job.cron, {
				currentDate: now,
				tz: job.tz || 'UTC',
			});

			const next = it.next().toDate();
			const delay = Math.max(0, next.getTime() - Date.now());

			timeout = setTimeout(async () => {
				await runJob(job);
				scheduleNext();
			}, delay);

			timers.add(timeout);
		};

		if (job.runOnStart) Promise.resolve().then(() => runJob(job));
		scheduleNext();

		return () => {
			stopped = true;
			if (timeout) {
				clearTimeout(timeout);
				timers.delete(timeout);
			}
		};
	};

	const registerSchedule = (name, schedule, ctx) => {
		if (!schedule || typeof schedule !== 'object') throw new Error(`schedule for "${name}" must be an object`);
		if (typeof schedule.fn !== 'function') throw new Error(`schedule.fn for "${name}" must be a function`);

		const job = {
			name,
			fn: schedule.fn,
			ctx,
			running: false,
			lastStart: 0,
			lastEnd: 0,
			lastError: null,
			runOnStart: schedule.runOnStart === true,
			// mode-specific:
			every: null,
			cron: null,
			tz: schedule.tz || 'UTC',
		};

		let stop;

		if (schedule.cron) {
			if (typeof schedule.cron !== 'string') throw new Error(`schedule.cron for "${name}" must be a string`);
			job.cron = schedule.cron;
			stop = startCron(job);
		} else {
			const every = normalizeEvery(schedule.every);
			if (!every) throw new Error(`schedule must include either {cron} or {every} for "${name}"`);
			job.every = every;
			stop = startEvery(job);
		}

		jobs.add(job);

		return () => {
			stop?.();
			jobs.delete(job);
		};
	};

	const stopAll = () => {
		for (const t of timers) {
			try { clearInterval(t); } catch { }
			try { clearTimeout(t); } catch { }
		}
		timers.clear();
		jobs.clear();
	};

	const list = () => [...jobs].map(j => ({
		name: j.name,
		mode: j.cron ? 'cron' : 'every',
		cron: j.cron || null,
		tz: j.tz,
		every: j.every,
		running: j.running,
		lastStart: j.lastStart,
		lastEnd: j.lastEnd,
		lastError: j.lastError ? String(j.lastError?.message || j.lastError) : null,
	}));

	return { registerSchedule, stopAll, list };
};

export default createSchedule;
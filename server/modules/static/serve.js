/*
A simple static asset server attachment to the express server.

Meant to just be a development shim, not meant for production use.
*/

import path from "path";
import express from "express";

const isPlainObject = (value) => {
	if (!value || typeof value !== "object") return false;
	if (Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

export const defaults = {
	route: "/files",
	filesPathEnv: "FILES_PATH",
	filesPath: null,
	allowInProduction: false,
	staticOptions: {
		fallthrough: false,
		index: false,
	},
	notFound: {
		status: 404,
		payload: {
			ok: false,
			error: "File not found",
		},
	},
};

const ensureRoute = (value) => {
	const candidate = typeof value === "string" ? value.trim() : "";
	if (!candidate) return defaults.route;
	return candidate.startsWith("/") ? candidate : `/${candidate}`;
};

export default ({ serverProps, webCore }) => {
	const cfg = isPlainObject(webCore?.config) ? webCore.config : {};
	const route = ensureRoute(cfg.route ?? defaults.route);
	const filesPathEnv = typeof cfg.filesPathEnv === "string" && cfg.filesPathEnv ? cfg.filesPathEnv : defaults.filesPathEnv;
	const filesPath = typeof cfg.filesPath === "string" && cfg.filesPath ? cfg.filesPath : process.env?.[filesPathEnv];
	const allowInProduction = cfg.allowInProduction === true;
	const staticOptions = isPlainObject(cfg.staticOptions)
		? { ...defaults.staticOptions, ...cfg.staticOptions }
		: { ...defaults.staticOptions };

	const notFoundCfg = isPlainObject(cfg.notFound)
		? {
			status: defaults.notFound.status,
			payload: { ...defaults.notFound.payload },
			...cfg.notFound,
		}
		: { ...defaults.notFound };

	const notFoundPayload = isPlainObject(notFoundCfg.payload)
		? { ...defaults.notFound.payload, ...notFoundCfg.payload }
		: { ...defaults.notFound.payload };
	const notFoundStatus = typeof notFoundCfg.status === "number" && Number.isFinite(notFoundCfg.status)
		? Math.max(100, Math.min(599, Math.floor(notFoundCfg.status)))
		: defaults.notFound.status;

	if (!allowInProduction && process.env.NODE_ENV === "production") return;
	if (!filesPath) return; // avoid crashing when env is unset

	const app = serverProps?.app;
	if (!app) return;

	app.use(route, express.static(path.resolve(filesPath), staticOptions));

	app.use(route, (req, res) => {
		res.status(notFoundStatus).json(notFoundPayload);
	});
};

/* A minimal and clean express.js server.
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import express from 'express';
import { createServer as createViteServer } from 'vite';

import core from './core.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
	if (process.env.ENV === 'production') {
		app.use(express.static(path.join(__dirname, '../build')));
		app.get('*', (_req, res) => {
			res.sendFile(path.resolve(__dirname, '../build', 'index.html'));
		});
	} else {
		const vite = await createViteServer({ server: { middlewareMode: 'html' } });

		app.use(vite.middlewares);

		app.get('*', async (req, res, next) => {
			try {
				const html = await vite.transformIndexHtml(
					req.originalUrl,
					fs.readFileSync(
						path.resolve(__dirname, 'index.html'),
						'utf-8'
					)
				);

				res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
			} catch (e) {
				vite.ssrFixStacktrace(e);
				next(e);
			}
		});
	}

	core(app.listen(process.env.PORT || 3000, () => { }))
})();

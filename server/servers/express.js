import fs from 'fs';
import express from 'express';

// express server driver:
export default () => {
	const app = express();

	return {
		production: ({ root }) => {
			app.use(express.static(root));

			app.get('*', (req, res) => {
				res.sendFile('index.html', { root }, err => {
					if (err) {
						res.status(500).send(err);
						console.error('Error serving index.html:', err);
					}
				});
			});
		},
		development: ({ vite }) => {
			app.use(vite.middlewares);

			app.get('*', async (req, res, next) => {
				try {
					const html = await vite.transformIndexHtml(
						req.originalUrl,
						fs.readFileSync(
							path.resolve(root, 'index.html'),
							'utf-8'
						)
					);

					res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
				} catch (e) {
					vite.ssrFixStacktrace(e);
					next(e);
				}
			});
		},
		listen: (port) => app.listen(port || 3000, () => {
			console.log(`destam-web-core running on http://localhost:${port || 3000}/ using express.js server.`);
		})
	}
};

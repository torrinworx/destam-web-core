import multer from 'multer';
import cookieParser from 'cookie-parser';

export const deps = ['files/Create', 'moderation/images'];

const ALLOWED_MIMES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
]);

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export default ({ serverProps, Create: addFile, images: modImg, odb }) => {
	const app = serverProps.app;
	app.use(cookieParser());

	const upload = multer({
		storage: multer.memoryStorage(),
		limits: { fileSize: MAX_BYTES },
	});

	app.post('/api/upload', upload.single('file'), async (req, res) => {
		try {
			if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });

			// Basic file checks early
			const { mimetype, size, buffer, originalname } = req.file;

			if (!ALLOWED_MIMES.has(mimetype)) {
				return res.status(400).json({
					ok: false,
					error: `Unsupported file type: ${mimetype}`,
				});
			}

			if (!buffer || !buffer.length) {
				return res.status(400).json({ ok: false, error: 'Empty file' });
			}

			// Auth/session checks
			const token = req.cookies?.webcore;
			if (!token) return res.status(401).json({ ok: false, error: 'Missing session token' });

			const session = await odb.findOne({ collection: 'sessions', query: { uuid: token } });
			if (!session) return res.status(401).json({ ok: false, error: 'Invalid session' });

			const now = Date.now();
			if (!session.status) {
				return res.status(401).json({ ok: false, error: 'Session disabled' });
			}
			if (typeof session.expires !== 'number' || session.expires <= now) {
				return res.status(401).json({ ok: false, error: 'Session expired' });
			}

			// New shape: session.user (but allow legacy session.query.user during migration)
			const user = session.user ?? session.query?.user ?? null;
			if (!user) return res.status(401).json({ ok: false, error: 'Session has no user' });

			// ---- MODERATION (before persistence) ----
			const base64 = buffer.toString('base64');

			const mod = await modImg({
				imageBase64: base64,
				mimeType: mimetype === 'image/jpg' ? 'image/jpeg' : mimetype,
			});

			if (!mod?.ok) {
				return res.status(400).json({
					ok: false,
					error: 'Image failed moderation',
					reason: mod?.reason || 'Moderation failed',
				});
			}

			// ---- Only now persist the file ----
			const fileId = await addFile({
				user,
				file: req.file,
				meta: {
					ip: req.ip,
					originalname,
					mimetype,
					size,
					moderation: {
						passed: true,
						reason: mod.reason,
						categories: mod.categories,
						scores: mod.scores,
					},
				},
			});

			return res.json(fileId);
		} catch (err) {
			console.error('upload error:', err);
			return res.status(500).json({ ok: false, error: 'Internal error' });
		}
	});
};

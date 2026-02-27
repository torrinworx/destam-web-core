const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export const defaults = {
	route: '/api/geo/search',
	baseUrl: 'https://nominatim.openstreetmap.org/search',
	userAgent: 'KWBuilds/0.1 (contact: torrin@torrin.me)',
	referer: null,
	acceptLanguage: 'en',
	email: null,
	minQueryLength: 3,
	maxResults: 8,
	cacheTtlMs: 1000 * 60 * 60 * 24,
	cacheMaxSize: 512,
	globalRateLimitMs: 1000,
	ipRateLimitMs: 1000,
	requestTimeoutMs: 8000,
	attributionText: '© OpenStreetMap contributors',
	messages: {
		missingQuery: 'Missing search query',
		queryTooShort: 'Query is too short',
		rateLimited: 'Rate limited, please try again shortly',
		upstreamError: 'Geocoding service error',
		internalError: 'Internal error',
	},
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeQuery = (q) => {
	if (typeof q !== 'string') return '';
	return q.trim().replace(/\s+/g, ' ');
};

const createCache = (maxSize) => {
	const store = new Map();

	const get = (key, ttlMs) => {
		const item = store.get(key);
		if (!item) return null;
		if (ttlMs > 0 && Date.now() - item.ts > ttlMs) {
			store.delete(key);
			return null;
		}
		return item.value;
	};

	const set = (key, value) => {
		store.set(key, { ts: Date.now(), value });
		if (store.size <= maxSize) return;
		const firstKey = store.keys().next().value;
		if (firstKey) store.delete(firstKey);
	};

	return { get, set };
};

export default ({ webCore } = {}) => {
	const cfg = webCore?.config || {};
	const messages = isPlainObject(cfg.messages) ? { ...defaults.messages, ...cfg.messages } : defaults.messages;

	const baseUrl = typeof cfg.baseUrl === 'string' && cfg.baseUrl ? cfg.baseUrl : defaults.baseUrl;
	const userAgent = typeof cfg.userAgent === 'string' && cfg.userAgent ? cfg.userAgent : defaults.userAgent;
	const referer = typeof cfg.referer === 'string' && cfg.referer ? cfg.referer : defaults.referer;
	const acceptLanguage = typeof cfg.acceptLanguage === 'string' && cfg.acceptLanguage ? cfg.acceptLanguage : defaults.acceptLanguage;
	const email = typeof cfg.email === 'string' && cfg.email ? cfg.email : defaults.email;
	const minQueryLength = Number.isFinite(cfg.minQueryLength) ? Math.max(1, Math.floor(cfg.minQueryLength)) : defaults.minQueryLength;
	const maxResults = Number.isFinite(cfg.maxResults) ? clamp(Math.floor(cfg.maxResults), 1, 50) : defaults.maxResults;
	const cacheTtlMs = Number.isFinite(cfg.cacheTtlMs) ? Math.max(0, Math.floor(cfg.cacheTtlMs)) : defaults.cacheTtlMs;
	const cacheMaxSize = Number.isFinite(cfg.cacheMaxSize) ? clamp(Math.floor(cfg.cacheMaxSize), 1, 5000) : defaults.cacheMaxSize;
	const globalRateLimitMs = Number.isFinite(cfg.globalRateLimitMs)
		? Math.max(0, Math.floor(cfg.globalRateLimitMs))
		: defaults.globalRateLimitMs;
	const ipRateLimitMs = Number.isFinite(cfg.ipRateLimitMs)
		? Math.max(0, Math.floor(cfg.ipRateLimitMs))
		: defaults.ipRateLimitMs;
	const requestTimeoutMs = Number.isFinite(cfg.requestTimeoutMs)
		? Math.max(1000, Math.floor(cfg.requestTimeoutMs))
		: defaults.requestTimeoutMs;
	const attributionText = typeof cfg.attributionText === 'string' && cfg.attributionText
		? cfg.attributionText
		: defaults.attributionText;

	const cache = createCache(cacheMaxSize);
	let lastGlobalAt = 0;
	const lastIpAt = new Map();

	const checkRate = (ip) => {
		const now = Date.now();
		if (globalRateLimitMs > 0 && now - lastGlobalAt < globalRateLimitMs) {
			return { ok: false, retryAfterMs: globalRateLimitMs - (now - lastGlobalAt) };
		}

		if (ipRateLimitMs > 0 && ip) {
			const prev = lastIpAt.get(ip) || 0;
			if (now - prev < ipRateLimitMs) {
				return { ok: false, retryAfterMs: ipRateLimitMs - (now - prev) };
			}
		}

		lastGlobalAt = now;
		if (ip) lastIpAt.set(ip, now);
		return { ok: true };
	};

	return {
		authenticated: false,
		onMsg: async ({ q, limit } = {}, { ip } = {}) => {
			try {
				const query = normalizeQuery(q);
				if (!query) return { ok: false, error: messages.missingQuery };
				if (query.length < minQueryLength) return { ok: false, error: messages.queryTooShort };

				const rate = checkRate(ip);
				if (!rate.ok) {
					return { ok: false, error: messages.rateLimited, retryAfterMs: rate.retryAfterMs };
				}

				const safeLimit = Number.isFinite(parseInt(limit, 10))
					? clamp(parseInt(limit, 10), 1, maxResults)
					: maxResults;

				const cacheKey = `${query.toLowerCase()}|${safeLimit}`;
				const cached = cache.get(cacheKey, cacheTtlMs);
				if (cached) {
					return { ok: true, results: cached, attribution: attributionText, cached: true };
				}

				const params = new URLSearchParams({
					format: 'json',
					addressdetails: '1',
					limit: String(safeLimit),
					q: query,
				});
				if (acceptLanguage) params.set('accept-language', acceptLanguage);
				if (email) params.set('email', email);

				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

				let response;
				try {
					response = await fetch(`${baseUrl}?${params.toString()}`, {
						headers: {
							'User-Agent': userAgent,
							...(referer ? { Referer: referer } : {}),
						},
						signal: controller.signal,
					});
				} finally {
					clearTimeout(timeout);
				}

				if (!response?.ok) {
					return { ok: false, error: messages.upstreamError };
				}

				const data = await response.json();
				if (!Array.isArray(data)) {
					return { ok: false, error: messages.upstreamError };
				}

				const results = data.map(item => ({
					label: item?.display_name ?? '',
					lat: parseFloat(item?.lat),
					lng: parseFloat(item?.lon),
					type: item?.type ?? item?.class ?? '',
					raw: item,
				})).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));

				cache.set(cacheKey, results);
				return { ok: true, results, attribution: attributionText, cached: false };
			} catch (err) {
				if (err?.name === 'AbortError') {
					return { ok: false, error: messages.upstreamError };
				}
				console.error('nominatim search error:', err);
				return { ok: false, error: messages.internalError };
			}
		},
	};
};

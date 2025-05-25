// stolen from: https://stackoverflow.com/a/63952971/15739035
// Listen for when web-core cookie is changed, re-init state if webcore cookie deleted (only deleted on signout)
// document.addEventListener('cookiechange', async ({ detail: { newValue, oldValue } }) => {
// });
export const cookieUpdates = () => {
	const parseCookieString = (cookieString) => {
		const result = {};
		cookieString.split('; ').forEach(cookie => {
			const [key, value] = cookie.split('=');
			result[key] = value;
		});
		return result;
	};

	const areCookiesEqual = (cookieA, cookieB) => {
		// Check that all keys and values are the same
		if (Object.keys(cookieA).length !== Object.keys(cookieB).length) return false;
		for (const key in cookieA) {
			if (cookieA[key] !== cookieB[key]) {
				return false;
			}
		}
		return true;
	};

	let lastCookie = parseCookieString(document.cookie);
	const expando = '_cookie';
	let nativeCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

	Object.defineProperty(Document.prototype, expando, nativeCookieDesc);
	Object.defineProperty(Document.prototype, 'cookie', {
		enumerable: true,
		configurable: true,
		get() {
			return this[expando];
		},
		set(value) {
			this[expando] = value;
			let cookie = parseCookieString(this[expando]);
			if (!areCookiesEqual(cookie, lastCookie)) {
				try {
					let detail = { oldValue: lastCookie, newValue: cookie };
					this.dispatchEvent(new CustomEvent('cookiechange', {
						detail: detail
					}));
					channel.postMessage(detail);
				} finally {
					lastCookie = cookie;
				}
			}
		}
	});

	const channel = new BroadcastChannel('cookie-channel');
	channel.onmessage = (e) => {
		lastCookie = e.data.newValue;
		document.dispatchEvent(new CustomEvent('cookiechange', {
			detail: e.data
		}));
	};
};

export const getCookie = (name) => {
	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) return parts.pop().split(';').shift();
};

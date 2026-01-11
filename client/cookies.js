import { Observer } from 'destamatic-ui';

// snapshot once on module load
const initialToken = (() => {
	const value = `; ${document.cookie}`;
	const parts = value.split(`; webcore=`);
	if (parts.length === 2) return parts.pop().split(';').shift() || '';
	return '';
})();

export const webcoreToken = Observer.mutable(initialToken);

export const setWebcoreToken = (token) => {
	webcoreToken.set(token || '');
	if (!token) return;

	const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
	document.cookie = `webcore=${token}; expires=${expires}; path=/; SameSite=Lax`;
};

export const clearWebcoreToken = () => {
	webcoreToken.set('');
	document.cookie = 'webcore=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
};

export const getCookie = (name) => {
	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) return parts.pop().split(';').shift();
};

import { Observer } from 'destam';

const readCookie = (name) => {
	if (typeof document === 'undefined') return '';
	const value = `; ${document.cookie}`;
	const parts = value.split(`; ${name}=`);
	if (parts.length === 2) return parts.pop().split(';').shift() || '';
	return '';
};

export const webcoreToken = Observer.mutable(readCookie('webcore'));

export const setWebcoreToken = (token) => {
	token = token || '';
	webcoreToken.set(token);

	if (typeof document === 'undefined') return;

	const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
	const secure = window.location.protocol === 'https:' ? '; Secure' : '';
	document.cookie = `webcore=${token}; expires=${expires}; path=/; SameSite=Lax${secure}`;
};

export const clearWebcoreToken = () => {
	webcoreToken.set('');

	if (typeof document === 'undefined') return;

	const secure = window.location.protocol === 'https:' ? '; Secure' : '';
	document.cookie = `webcore=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax${secure}`;
};

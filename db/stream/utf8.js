// implements encode/decode functions for utf8 using UInt8Arrays for browser
// compatability outside of nodejs. npm packages exist for this, but they are
// too complicated for what they implement (pull in unecessary dependencies or
// work with byte strings)
import { assert } from 'destam/util.js';

export const decode = (bytes) => {
	let out = '';

	for (let i = 0; i < bytes.length;) {
		let root = bytes[i++];

		let len = 0;
		if (root & 0x80) {
			if ((root & 0xE0) === 0xC0) { // two byte sequence
				len = 1;
				root &= 0x1F;
			} else if ((root & 0xF0) === 0xE0) { // three bytes
				len = 2;
				root &= 0x0F;
			} else if ((root & 0xF8) === 0xF0) { // four bytes
				len = 3;
				root &= 0x07;
			}

			assert(len, "utf8 multi byte sequence has unknown signature");
		}

		for (let ii = 0; ii < len; ii++) {
			assert(i < bytes.length, "utf8 byte sequence ends unexpectedly");
			const next = bytes[i++] || 0;

			assert((next & 0xC0) === 0x80, "utf8 low surrogate is malformed");
			root = (root << 6) | (next & 0x3F);
		}

		out += String.fromCodePoint(root);
	}

	return out;
};

const bits = bits => ((1 << bits) - 1);
export const encode = str => {
	const bytes = [];

	for (const char of str) {
		let root = char.codePointAt(0);

		if ((root & ~bits(7)) === 0) { // char code fits in 7 bits
			bytes.push(root);
		} else {
			let len = 0;
			if ((root & ~bits(6 + 5)) === 0) {
				len = 1;
				bytes.push(((root >> 6) & 0x1F) | 0xC0);
			} else if ((root & ~bits(2 * 6 + 4)) === 0) {
				len = 2;
				bytes.push(((root >> 12) & 0x0F) | 0xE0);
			} else if ((root & ~bits(3 * 6 + 3)) === 0) {
				len = 3;
				bytes.push(((root >> 18) & 0x07) | 0xF0);
			}

			assert(len, "utf8 point code too large to encode: " + root.toString(16));

			while (len-- > 0) {
				bytes.push(((root >> (len * 6)) & 0x3F) | 0x80);
			}
		}
	}

	return bytes;
};

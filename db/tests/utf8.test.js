import {encode, decode} from '../stream/utf8.js';
import {test} from 'node:test';
import assert from 'node:assert';

const cycle = (str, len) => {
	let encoded = encode(str);
	if (len) assert.equal(encoded.length, len);
	assert.equal(decode(encoded), str);
};

const errorDecode = bytes => {
	let thrown = false;
	try {
		decode(bytes);
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
};

test("utf8 single byte", () => {
	cycle("Hello!", 6);
	cycle(" ", 1);
	cycle("\x7F", 1);
	cycle("\0", 1);
});

test("utf8 two bytes", () => {
	cycle("¢", 2);
	cycle("Ö", 2);
	cycle("ñ", 2);
	cycle("\u07FF", 2);
});

test("utf8 three bytes", () => {
	cycle("अ", 3);
	cycle("字", 3);
	cycle("€", 3);
	cycle("\uFFFF", 3);
});

test("utf8 four bytes", () => {
	cycle("𐍈", 4);
	cycle("𝒜", 4);
	cycle("🌍", 4);
	cycle("\u{10FFFF}", 4);
	cycle("𐀀𐀁𐀂", 4 * 3);
});

test('utf8 assert decode', () => {
	errorDecode([0xC0]);
	errorDecode([0xE0, 0x80]);
	errorDecode([0xE0, 0x00]);
	errorDecode([0xF0, 0x80, 0x80]);
	errorDecode([0x80]);
});

test('utf8 assert encode', () => {
	let thrown = false;
	try {
		encode(String.fromCodePoint("0x110000"));
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

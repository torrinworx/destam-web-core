import {encodeLean as encode, decodeLean as decode, encode as encodeFull, decode as decodeFull, copy, register} from '../message/Message.js';
import UUID from 'destam/UUID.js';
import OObject from 'destam/Object.js';
import OArray from 'destam/Array.js';
import OMap from 'destam/UUIDMap.js';
import WriteStream from '../stream/write.js';
import createNetwork from 'destam/Tracking.js';

import {describe, it, test} from 'node:test';
import assert from 'node:assert';

import '../message/observers.js';
import '../message/primitives.js';

register(Buffer, {
	extend: 'uint8a',
});

function tuple (a, b) {
	this.a = a;
	this.b = b;
};

register([tuple], {
	name: 'tuple',
	alloc: 2,
	lower: (tup) => [tup.a, tup.b],
	higher: values => new tuple(values[0], values[1]),
});

// redefine the tuple, should just overwrite the old one.
register(tuple, {
	name: 'tuple',
	alloc: 2,
	lower: (tup) => [tup.a, tup.b],
	higher: values => new tuple(values[0], values[1]),
});

[
	cb => {
		describe('serialize stream', () => {
			cb({test: it, cycle: async (obj, equ) => {
				const [readStream, writeStream] = WriteStream.createPassthrough(128);
				encode(obj, writeStream);
				const decoded = await decode(readStream);

				if (equ) {
					equ(decoded, obj);
				} else {
					assert.deepStrictEqual(obj, decoded);
				}
			}});
		});
	},
	cb => {
		describe('serialize full stream', () => {
			cb({test: it, cycle: async (obj, equ) => {
				const [readStream, writeStream] = WriteStream.createPassthrough(128);
				encodeFull(obj, writeStream);
				const decoded = await decodeFull(readStream);

				if (equ) {
					equ(decoded, obj);
				} else {
					assert.deepStrictEqual(obj, decoded);
				}
			}});
		});
	},
	cb => {
		describe('serialize', () => {
			cb({test: it, cycle: async (obj, equ) => {
				const bytes = await encode(obj);
				const decoded = await decode(bytes);

				if (equ) {
					equ(decoded, obj);
				} else {
					assert.deepStrictEqual(obj, decoded);
				}
			}});
		});
	},
	cb => {
		describe('serialize full', () => {
			cb({test: it, cycle: async (obj, equ) => {
				const bytes = await encodeFull(obj);
				const decoded = await decodeFull(bytes);

				if (equ) {
					equ(decoded, obj);
				} else {
					assert.deepStrictEqual(obj, decoded);
				}
			}});
		});
	},
	cb => {
		describe('copy', () => {
			cb({test: it, cycle: async (obj, equ) => {
				let decoded = copy(obj);

				if (equ) {
					equ(decoded, obj);
				} else {
					assert.deepStrictEqual(obj, decoded);
				}
			}});
		});
	},
].forEach(cb => cb(({test, cycle}) => {
	test("basic integer", () => {
		return cycle(0);
	});

	test("decimal", async () => {
		await cycle(100.125871);
		await cycle(-100.125871);
		await cycle(100);
		await cycle(-1000000);
		await cycle(Number.MAX_VALUE);
		await cycle(Number.MIN_VALUE);
		await cycle(Number.MAX_SAFE_INTEGER);
		await cycle(Number.MIN_SAFE_INTEGER);
		await cycle(0xFFFFFFFF);
		await cycle(-0xFFFFFFFF);
	});

	test("bigint", async () => {
		await cycle(BigInt(0));
		await cycle(BigInt(-0));
		await cycle(BigInt("-918347508913745098347502983457039847502984570238947520984570"));
		await cycle(BigInt("918347508913745098347502983457039847502984570238947520984570"));
		await cycle(2n ** 10000n);
	});

	test("strings", async() => {
		await cycle("");
		await cycle("hello world");
		await cycle("இந்தியா");
		await cycle("\0nulls in this string\0");
		await cycle("💯🔢😀😬😁😂😃😄😅😆😇😉😊🙂🙃☺😋😌😍😘😗😙😚😜😝😛🤑🤓😎🤗😏😶😐😑😒🙄🤔😳😞😟😠😡😔😕🙁☹😣😖😫😩😤😮😱😨😰😯😦😧😢😥😪😓😭😵😲🤐😷🤒🤕😴💤💩😈👿👹👺💀👻👽🤖😺😸😹😻😼😽🙀😿😾🙌👏👋👍👎👊✊✌👌✋👐💪🙏☝👆👇👈👉🖕🖐🤘🖖✍💅👄👅👂👃👁👀👤👥🗣👶👦👧👨👩👱👴👵👲👳👮👷💂🕵🎅👼👸👰🚶🏃💃👯👫👬👭🙇💁🙅🙆🙋🙎🙍💇💆💑👩👨💏👩👨👪👨👨👨👨👩👩👩👩👩👨👨👨👨👨👚👕👖👔👗👙👘💄💋👣👠👡👢👞👟👒🎩⛑🎓👑🎒👝👛👜💼👓🕶💍🌂🐶🐱🐭🐹🐰🐻🐼🐨🐯🦁🐮🐷🐽🐸🐙🐵🙈🙉🙊🐒🐔🐧🐦🐤🐣🐥🐺🐗🐴🦄🐝🐛🐌🐞🐜🕷🦂🦀🐍🐢🐠🐟🐡🐬🐳🐋🐊🐆🐅🐃🐂🐄🐪🐫🐘🐐🐏🐑🐎🐖🐀🐁🐓🦃🕊🐕🐩🐈🐇🐿🐾🐉🐲🌵🎄🌲🌳🌴🌱🌿☘🍀🎍🎋🍃🍂🍁🌾🌺🌻🌹🌷🌼🌸💐🍄🌰🎃🐚🕸🌎🌍🌏🌕🌖🌗🌘🌑🌒🌓🌔🌚🌝🌛🌜🌞🌙⭐🌟💫✨☄☀🌤⛅🌥🌦☁🌧⛈🌩⚡🔥💥❄🌨☃⛄🌬💨🌪🌫☂☔💧💦🌊🍏🍎🍐🍊🍋🍌🍉🍇🍓🍈🍒🍑🍍🍅🍆🌶🌽🍠🍯🍞🧀🍗🍖🍤🍳🍔🍟🌭🍕🍝🌮🌯🍜🍲🍥🍣🍱🍛🍙🍚🍘🍢🍡🍧🍨🍦🍰🎂🍮🍬🍭🍫🍿🍩🍪🍺🍻🍷🍸🍹🍾🍶🍵☕🍼🍴🍽⚽🏀🏈⚾🎾🏐🏉🎱⛳🏌🏓🏸🏒🏑🏏🎿⛷🏂⛸🏹🎣🚣🏊🏄🛀⛹🏋🚴🚵🏇🕴🏆🎽🏅🎖🎗🏵🎫🎟🎭🎨🎪🎤🎧🎼🎹🎷🎺🎸🎻🎬🎮👾🎯🎲🎰🎳🚗🚕🚙🚌🚎🏎🚓🚑🚒🚐🚚🚛🚜🏍🚲🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚝🚄🚅🚈🚞🚂🚆🚇🚊🚉🚁🛩✈🛫🛬⛵🛥🚤⛴🛳🚀🛰💺⚓🚧⛽🚏🚦🚥🏁🚢🎡🎢🎠🏗🌁🗼🏭⛲🎑⛰🏔🗻🌋🗾🏕⛺🏞🛣🛤🌅🌄🏜🏖🏝🌇🌆🏙🌃🌉🌌🌠🎇🎆🌈🏘🏰🏯🏟🗽🏠🏡🏚🏢🏬🏣🏤🏥🏦🏨🏪🏫🏩💒🏛⛪🕌🕍🕋⛩⌚📱📲💻⌨🖥🖨🖱🖲🕹🗜💽💾💿📀📼📷📸📹🎥📽🎞📞☎📟📠📺📻🎙🎚🎛⏱⏲⏰🕰⏳⌛📡🔋🔌💡🔦🕯🗑🛢💸💵💴💶💷💰💳💎⚖🔧🔨⚒🛠⛏🔩⚙⛓🔫💣🔪🗡⚔🛡🚬☠⚰⚱🏺🔮📿💈⚗🔭🔬🕳💊💉🌡🏷🔖🚽🚿🛁🔑🗝🛋🛌🛏🚪🛎🖼🗺⛱🗿🛍🎈🎏🎀🎁🎊🎉🎎🎐🎌🏮✉📩📨📧💌📮📪📫📬📭📦📯📥📤📜📃📑📊📈📉📄📅📆🗓📇🗃🗳🗄📋🗒📁📂🗂🗞📰📓📕📗📘📙📔📒📚📖🔗📎🖇✂📐📏📌📍🚩🏳🏴🔐🔒🔓🔏🖊🖋✒📝✏🖍🖌🔍🔎❤💛💚💙💜💔❣💕💞💓💗💖💘💝💟☮✝☪🕉☸✡🔯🕎☯☦🛐⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛🈳🈹☢☣📴📳🈶🈚🈸🈺🈷✴🆚🉑💮🉐㊙㊗🈴🈵🈲🅰🅱🆎🆑🅾🆘⛔📛🚫❌⭕💢♨🚷🚯🚳🚱🔞📵❗❕❓❔‼⁉🔅🔆🔱⚜〽⚠🚸🔰♻🈯💹❇✳❎✅💠🌀➿🌐Ⓜ🏧🈂🛂🛃🛄🛅♿🚭🚾🅿🚰🚹🚺🚼🚻🚮🎦📶🈁🆖🆗🆙🆒🆕🆓0123456789🔟▶⏸⏯⏹⏺⏭⏮⏩⏪🔀🔁🔂◀🔼🔽⏫⏬➡⬅⬆⬇↗↘↙↖↕↔🔄↪↩⤴⤵#*ℹ🔤🔡🔠🔣🎵🎶〰➰✔🔃➕➖➗✖💲💱©®™🔚🔙🔛🔝🔜☑🔘⚪⚫🔴🔵🔸🔹🔶🔷🔺▪▫⬛⬜🔻◼◻◾◽🔲🔳🔈🔉🔊🔇📣📢🔔🔕🃏🀄♠♣♥♦🎴💭🗯💬🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛🕜🕝🕞🕟🕠🕡🕢🕣🕤🕥🕦🕧👁🇦🇦🇦🇩🇦🇦🇦🇦🇦🇦🇦🇦🇦🇦🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇧🇨🇰🇨🇨🇰🇨🇹🇨🇨🇨🇰🇨🇨🇨🇭🇨🇨🇨🇩🇩🇩🇩🇪🇪🇸🇬🇪🇪🇪🇫🇫🇫🇫🇫🇵🇬🇬🇬🇩🇬🇬🇬🇬🇬🇬🇬🇬🇬🇬🇭🇭🇭🇭🇮🇮🇮🇮🇮🇮🇮🇮🇨🇯🇯🇯🇯🇰🇰🇰🇽🇰🇰🇱🇱🇱🇱🇱🇱🇱🇱🇱🇲🇲🇲🇲🇲🇲🇲🇲🇲🇲🇲🇲🇫🇲🇲🇲🇲🇲🇲🇲🇲🇳🇳🇳🇳🇳🇳🇳🇳🇳🇳🇰🇳🇴🇵🇵🇵🇵🇵🇵🇵🇵🇵🇵🇵🇶🇷🇷🇷🇸🇰🇱🇻🇼🇸🇸🇸🇸🇷🇸🇸🇸🇸🇸🇸🇸🇿🇰🇪🇱🇸🇸🇸🇸🇨🇸🇹🇹🇹🇹🇹🇹🇹🇹🇹🇹🇹🇹🇺🇺🇦🇬🇺🇻🇺🇺🇻🇻🇻🇻🇼🇪🇾🇿🇿🇷🇦🇹🇮🇧🇨🇨🇬🇮🇾🇳🇵🇧🇵🇬🇹🇧🇭🇸🇺🇮🇪🇨🇩🇦🇦🇻🇨🇨🇪🇬🇹🇬🇲🇲🇸🇸🇹🇲🙌🙌🙌🙌🙌👏👏👏👏👏👋👋👋👋👋👍👍👍👍👍👎👎👎👎👎👊👊👊👊👊✊✊✊✊✊✌✌✌✌✌👌👌👌👌👌✋✋✋✋✋👐👐👐👐👐💪💪💪💪💪🙏🙏🙏🙏🙏☝☝☝☝☝👆👆👆👆👆👇👇👇👇👇👈👈👈👈👈👉👉👉👉👉🖕🖕🖕🖕🖕🖐🖐🖐🖐🖐🤘🤘🤘🤘🤘🖖🖖🖖🖖🖖✍✍✍✍✍💅💅💅💅💅👂👂👂👂👂👃👃👃👃👃👶👶👶👶👶👦👦👦👦👦👧👧👧👧👧👨👨👨👨👨👩👩👩👩👩👱👱👱👱👱👴👴👴👴👴👵👵👵👵👵👲👲👲👲👲👳👳👳👳👳👮👮👮👮👮👷👷👷👷👷💂💂💂💂💂🎅🎅🎅🎅🎅👼👼👼👼👼👸👸👸👸👸👰👰👰👰👰🚶🚶🚶🚶🚶🏃🏃🏃🏃🏃💃💃💃💃💃🙇🙇🙇🙇🙇💁💁💁💁💁🙅🙅🙅🙅🙅🙆🙆🙆🙆🙆🙋🙋🙋🙋🙋🙎🙎🙎🙎🙎🙍🙍🙍🙍🙍💇💇💇💇💇💆💆💆💆💆🚣🚣🚣🚣🚣🏊🏊🏊🏊🏊🏄🏄🏄🏄🏄🛀🛀🛀🛀🛀⛹⛹⛹⛹⛹🏋🏋🏋🏋🏋🚴🚴🚴🚴🚴🚵🚵🚵🚵🚵🏇🏇🏇🏇🏇🕵🕵🕵🕵🕵🏻🏼🏽🏾🏿🤴🤴🤴🤴🤴🤶🤶🤶🤶🤶🤵🤵🤵🤵🤵🤷🤷🤷🤷🤷🤦🤦🤦🤦🤦🤰🤰🤰🤰🤰🕺🕺🕺🕺🕺🤳🤳🤳🤳🤳🤞🤞🤞🤞🤞🤙🤙🤙🤙🤙🤛🤛🤛🤛🤛🤜🤜🤜🤜🤜🤚🤚🤚🤚🤚🤝🤝🤝🤝🤝🤸🤸🤸🤸🤸🤼🤼🤼🤼🤼🤽🤽🤽🤽🤽🤾🤾🤾🤾🤾🤹🤹🤹🤹🤹🗨⏏🏳🤠🤡🤢🤣🤤🤥🤧🤴🤵🤶🤦🤷🤰🤳🕺🤙🤚🤛🤜🤝🤞🖤🦅🦆🦇🦈🦉🦊🦋🦌🦍🦎🦏🥀🥐🥑🥒🥓🥔🥕🥖🥗🥘🥙🥂🥃🥄🛑🛒🛴🛵🛶🤸🤹🤼🥊🥋🤽🤾🥅🤺🥇🥈🥉🥁🦐🦑🥚🥛🥜🥝🥞🇿🇾🇽🇼🇻🇺🇹🇸🇷🇶🇵🇴🇳🇲🇱🇰🇯🇮🇭🇬🇫🇪🇩🇨🇧🇦");
		await cycle("𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡");
	});

	test("booleans", async () => {
		await cycle(true);
		await cycle(false);
	});

	test("null", async () => {
		await cycle(null);
	});

	test("NaN", async () => {
		await cycle(NaN);
	});

	test("undefined", async () => {
		await cycle(undefined);
	});

	test("array", async () => {
		await cycle([]);
		await cycle([1000, 1001, 1002, 1003, 1, 1004]);
		await cycle([1000, 1001, 1002, 1003, 1003, 1004]);
		await cycle(new Array(1024).fill(0));
		await cycle(new Array(1024).fill(0).map(value => Math.floor(Math.random() * 1000000)));
	});

	test("object", async () => {
		await cycle({});
		await cycle({
			'hello': {},
			'dude': 'dude'
		});
		await cycle({
			'hello': {},
			'hello copy': {},
			'dude': 'dude'
		});
	});

	test("set", async () => {
		await cycle(new Set(['a', 'b', 'c', 'd']));
	});

	test("map", async () => {
		await cycle(new Map(Object.entries({
			'one': 1,
			'two': 2,
			'three': 3,
			'four': 4,
		})));
	});

	test("nested objects", async () => {
		await cycle({
			other_object: {
				'hello': {},
				'dude': 'dude',
			}
		});

		await cycle({
			mixed_objects: {
				'hello': {},
				'dude': 'dude',
				'array': [10, 20, 30, 4000]
			}
		});

		await cycle({
			mixed_objects: {
				'hello': new Uint8Array(10),
				'array': [new Uint8Array(10)],
			}
		});
	});

	test("date", async () => {
		await cycle(new Date("2020-04-25T00:00:00.000"));
		await cycle(new Date(0));
		await cycle(new Date("4062-01-24T00:00:00.000"));
		await cycle(new Date());
	});

	test("ArrayBuffers", async () => {
		await cycle(new Uint8Array(1024));
		await cycle(new Int32Array(16));
	});

	test("uuid2", async () => {
		await cycle(UUID(2));
		await cycle(UUID(2));
		await cycle(UUID(2));
		await cycle(UUID(2));
	});

	test("uuid4", async () => {
		await cycle(UUID(4));
		await cycle(UUID(4));
		await cycle(UUID(4));
		await cycle(UUID(4));
	});

	test("uuid8", async () => {
		await cycle(UUID(8));
		await cycle(UUID(8));
		await cycle(UUID(8));
		await cycle(UUID(8));
	});

	test('oobject', async () => {
		await cycle(OObject({
			'hello': 'world'
		}));
	});

	test('oarray', async () => {
		await cycle(OArray([90, 91, 92]));
	});

	test('omap', async () => {
		await cycle(OMap([OObject({id: UUID()})]));
	});

	test('omap empty preamble', async () => {
		await cycle(OArray([
			OMap(),
			OMap([OObject({id: UUID()})])
		]));
	});

	test('basic observer events', () => {
		let obj = OObject();

		let stuff = [];
		obj.observer.watch(event => {
			stuff.push(cycle(event, (a, b) => {
				assert.deepStrictEqual(a.id, b.id);
			}));
		});

		obj.thing = 'thing';
		obj.thing = undefined;
		delete obj.thing;

		return Promise.all(stuff);
	});

	test('very big object', async () => {
		let object = Object.fromEntries(new Array(1024).fill(null).map((_, index) => [String(index), index]));

		await cycle(object);
	});

	test('very big array', async () => {
		let object = new Array(1024).fill(null).map((_, index) => index);

		await cycle(object);
	});

	test('very big oobject', async () => {
		let object = OObject(Object.fromEntries(new Array(1024).fill(null).map((_, index) => [String(index), index])));

		await cycle(object);
	});

	test('very big oarray', async () => {
		let object = OArray(new Array(1024).fill(null).map((_, index) => index));

		await cycle(object);
	});

	test('circular reference object', async () => {
		let object = {};
		object.thing = {thing2: object};

		await cycle(object);
	});

	test('circular reference array', async () => {
		let array = [];
		array[0] = {thing2: array};

		await cycle(array);
	});

	test('many points in array', async () => {
		let array = new Array(1024).fill(null).map(() => [Math.random(), Math.random(), Math.random()]);

		await cycle(array);
	});

	test('url search params', async () => {
		let form = new URLSearchParams();
		form.append('hello', 1);

		await cycle(form);
	});

	test('nodejs buffer', async () => {
		await cycle(Buffer.from([1, 2, 3]), (a, b) => assert.deepStrictEqual(b, Buffer.from(a)));
	});

	test('object with hidden properties', async () => {
		await cycle({_hello: 1, $world: 2, yes: 1}, (a) => assert.deepStrictEqual(a, {yes: 1}))
	});

	test('oobject with hidden properties', async () => {
		await cycle(OObject({_hello: 1, $world: 2, yes: 1}), (a) => assert.deepStrictEqual(a, OObject({yes: 1})))
	});

	test('empty then full object', async () => {
		await cycle([
			{},
			{
				prop: OObject(),
			}
		]);
		await cycle([
			{
				prop: OObject(),
			},
			{},
		]);
	});

	test('oobject and id seperately', async () => {
		await cycle([
			UUID(),
			OObject({})
		]);
		await cycle([
			OObject({}),
			UUID(),
		]);
	});

	test('tuple', async () => {
		await cycle([
			new tuple(null, null),
			{},
			new tuple({}, {}),
		]);
		await cycle([
			new tuple({}, {}),
			{},
			new tuple(null, null),
		]);
	});

	test('oobject mixed ids', async () => {
		await cycle([
			OObject({}, null),
			UUID(),
			OObject({}),
		]);
		await cycle([
			OObject({}),
			UUID(),
			OObject({}, null),
		]);
	});

	test('duplicate objects', async () => {
		const obj = {};
		await cycle([
			obj,
			obj,
		]);
	});

	test('errors', async () => {
		await cycle(new Error());

		class RandomError extends Error {};

		await cycle(new RandomError(), (a, b) => assert.deepStrictEqual(a, new Error()));
	});
}));

test("copy function", () => {
	let func = () => {};
	assert.equal(func, copy(func));
});

test("serialize function", async () => {
	let thrown = false;
	try {
		await encode(() => {});
	} catch (e) {
		thrown = true;
	}

	assert(thrown);
});

test("message observerRemap", () => {
	const obj = OObject({
		map: OMap([OObject({id: UUID()})]),
		obj: OObject(),
		arr: OArray(),
	});

	obj.copy = copy(obj, {observerRemap: UUID.Map()});

	const network = createNetwork(obj.observer);
	assert(network.has(obj.observer.id));
	assert(network.has(obj.map.observer.id));
	assert(network.has(obj.obj.observer.id));
	assert(network.has(obj.arr.observer.id));
});

test("message getObserverNetworks", async () => {
	const obj = OObject();
	const obj2 = OObject({}, obj.observer.id);
	const network = createNetwork(obj.observer);
	const network2 = createNetwork(obj2.observer);

	const digest = network.digest((changes, observerRefs) => {
		network2.apply(copy(changes, {observerRefs, getObserverNetworks: () => [network2]}));
	});

	obj.thing = OObject();
	obj.number = 4;
	obj.bool = true;

	await digest.flush();
	obj.thing2 = obj.thing;
	await digest.flush();

	assert.deepStrictEqual(obj, obj2);
});

test("message getObserverNetworks fail", async () => {
	const obj = OObject();
	const obj2 = OObject({}, obj.observer.id);
	const network = createNetwork(obj.observer);
	const network2 = createNetwork(obj2.observer);

	let failed = false;
	const digest = network.digest((changes, observerRefs) => {
		try {
			network2.apply(copy(changes, {observerRefs, getObserverNetworks: () => []}));
		} catch (e) {
			failed = true;
		}
	});

	obj.thing = OObject();
	obj.number = 4;
	obj.bool = true;

	await digest.flush();
	obj.thing2 = obj.thing;
	await digest.flush();

	assert(failed);
});

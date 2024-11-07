import { defineConfig } from 'vite';
import { plugin as viteMarkdownPlugin } from 'vite-plugin-markdown';
import assertRemove from 'destam-dom/transform/assertRemove';
import compileHTMLLiteral from 'destam-dom/transform/htmlLiteral';

import path from 'path';

const createTransform = (name, transform, jsx, options) => ({
	name,
	transform(code, id) {
		if (id.endsWith('.js') || (jsx && id.endsWith('.jsx'))) {
			const transformed = transform(code, {
				sourceFileName: id,
				plugins: id.endsWith('.jsx') ? ['jsx'] : [],
				...options,
			});
			return {
				code: transformed.code,
				map: transformed.map,
			};
		}
	}
});

const plugins = [];

plugins.push(createTransform('transform-literal-html', compileHTMLLiteral, true, {
	jsx_auto_import: {
		h: 'destamatic-ui',
		raw: {
			name: 'h',
			location: 'destam-dom'
		}
	},
}));

if (process.env.ENV === 'production') {
	plugins.push(createTransform('assert-remove', assertRemove));
}

plugins.push(viteMarkdownPlugin());

export default defineConfig({
	root: './frontend',
	plugins,
	esbuild: {
		jsx: 'preserve',
	},
	base: '',
	assetsInclude: ['**/*.md'],
	resolve: {
		alias: {
			'@destam': path.resolve(__dirname, './destam/destam'),
			'@destamatic-ui': path.resolve(__dirname, './destamatic-ui'),
		}
	},
});

const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const ctx = esbuild.context({
	entryPoints: ['src/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	external: ['vscode'],
	format: 'cjs',
	platform: 'node',
	sourcemap: true,
	minify: !watch,
	logLevel: 'info',
	loader: {
		'.ts': 'ts',
	},
	tsconfig: 'tsconfig.json',
}).then(async (ctx) => {
	if (watch) {
		await ctx.watch();
		console.log('Watching for changes...');
	} else {
		await ctx.rebuild();
		await ctx.dispose();
		console.log('Build complete!');
	}
}).catch(() => process.exit(1));

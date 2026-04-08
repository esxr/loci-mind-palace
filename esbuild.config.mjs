import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['src/plugin/main.ts'],
  outfile: 'dist-plugin/main.js',
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
}).catch(() => process.exit(1));

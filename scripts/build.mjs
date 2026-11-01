// Builds the app into dist/:
//   - bundles src/main.ts (TypeScript) into dist/app.js with esbuild
//   - copies public/ (HTML, CSS, icons, manifest, service worker)
//   - stamps a version so iPads pick up new releases
// `node scripts/build.mjs --serve` also starts a local dev server.

import * as esbuild from 'esbuild';
import { cpSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const serve = process.argv.includes('--serve');
const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');

function version() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() + '-' + Date.now().toString(36);
  } catch {
    return Date.now().toString(36);
  }
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

function stamp(v) {
  const index = join(dist, 'index.html');
  writeFileSync(index, readFileSync(index, 'utf8').replaceAll('__VERSION__', v));
  const files = ['./', `app.js?v=${v}`, `styles.css?v=${v}`].concat(
    listFiles(dist)
      .map((p) => relative(dist, p).split('\\').join('/'))
      .filter((p) => !['index.html', 'sw.js', 'app.js', 'styles.css'].includes(p) && !p.endsWith('.map')),
  );
  const sw = join(dist, 'sw.js');
  writeFileSync(
    sw,
    readFileSync(sw, 'utf8').replaceAll('__VERSION__', v).replace('__FILES__', JSON.stringify(files, null, 2)),
  );
}

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'public'), dist, { recursive: true });

const options = {
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['safari16'],
  outfile: join(dist, 'app.js'),
  sourcemap: true,
  minify: !serve,
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  stamp('dev');
  const { hosts, port } = await ctx.serve({ servedir: dist, host: '0.0.0.0', port: 5173 });
  console.log(`Dev server: http://localhost:${port}  (${hosts.join(', ')})`);
} else {
  await esbuild.build(options);
  stamp(version());
  console.log('Built to dist/');
}

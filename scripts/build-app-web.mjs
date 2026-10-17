#!/usr/bin/env node
// Assembles app-web/, the files the Android app ships with: the website from
// public/, plus the job pipeline (scripts/lib + scripts/sources) so the app
// can check the job boards itself, plus the school index it matches against.
//
// Modules are copied as .js (not .mjs) so the WebView's local server always
// serves them with a JavaScript MIME type.

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'app-web');

// Everything lib/pipeline.mjs imports, directly or indirectly. These must not
// import node:* modules.
const ENGINE = {
  lib: ['pipeline', 'http', 'text', 'classify', 'match', 'geo', 'london'],
  sources: (await readdir(join(ROOT, 'scripts', 'sources'))).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')),
};

await rm(OUT, { recursive: true, force: true });
await cp(join(ROOT, 'public'), OUT, { recursive: true });

for (const [dir, names] of Object.entries(ENGINE)) {
  await mkdir(join(OUT, 'engine', dir), { recursive: true });
  for (const name of names) {
    const src = await readFile(join(ROOT, 'scripts', dir, `${name}.mjs`), 'utf8');
    if (/from ['"]node:/.test(src)) throw new Error(`scripts/${dir}/${name}.mjs imports a Node module and cannot run in the app`);
    await writeFile(join(OUT, 'engine', dir, `${name}.js`), src.replace(/(from\s+['"][^'"]+)\.mjs(['"])/g, '$1.js$2'));
  }
}

await cp(join(ROOT, 'scripts', 'data', 'london-establishments.json'), join(OUT, 'data', 'london-establishments.json'));

const jobs = JSON.parse(await readFile(join(OUT, 'data', 'jobs.json'), 'utf8'));
console.log(`[app-web] built with ${jobs.jobs.length} bundled jobs from ${jobs.generated}`);

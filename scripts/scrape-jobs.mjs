#!/usr/bin/env node
// Collects maths teaching jobs in London from several job boards, works out
// which school each one is at, how suitable it is for an ECT, and writes
// public/data/jobs.json for the website. The work itself is in
// lib/pipeline.mjs, which the Android app also runs on the phone.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJobsData } from './lib/pipeline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'jobs.json');

const log = (...a) => console.log('[jobs]', ...a);
const readJSON = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};

async function main() {
  const schoolsData = await readJSON(join(ROOT, 'public', 'data', 'schools.json'), null);
  const establishments = await readJSON(join(ROOT, 'scripts', 'data', 'london-establishments.json'), []);
  if (!schoolsData) throw new Error('Run `npm run schools` first to build public/data/schools.json');

  const data = await buildJobsData({
    schools: schoolsData.schools,
    establishments,
    previous: await readJSON(OUT, { jobs: [] }),
    log,
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));

  const out = data.jobs;
  const count = (f) => out.filter(f).length;
  log(`wrote ${out.length} London maths jobs (dropped ${JSON.stringify(data.dropped)})`);
  log(`  state ${count((j) => j.sector === 'state' || j.sector === 'trust')}, independent ${count((j) => j.sector === 'independent')}, other ${count((j) => !['state', 'trust', 'independent'].includes(j.sector))}`);
  log(`  ECT yes ${count((j) => j.ect === 'yes')}, likely ${count((j) => j.ect === 'likely')}, with sixth form ${count((j) => j.sixthForm)}`);
  if (data.sources.every((s) => !s.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

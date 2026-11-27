#!/usr/bin/env node
// Collects maths teaching jobs for each preset area (London, Brighton,
// Cardiff ...) from the job boards, works out which school each one is at
// and how suitable it is for an ECT, and writes public/data/jobs/<area>.json
// plus public/data/areas.json. The work itself is in lib/pipeline.mjs, which
// the Android and Mac apps also run for any place the user picks.
//
//   npm run jobs                  every preset area
//   npm run jobs -- --area cardiff  just one

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJobsData } from './lib/pipeline.mjs';
import { PRESETS, regionsForArea } from './lib/places.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'public', 'data');

const readJSON = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};

async function scrapeArea(area, schoolsIndex) {
  const log = (...a) => console.log(`[jobs:${area.slug}]`, ...a);
  const regions = regionsForArea(area, schoolsIndex.regions);
  const schools = [], establishments = [];
  for (const r of regions) {
    schools.push(...(await readJSON(join(DATA, 'schools', `${r.slug}.json`), { schools: [] })).schools);
    establishments.push(...(await readJSON(join(ROOT, 'scripts', 'data', 'establishments', `${r.slug}.json`), [])));
  }
  log(`regions: ${regions.map((r) => r.name).join(', ')}`);
  const file = join(DATA, 'jobs', `${area.slug}.json`);
  const data = await buildJobsData({ area, schools, establishments, previous: await readJSON(file, { jobs: [] }), log });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));

  const count = (f) => data.jobs.filter(f).length;
  log(`wrote ${data.jobs.length} maths jobs (dropped ${JSON.stringify(data.dropped)})`);
  log(`  state ${count((j) => j.sector === 'state' || j.sector === 'trust')}, independent ${count((j) => j.sector === 'independent')}, ECT yes ${count((j) => j.ect === 'yes')}, likely ${count((j) => j.ect === 'likely')}`);
  return data;
}

async function main() {
  const schoolsIndex = await readJSON(join(DATA, 'schools', 'index.json'), null);
  if (!schoolsIndex) throw new Error('Run `npm run schools` first to build public/data/schools/');
  const only = process.argv.includes('--area') ? process.argv[process.argv.indexOf('--area') + 1] : null;
  const areas = only ? PRESETS.filter((p) => p.slug === only) : PRESETS;
  if (!areas.length) throw new Error(`Unknown area "${only}". Choose from: ${PRESETS.map((p) => p.slug).join(', ')}`);

  const summary = await readJSON(join(DATA, 'areas.json'), {});
  let anyOk = false;
  for (const area of areas) {
    try {
      const data = await scrapeArea(area, schoolsIndex);
      anyOk ||= data.sources.some((s) => s.ok);
      summary[area.slug] = { generated: data.generated, jobs: data.jobs.length, ect: data.jobs.filter((j) => j.ect === 'yes').length };
    } catch (e) {
      console.error(`[jobs:${area.slug}] failed: ${e.message}`);
    }
  }
  // Presets in their fixed order, with when each was last checked.
  const areasFile = PRESETS.map((p) => {
    const last = summary[p.slug] ?? {};
    return { ...p, generated: last.generated ?? null, jobs: last.jobs ?? null, ect: last.ect ?? null };
  });
  await writeFile(join(DATA, 'areas.json'), JSON.stringify(Object.fromEntries(areasFile.map((a) => [a.slug, a]))));
  if (!anyOk) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

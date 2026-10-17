#!/usr/bin/env node
// Collects maths teaching jobs in London from several job boards, works out
// which school each one is at, how suitable it is for an ECT, and writes
// public/data/jobs.json for the website.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tv from './sources/teachingVacancies.mjs';
import * as tes from './sources/tes.mjs';
import * as mnt from './sources/myNewTerm.mjs';
import * as eteach from './sources/eteach.mjs';
import { buildMatcher } from './lib/match.mjs';
import { lookupPostcodes, reverseGeocode } from './lib/geo.mjs';
import { findBorough } from './lib/london.mjs';
import { nameKey, normPostcode } from './lib/text.mjs';
import {
  isMaths, roleOf, ectAssessment, teachesKS5, contractOf, workingPatternOf,
  payAreaFromText, looksPrimary, NON_LONDON_TITLE, toDate,
} from './lib/classify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'jobs.json');
// Earlier sources win when the same advert appears on several boards.
const SOURCES = [tv, mnt, tes, eteach];
const SOURCE_NAME = Object.fromEntries(SOURCES.map((s) => [s.meta.key, s.meta.name]));

const log = (...a) => console.log('[jobs]', ...a);
const readJSON = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};

const titleKey = (t) =>
  t.toLowerCase()
    .replace(/mathematics/g, 'maths').replace(/\bmath\b/g, 'maths')
    .replace(/\b(teacher|of|the|a|in|and|for|with|teaching)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');

function summary(text = '') {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 320) return clean;
  return `${clean.slice(0, 320).replace(/\s\S*$/, '')}…`;
}

async function collect() {
  const raw = [];
  const status = [];
  for (const src of SOURCES) {
    const t = Date.now();
    try {
      const jobs = await src.scrape();
      raw.push(...jobs);
      status.push({ ...src.meta, ok: true, found: jobs.length, seconds: Math.round((Date.now() - t) / 1000) });
      log(`${src.meta.name}: ${jobs.length} adverts`);
    } catch (e) {
      status.push({ ...src.meta, ok: false, found: 0, error: e.message });
      log(`${src.meta.name} FAILED: ${e.message}`);
    }
  }
  return { raw, status };
}

async function main() {
  const schoolsData = await readJSON(join(ROOT, 'public', 'data', 'schools.json'), null);
  const establishments = await readJSON(join(ROOT, 'scripts', 'data', 'london-establishments.json'), []);
  if (!schoolsData) throw new Error('Run `npm run schools` first to build public/data/schools.json');
  const match = buildMatcher(establishments, schoolsData.schools);
  const previous = await readJSON(OUT, { jobs: [] });

  const { raw, status } = await collect();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Locations: postcode lookups first, then reverse-geocode any that only
  // came with coordinates.
  for (const j of raw) j.postcode = normPostcode(j.postcode);
  const places = await lookupPostcodes(raw.map((j) => j.postcode)).catch((e) => {
    log(`postcode lookup failed: ${e.message}`);
    return new Map();
  });
  const needReverse = raw.filter((j) => !places.has(j.postcode) && j.lat && j.lon);
  const reversed = await reverseGeocode(needReverse).catch(() => []);
  needReverse.forEach((j, i) => reversed[i] && (j._place = reversed[i]));

  const jobs = [];
  const dropped = { notMaths: 0, notLondon: 0, expired: 0 };
  for (const j of raw) {
    if (!isMaths(j)) {
      dropped.notMaths++;
      continue;
    }
    const closing = toDate(j.closing);
    if (closing && closing.slice(0, 10) < today) {
      dropped.expired++;
      continue;
    }
    const place = places.get(j.postcode) ?? j._place ?? null;
    const { establishment, school } = match(j);
    const inLondon = place
      ? place.region === 'London'
      : school
        ? true
        : j.region === 'London' || /greater london/i.test(j.county ?? '') || /\blondon\b/i.test(j.address ?? '');
    if (!inLondon || NON_LONDON_TITLE.test(j.title)) {
      dropped.notLondon++;
      continue;
    }

    const role = roleOf(j.title);
    const borough = findBorough(school?.borough ?? place?.borough ?? j.borough);
    let sector = j.funding === 'agency' ? 'agency' : (establishment?.kind ?? j.funding ?? null);
    if (!establishment && looksPrimary(j) && sector !== 'independent') sector = 'primary';
    if (sector === 'state' && !school && /trust|federation|schools\b|partnership|group/i.test(j.employer)) sector = 'trust';
    const category = school?.category ?? (/further education|college|16 plus|16-19/i.test(j.schoolType ?? '') ? 'fe-college' : null);

    jobs.push({
      title: j.title.replace(/\s+/g, ' ').trim(),
      employer: j.employer.replace(/\s+/g, ' ').trim(),
      trust: school?.trust ?? j.trust ?? null,
      urn: school?.urn ?? establishment?.urn ?? null,
      school: school ? school.name : null,
      category,
      sector: sector ?? 'unknown',
      sixthForm: Boolean(school?.hasSixthForm || category === '16-19' || category?.endsWith('college')),
      ks5: teachesKS5(j),
      role,
      borough: borough?.name ?? place?.borough ?? j.borough ?? null,
      payArea: payAreaFromText(j.salary) ?? borough?.pay ?? null,
      postcode: j.postcode ?? place?.postcode ?? null,
      lat: school?.lat ?? place?.lat ?? j.lat ?? null,
      lon: school?.lon ?? place?.lon ?? j.lon ?? null,
      salary: j.salary ? j.salary.replace(/\s+/g, ' ').trim() : null,
      contract: contractOf(j),
      workingPattern: workingPatternOf(j),
      start: j.start ? String(j.start).replace(/T00:00:00.*$/, '') : null,
      posted: toDate(j.posted),
      closing,
      visa: j.visa ?? null,
      summary: summary(j.text),
      ectFlags: j.ectSuitable ? [SOURCE_NAME[j.source]] : [],
      _text: j.text,
      sources: [{ key: j.source, name: SOURCE_NAME[j.source], url: j.url }],
    });
  }

  // Merge the same advert listed on several boards.
  const merged = new Map();
  for (const job of jobs) {
    const key = `${job.urn ?? nameKey(job.employer)}|${titleKey(job.title)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, job);
      continue;
    }
    if (!existing.sources.some((s) => s.key === job.sources[0].key)) existing.sources.push(...job.sources);
    existing.ectFlags = [...new Set([...existing.ectFlags, ...job.ectFlags])];
    existing.ks5 ||= job.ks5;
    for (const f of ['salary', 'contract', 'workingPattern', 'start', 'closing', 'posted', 'visa', 'postcode', 'lat', 'lon', 'trust']) {
      existing[f] ??= job[f];
    }
    if ((job._text ?? '').length > (existing._text ?? '').length) {
      existing._text = job._text;
      existing.summary = job.summary;
    }
  }

  const out = [];
  for (const job of merged.values()) {
    const ect = ectAssessment({ ...job, text: job._text }, job.role);
    delete job._text;
    out.push({ ...job, ect: ect.status, ectReasons: ect.reasons, ectSignals: ect.signals });
  }

  // If a board failed this run, keep its still-open adverts from last time.
  const failed = new Set(status.filter((s) => !s.ok).map((s) => s.key));
  if (failed.size) {
    const carried = (previous.jobs ?? []).filter(
      (j) => j.sources.every((s) => failed.has(s.key)) && (!j.closing || j.closing.slice(0, 10) >= today),
    );
    out.push(...carried.map((j) => ({ ...j, stale: true })));
    if (carried.length) log(`kept ${carried.length} adverts from the previous run for failed sources`);
  }

  out.sort((a, b) => (a.closing ?? '9999').localeCompare(b.closing ?? '9999'));
  out.forEach((j, i) => (j.id = i + 1));

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({
      generated: now.toISOString(),
      sources: status.map(({ key, name, home, searchUrl, ok, found, error }) => ({ key, name, home, searchUrl, ok, found, error })),
      dropped,
      jobs: out,
    }),
  );
  const count = (f) => out.filter(f).length;
  log(`wrote ${out.length} London maths jobs (dropped ${JSON.stringify(dropped)})`);
  log(`  state ${count((j) => j.sector === 'state' || j.sector === 'trust')}, independent ${count((j) => j.sector === 'independent')}, other ${count((j) => !['state', 'trust', 'independent'].includes(j.sector))}`);
  log(`  ECT yes ${count((j) => j.ect === 'yes')}, likely ${count((j) => j.ect === 'likely')}, with sixth form ${count((j) => j.sixthForm)}`);
  if (status.every((s) => !s.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

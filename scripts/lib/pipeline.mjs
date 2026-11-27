// The job pipeline: run every source for an area, keep maths roles in that
// area, match each advert to its school, merge duplicates and rate it for ECTs.
//
// This module has no Node-only imports so the Android app can run exactly
// the same code on the phone (scripts/build-app-web.mjs copies it in).

import * as tv from '../sources/teachingVacancies.mjs';
import * as mnt from '../sources/myNewTerm.mjs';
import * as eteach from '../sources/eteach.mjs';
import { buildMatcher } from './match.mjs';
import { lookupPostcodes, reverseGeocode } from './geo.mjs';
import { inArea, payAreaFor, tidyDistrict, titleNamesFarPlace } from './places.mjs';
import { nameKey, normPostcode } from './text.mjs';
import {
  isMaths, roleOf, ectAssessment, teachesKS5, contractOf, workingPatternOf,
  payAreaFromText, looksPrimary, toDate,
} from './classify.mjs';

// Earlier sources win when the same advert appears on several boards.
export const SOURCES = [tv, mnt, eteach];
const SOURCE_NAME = Object.fromEntries(SOURCES.map((s) => [s.meta.key, s.meta.name]));

// Boards we link to but do not check automatically: TES now blocks
// automated requests with a browser challenge.
export function searchLinks(area) {
  const mi = Math.round(area.region ? area.radius + 5 : area.radius);
  return [
    ...SOURCES.filter((s) => s.meta.covers(area)).map((s) => ({ name: s.meta.name, url: s.meta.searchUrl(area) })),
    {
      name: 'TES Jobs',
      url: `https://www.tes.com/jobs/search?subjects=Mathematics&displayLocation=${encodeURIComponent(area.board)}&lat=${area.lat}&lon=${area.lon}&distance=${mi}&distanceUnit=mi`,
    },
  ];
}

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

async function collect(area, log, onProgress) {
  const raw = [];
  const status = [];
  const sources = SOURCES.filter((s) => s.meta.covers(area));
  for (const [i, src] of sources.entries()) {
    onProgress?.({ step: i + 1, total: sources.length, source: src.meta.name });
    const t = Date.now();
    try {
      const jobs = await src.scrape(area);
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

/**
 * @param {object} opts
 * @param {object} opts.area          { name, lat, lon, radius (miles), board, country, region? }
 * @param {Array} opts.schools        schools of the regions the area touches
 * @param {Array} opts.establishments every school in those regions, for matching
 * @param {object} [opts.previous]    the area's last results, to cover a board that fails
 * @param {Function} [opts.log]
 * @param {Function} [opts.onProgress] called with { step, total, source }
 * @returns the area's jobs file
 */
export async function buildJobsData({ area, schools, establishments, previous = { jobs: [] }, log = () => {}, onProgress }) {
  const match = buildMatcher(establishments, schools);
  const { raw, status } = await collect(area, log, onProgress);
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
  const dropped = { notMaths: 0, outsideArea: 0, expired: 0 };
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
    // Where is it? The matched school is the best guide, then the advert's
    // postcode, then coordinates the board gave.
    const where = school ?? place ?? (j.lat != null ? { lat: j.lat, lon: j.lon } : null);
    const inside = where
      ? inArea(area, { lat: where.lat, lon: where.lon, region: where.region })
      : `${j.address ?? ''} ${j.county ?? ''}`.toLowerCase().includes(area.board.toLowerCase());
    if (!inside || titleNamesFarPlace(j.title, area)) {
      dropped.outsideArea++;
      continue;
    }

    const role = roleOf(j.title);
    const district = tidyDistrict(school?.district ?? place?.district) ?? null;
    const country = school?.country ?? place?.country ?? area.country;
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
      district,
      country,
      payArea: payAreaFromText(j.salary) ?? payAreaFor({ district, country }),
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
    existing.ks5 = existing.ks5 || job.ks5;
    for (const f of ['salary', 'contract', 'workingPattern', 'start', 'closing', 'posted', 'visa', 'postcode', 'lat', 'lon', 'trust']) {
      if (existing[f] == null) existing[f] = job[f];
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
    const carried = (previous?.jobs ?? []).filter(
      (j) => j.sources.every((s) => failed.has(s.key)) && (!j.closing || j.closing.slice(0, 10) >= today),
    );
    out.push(...carried.map((j) => ({ ...j, stale: true })));
    if (carried.length) log(`kept ${carried.length} adverts from the previous run for failed sources`);
  }

  out.sort((a, b) => (a.closing ?? '9999').localeCompare(b.closing ?? '9999'));
  out.forEach((j, i) => (j.id = i + 1));

  return {
    generated: now.toISOString(),
    area,
    sources: status.map(({ key, name, home, note, ok, found, error }) => ({ key, name, home, note, ok, found, error })),
    links: searchLinks(area),
    dropped,
    jobs: out,
  };
}

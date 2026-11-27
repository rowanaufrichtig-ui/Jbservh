#!/usr/bin/env node
// Builds the school data the site maps: every open, state-funded mainstream
// secondary school, all-through school, 16-19 school, sixth form college and
// FE college in England, with GCSE maths and A level results from the DfE
// performance tables, plus maintained secondary and middle schools in Wales.
//
// Output, one file per region so the site only loads what an area needs:
//   public/data/schools/index.json        regions, years, comparison averages
//   public/data/schools/<region>.json     the schools
//   scripts/data/establishments/<region>.json   every school, for matching job adverts
//
// Sources (all Open Government Licence):
//  - Get Information About Schools (GIAS) daily extract
//  - DfE school-level results on Explore Education Statistics: key stage 4
//    performance, 16-19 performance, and 16-19 subject entries (England only)
//  - Welsh Government address list of schools (Wales publishes no
//    school-level exam results)

import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBuffer, getText } from './lib/http.mjs';
import { parseCSVObjects } from './lib/csv.mjs';
import { readOdsObjects } from './lib/ods.mjs';
import { osgbToLatLon } from './lib/osgb.mjs';
import { payAreaFor, tidyDistrict } from './lib/places.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache');
const OUT_DIR = join(ROOT, 'public', 'data', 'schools');
const INDEX_DIR = join(ROOT, 'scripts', 'data', 'establishments');
const WALES_LIST_PAGE = 'https://www.gov.wales/address-list-schools';

// Explore Education Statistics data sets (CSV). Each new release gets new
// IDs: when the DfE publishes next year's results, find the data sets with
// these titles in the data catalogue and replace the IDs.
const EES = 'https://explore-education-statistics.service.gov.uk/data-catalogue/data-set';
const DATA_SETS = {
  // "Key stage 4 institution level - Performance", 2025/26 release
  ks4: 'bf138f04-daa2-4759-b950-937a17a4c675',
  // "Schools and colleges - performance" (16 to 19 performance), 2025/26 release
  ks5: '4df51bd5-cd1c-422c-9e0e-58d772dc97e5',
  // "Schools and colleges - subject entries and grades" (16 to 19 performance), 2025/26 release
  ks5Subjects: 'ae56d974-89ca-4ff4-bdbf-d3caf425ccab',
};
const GIAS = 'https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public';

const log = (...a) => console.log('[schools]', ...a);

async function cached(name, fetcher, maxAgeHours = 24 * 7) {
  const path = join(CACHE, name);
  try {
    const s = await stat(path);
    if (Date.now() - s.mtimeMs < maxAgeHours * 3600e3) return readFile(path);
  } catch {}
  const buf = await fetcher();
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, buf);
  return buf;
}

// ---------- downloads ----------

async function downloadGias() {
  // The extract is published daily; walk back a few days in case today's
  // file isn't up yet.
  for (let back = 0; back < 7; back++) {
    const d = new Date(Date.now() - back * 864e5);
    const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
    try {
      const buf = await cached(`gias-${stamp}.csv`, () => getBuffer(`${GIAS}/edubasealldata${stamp}.csv`, { timeout: 300000 }), 48);
      log(`GIAS extract ${stamp}: ${(buf.length / 1e6).toFixed(1)} MB`);
      return new TextDecoder('windows-1252').decode(buf);
    } catch (e) {
      log(`GIAS ${stamp} not available (${e.message})`);
    }
  }
  throw new Error('Could not download GIAS extract');
}

async function eesCSV(key) {
  const buf = await cached(`ees-${DATA_SETS[key]}.csv`, () => getBuffer(`${EES}/${DATA_SETS[key]}/csv`, { timeout: 600000 }));
  if (/^\s*</.test(buf.subarray(0, 200).toString('utf8'))) throw new Error(`${key}: got HTML instead of CSV`);
  const rows = parseCSVObjects(buf.toString('utf8'));
  log(`${key}: ${rows.length} rows`);
  return rows;
}

// ---------- helpers ----------

const num = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[%,]/g, '').trim();
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};
const round = (v, dp = 1) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

// "202526" -> "2025/26"
const academicYear = (period) => `${period.slice(0, 4)}/${period.slice(4)}`;

// DfE A level points (A*=60 ... E=10) map linearly onto UCAS tariff points
// (A*=56 ... E=16): tariff = 0.8 * points + 8. So an average per entry
// converts exactly, and three entries gives a typical "UCAS score".
export const ucasFromAps = (aps) => (aps === null ? null : round(0.8 * aps + 8, 1));

// The DfE grade wording for an average point score (each grade is 10 points
// wide, split into thirds: B- 35-38.3, B 38.3-41.7, B+ 41.7-45 ...). Used when
// the tables leave the grade blank, as they do for FE and sixth form colleges.
export function gradeFromAps(aps) {
  if (aps === null || aps < 5) return null;
  const letters = ['E', 'D', 'C', 'B', 'A', 'A*'];
  const idx = Math.min(5, Math.max(0, Math.round(aps / 10) - 1));
  const offset = aps - (idx + 1) * 10;
  const suffix = offset < -5 / 3 ? '-' : offset >= 5 / 3 && idx < 5 ? '+' : '';
  return letters[idx] + suffix;
}
const cleanGrade = (g, aps) => (g && !/^(NE|SUPP|NP|NA|x|z|c)$/i.test(g) ? g : gradeFromAps(aps));

function categoryOf(g) {
  const type = g['TypeOfEstablishment (name)'];
  const phase = g['PhaseOfEducation (name)'];
  const fe = g['FurtherEducationType (name)'] ?? '';
  if (type === 'Further education') return fe.startsWith('Sixth Form College') ? 'sixth-form-college' : 'fe-college';
  if (phase === '16 plus') return '16-19';
  if (phase === 'All-through') return 'all-through';
  return 'secondary';
}

const MAINSTREAM_TYPES = new Set([
  'Academy converter',
  'Academy sponsor led',
  'Academy 16-19 converter',
  'Academy 16 to 19 sponsor led',
  'Free schools',
  'Free schools 16 to 19',
  'Studio schools',
  'University technical college',
  'Community school',
  'Foundation school',
  'Voluntary aided school',
  'Voluntary controlled school',
  'City technology college',
]);
const SECONDARY_PHASES = new Set(['Secondary', 'All-through', '16 plus', 'Middle deemed secondary']);

// England: open state-funded mainstream secondary/16-19 schools and colleges.
function include(g) {
  if (!g['EstablishmentStatus (name)'].startsWith('Open') || !REGION_SLUG[g['GOR (name)']]) return false;
  const type = g['TypeOfEstablishment (name)'];
  if (type === 'Further education') {
    const fe = g['FurtherEducationType (name)'] ?? '';
    return fe.startsWith('Sixth Form College') || fe === 'General Further Education College';
  }
  return MAINSTREAM_TYPES.has(type) && SECONDARY_PHASES.has(g['PhaseOfEducation (name)']);
}

function kindOf(g) {
  const group = g['EstablishmentTypeGroup (name)'];
  if (group === 'Independent schools' || /independent/i.test(g['TypeOfEstablishment (name)'])) return 'independent';
  if (group === 'Special schools' || /special|pupil referral|alternative provision/i.test(g['TypeOfEstablishment (name)'])) return 'special';
  if (group === 'Universities') return 'university';
  const phase = g['PhaseOfEducation (name)'];
  if (phase === 'Primary' || phase === 'Nursery' || phase === 'Middle deemed primary') return 'primary';
  return 'state';
}

function website(url) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, '')}`;
}

const REGION_SLUG = {
  London: 'london',
  'South East': 'south-east',
  'South West': 'south-west',
  'East of England': 'east-of-england',
  'East Midlands': 'east-midlands',
  'West Midlands': 'west-midlands',
  'Yorkshire and the Humber': 'yorkshire-and-the-humber',
  'North West': 'north-west',
  'North East': 'north-east',
  Wales: 'wales',
};

// ---------- Wales ----------

async function downloadWalesList() {
  return cached('wales-schools.ods', async () => {
    const page = await getText(WALES_LIST_PAGE);
    const href = page.match(/href="([^"]+\.ods)"/)?.[1];
    if (!href) throw new Error('No .ods link on the Welsh Government page');
    return getBuffer(new URL(href, WALES_LIST_PAGE).href);
  }, 24 * 14);
}

const LANGUAGE = [
  [/^Welsh medium/i, 'Welsh-medium'],
  [/^Dual language/i, 'Dual stream (Welsh and English)'],
  [/^English medium/i, 'English-medium'],
];
const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : s);

function welshSchools(ods, giasByLaestab) {
  const maintained = readOdsObjects(ods, 'Maintained');
  const independent = readOdsObjects(ods, 'Independent');
  const pru = readOdsObjects(ods, 'PRU');
  const schools = [];
  const index = [];
  const kindOfSector = { Primary: 'primary', Nursery: 'primary', Special: 'special', Secondary: 'state', Middle: 'state' };
  for (const [rows, fixedKind] of [[maintained, null], [independent, 'independent'], [pru, 'special']]) {
    for (const w of rows) {
      const number = w['School Number'];
      if (!/^\d{7}$/.test(number)) continue;
      const g = giasByLaestab.get(number);
      const name = g?.EstablishmentName ?? titleCase(w['School Name']);
      const kind = fixedKind ?? kindOfSector[w.Sector] ?? 'state';
      const urn = g?.URN ?? `W${number}`;
      index.push({ urn, name, postcode: w.Postcode, kind });
      if (fixedKind || !['Secondary', 'Middle'].includes(w.Sector)) continue;

      const ages = w['School Type'].match(/ages (\d+)-(\d+)/);
      const pos = g ? osgbToLatLon(g.Easting, g.Northing) : null;
      const language = LANGUAGE.find(([re]) => re.test(w['School Language Category - see notes']))?.[1] ?? null;
      const la = w['Local Authority'];
      schools.push({
        urn,
        welshNumber: number,
        name,
        category: w.Sector === 'Middle' ? 'all-through' : 'secondary',
        type: `${w['Governance - see notes']} school`.replace(/^(.)/, (c) => c.toUpperCase()),
        ageRange: ages ? `${ages[1]}–${ages[2]}` : null,
        hasSixthForm: ages ? Number(ages[2]) >= 18 : false,
        gender: null,
        religion: /^-+$|^$/.test(w['Religious Character']) ? null : w['Religious Character'],
        admissions: null,
        language,
        trust: null,
        pupils: num(w['Pupils - see notes']),
        capacity: null,
        fsm: null,
        la,
        district: la,
        region: 'Wales',
        country: 'Wales',
        payArea: 'Wales',
        address: [w['Address 1'], w['Address 2'], w['Address 3'], w['Address 4']].filter(Boolean).join(', '),
        postcode: w.Postcode,
        website: website(g?.SchoolWebsite),
        phone: w['Phone Number'] || null,
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        gcse: null,
        alevel: null,
        links: {
          mylocalschool: `https://mylocalschool.gov.wales/School/${number}?lang=en`,
          estyn: `https://www.estyn.gov.wales/provider/${number}`,
        },
      });
    }
  }
  return { schools, index };
}

// Postcode centroids for the few Welsh schools GIAS has no grid reference for.
async function fillMissingPositions(schools) {
  const missing = schools.filter((s) => s.lat == null && s.postcode);
  if (!missing.length) return;
  const { lookupPostcodes } = await import('./lib/geo.mjs');
  const places = await lookupPostcodes(missing.map((s) => s.postcode.toUpperCase()));
  for (const s of missing) {
    const p = places.get(s.postcode.toUpperCase());
    if (p) [s.lat, s.lon] = [p.lat, p.lon];
  }
  log(`Located ${missing.filter((s) => s.lat != null).length} of ${missing.length} Welsh schools by postcode`);
}

// ---------- main ----------

async function main() {
  const giasRows = parseCSVObjects(await downloadGias());
  log(`GIAS rows: ${giasRows.length}`);

  // Key stage 4: one row per school per pupil breakdown and year; keep the
  // all-pupils rows for the latest year and the one before it.
  const ks4All = (await eesCSV('ks4')).filter((r) => r.breakdown_topic === 'Total' && r.sex === 'Total' && r.disadvantage_status === 'Total');
  const ks4Periods = [...new Set(ks4All.map((r) => r.time_period))].sort().reverse();
  const [ks4Year, ks4Prev] = ks4Periods;
  const ks4Rows = ks4All.filter((r) => r.time_period === ks4Year);
  const ks4ByUrn = new Map(ks4Rows.map((r) => [r.school_urn, r]));
  const ks4PrevByUrn = new Map(ks4All.filter((r) => r.time_period === ks4Prev).map((r) => [r.school_urn, r]));
  const ks4Provisional = ks4Rows.some((r) => r.version === 'Provisional');

  // 16-19: the A level cohort rows for all students.
  const ks5All = (await eesCSV('ks5')).filter((r) => r.exam_cohort === 'A level' && r.disadvantage_status === 'Total');
  const [ks5Year, ks5Prev] = [...new Set(ks5All.map((r) => r.time_period))].sort().reverse();
  const ks5Rows = ks5All.filter((r) => r.time_period === ks5Year);
  const ks5ByUrn = new Map(ks5Rows.map((r) => [r.school_urn, r]));
  const ks5PrevByUrn = new Map(ks5All.filter((r) => r.time_period === ks5Prev).map((r) => [r.school_urn, r]));

  // A level maths and further maths entries per school (latest year).
  const maths = new Map();
  for (const r of await eesCSV('ks5Subjects')) {
    if (r.qualification_detailed !== 'GCE A level' || !/^Mathematics( \(Further\))?$/.test(r.subject)) continue;
    const m = maths.get(r.school_urn) ?? { entries: null, aStarA: 0, aStarAKnown: true, further: null };
    const n = num(r.entries_count);
    if (r.subject === 'Mathematics') {
      if (r.grade === 'Total exam entries') m.entries = n;
      else if (r.grade === 'A*' || r.grade === 'A') n === null ? (m.aStarAKnown = false) : (m.aStarA += n);
    } else if (r.grade === 'Total exam entries') m.further = n;
    maths.set(r.school_urn, m);
  }

  const gcseOf = (r, prev) =>
    r && {
      pupils: num(r.pupil_count),
      maths4: num(r.mat_94_percent),
      maths5: num(r.mat_95_percent),
      engMaths4: num(r.engmath_94_percent),
      engMaths5: num(r.engmath_95_percent),
      att8: num(r.attainment8_average),
      att8Maths: num(r.attainment8mat_average),
      maths4Prev: num(prev?.mat_94_percent),
    };

  const pct = (part, whole) => (part == null || !whole ? null : round((100 * part) / whole));
  const alevelOf = (r, prev, m) => {
    if (!r) return null;
    const aps = num(r.aps_per_entry);
    const best3 = num(r.best_three_alevels_aps);
    const students = num(r.aps_per_entry_student_count);
    const perEntry = ucasFromAps(aps);
    return {
      students,
      aps,
      grade: cleanGrade(r.aps_per_entry_grade, aps),
      ucasPerEntry: perEntry,
      // "UCAS points for three": from the DfE's best-three-A-levels average
      // where published, otherwise three times the per-entry average.
      ucas3: best3 != null ? Math.round(3 * ucasFromAps(best3)) : perEntry == null ? null : Math.round(3 * perEntry),
      best3Grade: cleanGrade(r.best_three_alevels_grade, best3),
      aab: num(r.aab_percent),
      va: num(r.value_added),
      progressBand: /^z$|^$/.test(r.progress_banding) ? null : r.progress_banding,
      apsPrev: num(prev?.aps_per_entry),
      gradePrev: cleanGrade(prev?.aps_per_entry_grade, num(prev?.aps_per_entry)),
      mathsEntries: m?.entries ?? null,
      mathsPct: pct(m?.entries, students),
      mathsAStarAPct: m?.entries && m.aStarAKnown ? pct(m.aStarA, m.entries) : null,
      furtherMathsPct: pct(m?.further, students),
    };
  };

  const byRegion = new Map(Object.values(REGION_SLUG).map((slug) => [slug, { schools: [], index: [] }]));
  const giasByLaestab = new Map();

  for (const g of giasRows) {
    const region = g['GOR (name)'] === 'Wales (pseudo)' ? 'Wales' : g['GOR (name)'];
    if (!g['EstablishmentStatus (name)'].startsWith('Open')) continue;
    if (region === 'Wales') {
      giasByLaestab.set(`${g['LA (code)']}${g.EstablishmentNumber.padStart(4, '0')}`, g);
      continue;
    }
    const slug = REGION_SLUG[region];
    if (!slug) continue;
    const urn = g.URN;
    byRegion.get(slug).index.push({ urn, name: g.EstablishmentName, postcode: g.Postcode, kind: kindOf(g) });
    if (!include(g)) continue;

    const pos = osgbToLatLon(g.Easting, g.Northing);
    const category = categoryOf(g);
    const district = tidyDistrict(g['DistrictAdministrative (name)']) || g['LA (name)'];
    const low = g.StatutoryLowAge, high = g.StatutoryHighAge;
    byRegion.get(slug).schools.push({
      urn,
      name: g.EstablishmentName,
      category,
      type: g['TypeOfEstablishment (name)'],
      ageRange: low && high ? `${low}–${high}` : null,
      hasSixthForm:
        category === '16-19' || category.endsWith('college') || g['OfficialSixthForm (name)'] === 'Has a sixth form',
      gender: g['Gender (name)'] || null,
      religion: /^(None|Does not apply|Not applicable|)$/.test(g['ReligiousCharacter (name)']) ? null : g['ReligiousCharacter (name)'],
      admissions: /^(Not applicable|Not collected|)$/.test(g['AdmissionsPolicy (name)']) ? null : g['AdmissionsPolicy (name)'],
      trust: g['Trusts (name)'] || null,
      pupils: num(g.NumberOfPupils),
      capacity: num(g.SchoolCapacity),
      fsm: num(g.PercentageFSM),
      la: g['LA (name)'],
      district,
      region,
      country: 'England',
      payArea: payAreaFor({ district, country: 'England' }),
      address: [g.Street, g.Locality, g.Address3, g.Town].filter(Boolean).join(', '),
      postcode: g.Postcode,
      website: website(g.SchoolWebsite),
      phone: g.TelephoneNum || null,
      lat: pos?.lat ?? null,
      lon: pos?.lon ?? null,
      gcse: gcseOf(ks4ByUrn.get(urn), ks4PrevByUrn.get(urn)) || null,
      alevel: alevelOf(ks5ByUrn.get(urn), ks5PrevByUrn.get(urn), maths.get(urn)),
      links: {
        performance: `https://find-compare-schools-colleges.service.gov.uk/school/${urn}`,
        gias: `https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/${urn}`,
        ofsted: category.endsWith('college')
          ? `https://reports.ofsted.gov.uk/search?q=${encodeURIComponent(g.EstablishmentName)}`
          : `https://reports.ofsted.gov.uk/provider/23/${urn}`,
      },
    });
  }

  const wales = welshSchools(await downloadWalesList(), giasByLaestab);
  await fillMissingPositions(wales.schools);
  byRegion.set('wales', wales);
  log(`Wales: ${wales.schools.length} secondary and middle schools, ${wales.index.length} establishments`);

  // Drop empty GCSE/A level blocks so the front end can simply test truthiness.
  for (const { schools } of byRegion.values()) {
    for (const s of schools) {
      if (s.gcse && Object.values(s.gcse).every((v) => v === null)) s.gcse = null;
      if (s.alevel && s.alevel.aps === null && s.alevel.mathsPct === null) s.alevel = null;
    }
  }

  // Comparison figures: local authority, region and England, each the
  // pupil-weighted average over state-funded schools.
  const stateUrns = new Set();
  const regionOf = new Map();
  for (const [slug, { index }] of byRegion) {
    const region = Object.keys(REGION_SLUG).find((r) => REGION_SLUG[r] === slug);
    for (const e of index) if (e.kind === 'state' || e.kind === 'special') stateUrns.add(e.urn), regionOf.set(e.urn, region);
  }
  const average = (rows, valueKey, weightKey) => {
    let sum = 0, w = 0;
    for (const r of rows) {
      const v = num(r[valueKey]), n = num(r[weightKey]);
      if (v !== null && n) {
        sum += v * n;
        w += n;
      }
    }
    return w ? round(sum / w) : null;
  };
  const figures = (k4, k5) => ({
    maths4: average(k4, 'mat_94_percent', 'pupil_count'),
    maths5: average(k4, 'mat_95_percent', 'pupil_count'),
    alevelAps: average(k5, 'aps_per_entry', 'aps_per_entry_student_count'),
  });
  const group = (rows, keyOf) => {
    const out = new Map();
    for (const r of rows) {
      if (!stateUrns.has(r.school_urn)) continue;
      const k = keyOf(r);
      if (k) out.set(k, [...(out.get(k) ?? []), r]);
    }
    return out;
  };
  const k4ByLa = group(ks4Rows, (r) => r.la_name), k5ByLa = group(ks5Rows, (r) => r.la_name);
  const k4ByRegion = group(ks4Rows, (r) => regionOf.get(r.school_urn)), k5ByRegion = group(ks5Rows, (r) => regionOf.get(r.school_urn));
  const las = Object.fromEntries([...k4ByLa.keys()].map((la) => [la, figures(k4ByLa.get(la), k5ByLa.get(la) ?? [])]));
  const regions = Object.fromEntries([...k4ByRegion.keys()].map((g) => [g, figures(k4ByRegion.get(g), k5ByRegion.get(g) ?? [])]));
  const england = figures(ks4Rows.filter((r) => stateUrns.has(r.school_urn)), ks5Rows.filter((r) => stateUrns.has(r.school_urn)));

  await rm(OUT_DIR, { recursive: true, force: true });
  await rm(INDEX_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(INDEX_DIR, { recursive: true });
  const regionList = [];
  for (const [region, slug] of Object.entries(REGION_SLUG)) {
    const { schools, index } = byRegion.get(slug);
    schools.sort((a, b) => a.name.localeCompare(b.name));
    const placed = schools.filter((s) => s.lat != null);
    const bbox = [
      Math.min(...placed.map((s) => s.lat)), Math.min(...placed.map((s) => s.lon)),
      Math.max(...placed.map((s) => s.lat)), Math.max(...placed.map((s) => s.lon)),
    ].map((v) => round(v, 3));
    await writeFile(join(OUT_DIR, `${slug}.json`), JSON.stringify({ region, schools }));
    await writeFile(join(INDEX_DIR, `${slug}.json`), JSON.stringify(index));
    regionList.push({ slug, name: region, country: region === 'Wales' ? 'Wales' : 'England', count: schools.length, bbox });
    const withGcse = schools.filter((s) => s.gcse?.maths4 != null).length;
    log(`${region}: ${schools.length} schools (${withGcse} with GCSE maths), ${index.length} establishments`);
  }

  await writeFile(
    join(OUT_DIR, 'index.json'),
    JSON.stringify({
      generated: new Date().toISOString(),
      gcseYear: academicYear(ks4Year),
      gcseProvisional: ks4Provisional,
      gcsePrevYear: ks4Prev ? academicYear(ks4Prev) : null,
      alevelYear: academicYear(ks5Year),
      alevelPrevYear: ks5Prev ? academicYear(ks5Prev) : null,
      regions: regionList,
      averages: { england, regions, las },
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

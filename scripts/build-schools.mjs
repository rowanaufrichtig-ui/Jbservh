#!/usr/bin/env node
// Builds public/data/schools.json: every open, state-funded mainstream
// secondary school, all-through school, 16-19 academy/free school and
// sixth form college in London, with location, key facts, GCSE maths and
// A level results from the DfE performance tables.
//
// Sources (all Open Government Licence):
//  - Get Information About Schools (GIAS) daily extract
//  - DfE school and college performance tables: KS4 final, 16-18 final, and
//    the "A level maths and science" breakdown.

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBuffer, getText } from './lib/http.mjs';
import { parseCSVObjects } from './lib/csv.mjs';
import { readZip } from './lib/zip.mjs';
import { readSheet } from './lib/xlsx.mjs';
import { osgbToLatLon } from './lib/osgb.mjs';
import { BOROUGH_BY_LA, BOROUGHS } from './lib/london.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, 'public', 'data', 'schools.json');
const INDEX_OUT = join(ROOT, 'scripts', 'data', 'london-establishments.json');

const PERF = 'https://www.compare-school-performance.service.gov.uk/download-data';
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

async function perfYears() {
  const html = await getText(PERF);
  return [...html.matchAll(/<option value="(\d{4}-\d{4})"/g)].map((m) => m[1]);
}

// Download one performance-tables dataset by walking the site's download
// wizard and following the link it offers. A single dataset comes back as
// the bare file (CSV or XLSX); several come back zipped.
async function perfFile(year, datatype) {
  return cached(`perf-${year}-${datatype}.bin`, async () => {
    const q = new URLSearchParams({ currentstep: 'datatypes', regiontype: 'all', la: '0', downloadYear: year, datatypes: datatype });
    const step = `${PERF}?${q}`;
    const page = await getText(step);
    // Spreadsheet-only datasets (like the maths and science one) only offer XLS.
    const href = (page.match(/id="download-file-format-by-csv-link" href="([^"]+)"/) ??
      page.match(/id="download-file-format-by-xls-link" href="([^"]+)"/))?.[1];
    if (!href) throw new Error(`not published for ${year}`);
    const url = new URL(href.replace(/&amp;/g, '&'), PERF).href;
    const buf = await getBuffer(url, { headers: { Referer: step }, timeout: 300000 });
    if (/^\s*</.test(buf.subarray(0, 200).toString('utf8'))) throw new Error('download was blocked or returned HTML');
    return buf;
  });
}

const isZip = (buf) => buf.readUInt32LE(0) === 0x04034b50;

// Newest year (of the few most recent) that has the dataset.
async function latestPerf(years, datatype, filePattern) {
  for (const year of years.slice(0, 3)) {
    try {
      let buf = await perfFile(year, datatype);
      if (isZip(buf)) {
        const zip = readZip(buf);
        if (!zip.names.includes('xl/workbook.xml')) {
          const name = zip.find(filePattern);
          if (!name) throw new Error('expected file not in download');
          buf = zip.read(name);
        }
      }
      log(`${datatype}: using ${year}`);
      return { year, buf };
    } catch (e) {
      log(`${datatype} ${year}: ${e.message}`);
    }
  }
  throw new Error(`No ${datatype} data found`);
}

// ---------- helpers ----------

const num = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[%,]/g, '').trim();
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};
const round = (v, dp = 1) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

const academicYear = (year) => year.replace('-', '/').replace(/\/20(\d\d)$/, '/$1');

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

function include(g) {
  if (g['GOR (name)'] !== 'London') return false;
  if (!g['EstablishmentStatus (name)'].startsWith('Open')) return false;
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

// ---------- main ----------

async function main() {
  const giasRows = parseCSVObjects(await downloadGias());
  log(`GIAS rows: ${giasRows.length}`);

  const years = await perfYears();
  log(`Performance table years offered: ${years.slice(0, 3).join(', ')} ...`);
  const ks4 = await latestPerf(years, 'ks4', /england_ks4final\.csv$/);
  const ks5 = await latestPerf(years, 'ks5', /england_ks5final\.csv$/);
  const ms = await latestPerf(years, 'ks5mathsci', /maths-science\.xlsx$/);

  const ks4Rows = parseCSVObjects(ks4.buf.toString('utf8'));
  const ks5Rows = parseCSVObjects(ks5.buf.toString('utf8'));
  const msSheet = readSheet(ms.buf, 'england_ks5maths-science');
  const msHeader = msSheet[0];
  const msRows = msSheet.slice(1).map((r) => Object.fromEntries(msHeader.map((h, i) => [h, r[i]])));

  const ks4ByUrn = new Map(ks4Rows.filter((r) => r.RECTYPE === '1').map((r) => [r.URN, r]));
  const ks5ByUrn = new Map(ks5Rows.filter((r) => r.RECTYPE === '1').map((r) => [r.URN, r]));
  const msByUrn = new Map(msRows.map((r) => [String(r['Unique reference number']), r]));

  const gcseOf = (r) =>
    r && {
      pupils: num(r.TPUP),
      maths4: num(r.PTEBACMAT_94),
      maths5: num(r.PTEBACMAT_95),
      engMaths4: num(r.PTL2BASICS_94),
      engMaths5: num(r.PTL2BASICS_95),
      att8: num(r.ATT8SCR),
      att8Maths: num(r.ATT8SCRMAT),
      p8: num(r.P8MEA),
    };

  const alevelOf = (r, m) => {
    if (!r && !m) return null;
    const aps = num(r?.TALLPPE_ALEV_1618);
    const ucas = ucasFromAps(aps);
    return {
      students: num(r?.TALLPUP_ALEV_1618),
      aps,
      grade: cleanGrade(r?.TALLPPEGRD_ALEV_1618, aps),
      ucasPerEntry: ucas,
      ucas3: ucas === null ? null : Math.round(ucas * 3),
      aab2fac: num(r?.PTAAB_2FAC),
      va: num(r?.VA_INS_ALEV),
      progressBand: r?.PROGRESS_BAND_ALEV && !/^(NE|SUPP|NP|x|z|c)$/i.test(r.PROGRESS_BAND_ALEV) ? r.PROGRESS_BAND_ALEV : null,
      apsPrev: num(r?.TALLPPE_ALEV_1618_24),
      gradePrev: cleanGrade(r?.TALLPPEGRD_ALEV_1618_24, num(r?.TALLPPE_ALEV_1618_24)),
      mathsPct: num(m?.A_level_maths_percent_all),
      furtherMathsPct: num(m?.A_level_further_maths_percent_all),
    };
  };

  const schools = [];
  const index = [];
  for (const g of giasRows) {
    if (g['GOR (name)'] !== 'London' || !g['EstablishmentStatus (name)'].startsWith('Open')) continue;
    const urn = g.URN;
    const la = Number(g['LA (code)']);
    const borough = BOROUGH_BY_LA.get(la);
    const kind = kindOf(g);
    index.push({ urn, name: g.EstablishmentName, postcode: g.Postcode, kind, include: include(g) || undefined });
    if (!include(g)) continue;

    const pos = osgbToLatLon(g.Easting, g.Northing);
    const k4 = ks4ByUrn.get(urn);
    const k5 = ks5ByUrn.get(urn);
    const m = msByUrn.get(urn);
    const category = categoryOf(g);
    const ofsted = category.endsWith('college')
      ? `https://reports.ofsted.gov.uk/search?q=${encodeURIComponent(g.EstablishmentName)}`
      : `https://reports.ofsted.gov.uk/provider/23/${urn}`;
    const low = g.StatutoryLowAge, high = g.StatutoryHighAge;

    schools.push({
      urn,
      name: g.EstablishmentName,
      category,
      type: g['TypeOfEstablishment (name)'],
      typeGroup: g['EstablishmentTypeGroup (name)'],
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
      la,
      borough: borough?.name ?? g['LA (name)'],
      payArea: borough?.pay ?? null,
      address: [g.Street, g.Locality, g.Address3, g.Town].filter(Boolean).join(', '),
      postcode: g.Postcode,
      website: website(g.SchoolWebsite),
      phone: g.TelephoneNum || null,
      lat: pos?.lat ?? null,
      lon: pos?.lon ?? null,
      gcse: gcseOf(k4) || null,
      alevel: alevelOf(k5, m),
      links: {
        performance: `https://www.compare-school-performance.service.gov.uk/school/${urn}`,
        gias: `https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/${urn}`,
        ofsted,
      },
    });
  }

  // Drop empty GCSE/A level blocks so the front end can simply test truthiness.
  for (const s of schools) {
    if (s.gcse && Object.values(s.gcse).every((v) => v === null)) s.gcse = null;
    if (s.alevel && s.alevel.aps === null && s.alevel.mathsPct === null) s.alevel = null;
  }

  // Comparison figures: borough (LA rows), London (pupil-weighted) and England.
  const weighted = (rows, valueKey, weightKey) => {
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
  const londonLAs = new Set(BOROUGHS.map((b) => String(b.la)));
  const londonKs4 = ks4Rows.filter((r) => r.RECTYPE === '1' && londonLAs.has(r.LEA));
  const londonKs5 = ks5Rows.filter((r) => r.RECTYPE === '1' && londonLAs.has(r.LEA));
  const eng4 = ks4Rows.find((r) => r.RECTYPE === '7');
  const eng5 = ks5Rows.find((r) => r.RECTYPE === '7');

  const boroughs = {};
  for (const b of BOROUGHS) {
    const r4 = ks4Rows.find((r) => r.RECTYPE === '4' && r.LEA === String(b.la));
    const r5 = ks5Rows.find((r) => r.RECTYPE === '4' && r.LEA === String(b.la));
    boroughs[b.name] = {
      la: b.la,
      payArea: b.pay,
      maths4: num(r4?.PTEBACMAT_94),
      maths5: num(r4?.PTEBACMAT_95),
      alevelAps: num(r5?.TALLPPE_ALEV_1618),
      alevelGrade: r5?.TALLPPEGRD_ALEV_1618 || null,
    };
  }

  const londonAps = weighted(londonKs5, 'TALLPPE_ALEV_1618', 'TALLPUP_ALEV_1618');
  const out = {
    generated: new Date().toISOString(),
    gcseYear: academicYear(ks4.year),
    alevelYear: academicYear(ks5.year),
    mathsSciYear: academicYear(ms.year),
    averages: {
      london: {
        maths4: weighted(londonKs4, 'PTEBACMAT_94', 'TPUP'),
        maths5: weighted(londonKs4, 'PTEBACMAT_95', 'TPUP'),
        alevelAps: londonAps,
        alevelGrade: gradeFromAps(londonAps),
        ucasPerEntry: ucasFromAps(londonAps),
      },
      england: {
        maths4: num(eng4?.PTEBACMAT_94),
        maths5: num(eng4?.PTEBACMAT_95),
        alevelAps: num(eng5?.TALLPPE_ALEV_1618),
        alevelGrade: eng5?.TALLPPEGRD_ALEV_1618 || null,
        ucasPerEntry: ucasFromAps(num(eng5?.TALLPPE_ALEV_1618)),
      },
    },
    boroughs,
    schools: schools.sort((a, b) => a.name.localeCompare(b.name)),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  await mkdir(dirname(INDEX_OUT), { recursive: true });
  await writeFile(INDEX_OUT, JSON.stringify(index));

  const withGcse = schools.filter((s) => s.gcse?.maths4 != null).length;
  const withAlevel = schools.filter((s) => s.alevel?.aps != null).length;
  log(`Wrote ${schools.length} schools (${withGcse} with GCSE maths, ${withAlevel} with A level results)`);
  log(`Wrote ${index.length} London establishments to the matching index`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

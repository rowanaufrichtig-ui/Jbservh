// Eteach. The site is an Angular app backed by a public JSON API; job details
// include the institution type and a "suitable for ECT (NQT) graduates" tag.

import { getJSON, mapLimit } from '../lib/http.mjs';
import { htmlToText, findPostcode } from '../lib/text.mjs';

const API = 'https://candidate-api.eteach.com/api';
const SITE = 'Eteachnew';
const HEADERS = { Origin: 'https://www.eteach.com', Referer: 'https://www.eteach.com/' };

export const meta = {
  key: 'eteach',
  name: 'Eteach',
  home: 'https://www.eteach.com',
  searchUrl: (area) => `https://www.eteach.com/jobs?keywords=maths&location=${encodeURIComponent(area.board)}`,
  covers: () => true,
};

const MATHS = /math|numeracy|statistic/i;

function fundingOf(institution) {
  if (/independent/i.test(institution)) return 'independent';
  if (/agency/i.test(institution)) return 'agency';
  if (/special|SEN\b/i.test(institution)) return 'special';
  if (/academy|free school|community|foundation|voluntary|maintained|college|local authority|studio|technical/i.test(institution)) return 'state';
  return null;
}

async function search(area, keywords) {
  const out = [];
  for (let page = 1; page <= 6; page++) {
    const radius = String(Math.round(area.region ? area.radius + 5 : area.radius));
    const q = new URLSearchParams({ keywords, location: area.board, pt: `${area.lat},${area.lon}`, radius, page: String(page), site: SITE });
    const data = await getJSON(`${API}/search/results?${q}`, { headers: HEADERS });
    out.push(...(data.results ?? []).filter((r) => r.type === 'job' && r.job).map((r) => r.job));
    if (data.isLastPage || !data.results?.length) break;
  }
  return out;
}

async function detail(item) {
  const d = await getJSON(`${API}/vacancy/details/${item.id}`, { headers: HEADERS });
  const [lat, lon] = String(d.locationCoordinates ?? '').split(',').map(Number);
  const suitable = (d.suitableFor ?? []).join(', ');
  const institution = d.institution ?? '';
  return {
    source: 'eteach',
    sourceId: String(item.id),
    url: `https://www.eteach.com${d.url ?? item.url}`,
    title: d.localisations?.en?.title ?? item.title,
    employer: d.schoolName ?? item.schoolName ?? '',
    address: d.longLocation ?? d.location ?? item.location ?? '',
    postcode: d.postcode ?? findPostcode(d.longLocation ?? ''),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    county: d.county ?? null,
    salary: item.salary ?? null,
    contract: d.contractType ?? null,
    workingPattern: (d.hours ?? []).join(', ') || null,
    subjects: (d.subjects ?? []).join(', ') || null,
    schoolType: institution || null,
    phase: (d.phases ?? []).join(', ') || null,
    funding: fundingOf(institution),
    posted: d.released ?? item.released ?? null,
    closing: d.expires ?? item.expires ?? null,
    start: d.employmentStart?.startDate ?? null,
    ectSuitable: /ECT|NQT/i.test(suitable),
    text: htmlToText(d.localisations?.en?.description ?? ''),
  };
}

export async function scrape(area) {
  const byId = new Map();
  for (const kw of ['maths', 'mathematics', 'maths teacher']) {
    for (const j of await search(area, kw)) if (MATHS.test(j.title)) byId.set(String(j.id), j);
  }
  const jobs = await mapLimit([...byId.values()], 3, (it) =>
    detail(it).catch((e) => {
      console.warn(`[eteach] ${it.id}: ${e.message}`);
      return null;
    }),
  );
  return jobs.filter(Boolean);
}

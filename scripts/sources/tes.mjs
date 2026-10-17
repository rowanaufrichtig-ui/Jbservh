// TES Jobs. The search page is a Next.js app that embeds its first page of
// results in __NEXT_DATA__; job pages embed the employer's address, borough,
// phase and whether it is state or independent.

import { getText, mapLimit } from '../lib/http.mjs';
import { htmlToText } from '../lib/text.mjs';

const BASE = 'https://www.tes.com';
const LONDON = 'displayLocation=London&distance=15&distanceUnit=mi';

export const meta = {
  key: 'tes',
  name: 'TES Jobs',
  home: `${BASE}/jobs`,
  searchUrl: `${BASE}/jobs/search?subjects=Mathematics&${LONDON}&nqt=true`,
};

const MATHS = /math|numeracy|statistic/i;

function nextData(html) {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error('TES page had no __NEXT_DATA__');
  return JSON.parse(raw).props.pageProps;
}

async function search(query, maxPages = 8) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = nextData(await getText(`${BASE}/jobs/search?${query}&page=${page}`)).initialData;
    items.push(...(data?.jobs ?? []));
    if (!data || page >= (data.totalPages ?? 1)) break;
  }
  return items;
}

async function detail(item, ectIds) {
  const url = BASE + item.canonicalUrl;
  const props = nextData(await getText(url));
  const job = props.job?.item ?? {};
  const emp = props.job?.mz?.employerData ?? {};
  const loc = job.employer?.contact?.location ?? {};
  const subjects = (props.job?.mz?.subjects ?? []).map((s) => s.description);
  return {
    source: 'tes',
    sourceId: String(item.id),
    url,
    title: item.title,
    employer: item.employer?.name ?? emp.employerName ?? '',
    region: emp.employerLocation2LevelAdmin ?? null,
    borough: emp.employerLocation3LevelAdmin ?? null,
    address: [loc.addressLine1, loc.cityTown].filter(Boolean).join(', '),
    postcode: loc.postCode ?? null,
    lat: loc.latitude ?? null,
    lon: loc.longitude ?? null,
    salary: [item.salary?.description, item.salary?.range].filter(Boolean).join(' · ') || item.displaySalary || null,
    contract: (item.contractTerms ?? []).join(', ') || null,
    workingPattern: (item.contractTypes ?? []).join(', ') || null,
    subjects: subjects.join(', ') || null,
    schoolType: [emp.employerFundingType, emp.employerPhase].filter(Boolean).join(', ') || null,
    phase: emp.employerPhase ?? null,
    funding: emp.employerFundingGroup === 'State' ? 'state' : emp.employerFundingGroup === 'Independent' ? 'independent' : null,
    posted: item.advert?.startDate ?? null,
    closing: item.application?.closeDate ?? item.advert?.endDate ?? null,
    start: job.displayStartDate ?? null,
    ectSuitable: ectIds.has(String(item.id)),
    text: htmlToText(job.description ?? item.shortDescription ?? ''),
  };
}

export async function scrape() {
  const byId = new Map();
  for (const it of await search(`subjects=Mathematics&${LONDON}`)) byId.set(String(it.id), it);
  for (const it of await search(`keywords=maths&${LONDON}`)) if (MATHS.test(it.title)) byId.set(String(it.id), it);
  const ectIds = new Set();
  for (const q of [`subjects=Mathematics&${LONDON}&nqt=true`, `keywords=maths&${LONDON}&nqt=true`]) {
    for (const it of await search(q)) ectIds.add(String(it.id));
  }
  const jobs = await mapLimit([...byId.values()], 3, (it) =>
    detail(it, ectIds).catch((e) => {
      console.warn(`[tes] ${it.canonicalUrl}: ${e.message}`);
      return null;
    }),
  );
  return jobs.filter(Boolean);
}

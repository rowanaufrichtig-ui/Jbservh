// Teaching Vacancies (DfE, GOV.UK): the free official service for
// state-funded schools in England. Search pages give us the job slugs; each
// job page carries schema.org JobPosting data plus a details list that says
// whether the role is suitable for early career teachers.

import { getText, mapLimit } from '../lib/http.mjs';
import { htmlToText, decodeEntities } from '../lib/text.mjs';

const BASE = 'https://teaching-vacancies.service.gov.uk';

// "London" on its own searches the whole of Greater London; anywhere else is
// a place name or postcode plus a radius in miles.
const where = (area) =>
  area.region === 'London' ? 'location=London' : `location=${encodeURIComponent(area.board)}&radius=${Math.round(area.radius)}`;

export const meta = {
  key: 'tv',
  name: 'Teaching Vacancies (GOV.UK)',
  home: BASE,
  note: 'England only',
  searchUrl: (area) => `${BASE}/jobs?${where(area)}&subjects%5B%5D=Mathematics&ect_statuses%5B%5D=ect_suitable`,
  // The service only lists schools in England.
  covers: (area) => area.country !== 'Wales',
};

async function slugsFor(query, maxPages = 8) {
  const slugs = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const html = await getText(`${BASE}/jobs?${query}&page=${page}`);
    const found = [...html.matchAll(/class="govuk-link view-vacancy-link"[^>]*href="\/jobs\/([^"?#]+)"/g)].map((m) => m[1]);
    const before = slugs.size;
    found.forEach((s) => slugs.add(s));
    if (!found.length || slugs.size === before || !html.includes(`page=${page + 1}`)) break;
  }
  return slugs;
}

function detailsList(html) {
  const out = {};
  const section = html.match(/id="job-details"[\s\S]*?<\/section>/)?.[0] ?? html;
  for (const m of section.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    out[htmlToText(m[1])] = htmlToText(m[2]);
  }
  return out;
}

async function job(slug, ectSlugs) {
  const url = `${BASE}/jobs/${slug}`;
  const html = await getText(url);
  const ldRaw = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  const ld = ldRaw ? JSON.parse(ldRaw) : {};
  const details = detailsList(html);
  const addr = ld.jobLocation?.address ?? {};
  const role = details['Job role'] ?? '';
  const salary = ld.baseSalary?.value;
  const salaryText =
    typeof salary?.value === 'string'
      ? salary.value
      : salary?.minValue
        ? `£${Number(salary.minValue).toLocaleString('en-GB')}${salary.maxValue ? ` – £${Number(salary.maxValue).toLocaleString('en-GB')}` : ''}`
        : null;
  return {
    source: 'tv',
    sourceId: slug,
    url,
    title: decodeEntities(ld.title ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? slug),
    employer: decodeEntities(ld.hiringOrganization?.name ?? ''),
    urn: /^\d{6}$/.test(String(ld.hiringOrganization?.identifier ?? '')) ? String(ld.hiringOrganization.identifier) : null,
    address: [addr.streetAddress, addr.addressLocality].filter(Boolean).join(', '),
    postcode: addr.postalCode ?? null,
    salary: details['Pay scale'] || details['Salary'] || salaryText,
    contract: details['Contract type'] ?? null,
    workingPattern: details['Working pattern']?.split(':')[0] ?? null,
    keyStages: details['Key stage'] ?? null,
    subjects: details['Subject'] ?? details['Subjects'] ?? null,
    schoolType: details['Organisation type'] ?? details['School type'] ?? null,
    funding: 'state',
    posted: ld.datePosted ?? null,
    closing: ld.validThrough ?? null,
    start: details['Start date'] ?? null,
    ectSuitable: ectSlugs.has(slug) || /suitable for early career teachers/i.test(role),
    visa: details['Visa sponsorship'] ?? null,
    text: htmlToText(ld.description ?? ''),
  };
}

export async function scrape(area) {
  const w = where(area);
  const all = new Set();
  for (const q of [`keyword=maths&${w}`, `keyword=mathematics&${w}`, `${w}&subjects%5B%5D=Mathematics`]) {
    (await slugsFor(q)).forEach((s) => all.add(s));
  }
  const ect = new Set();
  for (const q of [`keyword=maths&${w}`, `${w}&subjects%5B%5D=Mathematics`]) {
    (await slugsFor(`${q}&ect_statuses%5B%5D=ect_suitable`)).forEach((s) => ect.add(s));
  }
  const jobs = await mapLimit([...all], 3, (slug) =>
    job(slug, ect).catch((e) => {
      console.warn(`[tv] ${slug}: ${e.message}`);
      return null;
    }),
  );
  return jobs.filter(Boolean);
}

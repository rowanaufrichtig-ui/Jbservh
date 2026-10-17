// MyNewTerm. Its search page calls a JSON endpoint that returns jobs with the
// school's DfE URN, school type and an "ECT suitable" flag.

import { request } from '../lib/http.mjs';
import { htmlToText, decodeEntities } from '../lib/text.mjs';

const BASE = 'https://mynewterm.com';

export const meta = {
  key: 'mnt',
  name: 'MyNewTerm',
  home: BASE,
  searchUrl: `${BASE}/search/category-teaching-lecturing/scategory-secondary`,
};

const PAGE_SIZE = 50;

async function page(keyword, pageNo) {
  const body = new URLSearchParams({
    ajaxType: 'searched_job',
    pageNo: String(pageNo),
    pageTotal: String(PAGE_SIZE),
    searchByKeyword: keyword,
    'searchedPostcode[lat]': '51.5072',
    'searchedPostcode[lon]': '-0.1276',
    'searchedPostcode[formatted]': 'London, UK',
    'searchedPostcode[isCountry]': '0',
    searchedMiles: '20',
  });
  const res = await request(`${BASE}/includes/ajax_requests/ajax_job_calls.php`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE}/search`,
      Origin: BASE,
    },
  });
  const data = JSON.parse(await res.text()).result;
  const rows = (data.getSearchJobsDB ?? []).flat();
  return { rows, pages: data.pagination?.totalPages ?? 1, salaries: data.getSJobSalaryDB ?? {} };
}

function toJob(r) {
  const [lat, lon] = String(r.coordinates ?? '').split(',').map(Number);
  const indep = /independent/i.test(`${r.est_type} ${r.sch_type}`);
  return {
    source: 'mnt',
    sourceId: String(r.job_ads_id),
    url: `${BASE}/jobs/${r.sch_no}/${String(r.job_ref_number).replace(/[^A-Za-z0-9]+/g, '-')}`,
    title: decodeEntities(r.job_position),
    employer: decodeEntities(r.est_name),
    trust: r.est_trust ? decodeEntities(r.est_trust) : null,
    urn: /^\d{6}$/.test(String(r.est_number)) ? String(r.est_number) : null,
    address: [r.region, r.town].filter(Boolean).map(decodeEntities).join(', '),
    postcode: r.est_post_code ?? null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    salary: r.salary_range ? decodeEntities(r.salary_range) : null,
    contract: r.contract_type ?? null,
    workingPattern: r.contract_term ?? null,
    subjects: r.subject_type ?? r.school_sub_cats ?? null,
    schoolType: [r.sch_type, r.est_type].filter((v, i, a) => v && a.indexOf(v) === i).join(', ') || null,
    phase: r.sch_type ?? null,
    funding: indep ? 'independent' : r.sch_type ? 'state' : null,
    posted: r.posted_datetime ?? null,
    closing: r.expiry_datetime ?? r.closing_date ?? null,
    start: r.job_start_date ?? null,
    ectSuitable: Number(r.is_nqts_suitable) === 1,
    visa: Number(r.visa_sponsorship_available) === 1 ? 'Visa sponsorship available' : null,
    text: htmlToText(r.summary_headline ?? ''),
  };
}

export async function scrape() {
  const byId = new Map();
  for (const kw of ['math', 'maths', 'mathematics']) {
    for (let p = 1, pages = 1; p <= Math.min(pages, 6); p++) {
      const res = await page(kw, p);
      pages = res.pages;
      for (const r of res.rows) byId.set(String(r.job_ads_id), r);
      if (!res.rows.length) break;
    }
  }
  return [...byId.values()].map(toJob);
}

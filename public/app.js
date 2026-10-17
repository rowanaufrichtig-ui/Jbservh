// Square One front end: loads data/jobs.json and data/schools.json, renders
// the filterable job list, the schools map and the per-school profile.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const M1 = { 'Inner London': 41729, 'Outer London': 39196, Fringe: 35602 };

// Ordinal blue ramps for map markers, low -> high. Validated against the
// light (#fafaf8) and dark (#262626) basemaps; on dark, higher = lighter.
const RAMP = {
  light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
  dark: ['#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
};

const minus = (s) => String(s).replace(/-/g, '−');
const pct = (v, dp = 0) => (v == null ? '–' : `${v.toFixed(dp)}%`);

function gradeFromAps(aps) {
  if (aps == null || aps < 5) return null;
  const letters = ['E', 'D', 'C', 'B', 'A', 'A*'];
  const idx = Math.min(5, Math.max(0, Math.round(aps / 10) - 1));
  const offset = aps - (idx + 1) * 10;
  return letters[idx] + (offset < -5 / 3 ? '-' : offset >= 5 / 3 && idx < 5 ? '+' : '');
}
const ucas = (aps) => (aps == null ? null : 0.8 * aps + 8);

const METRICS = {
  maths4: {
    title: 'GCSE maths, grade 4 or above',
    value: (s) => s.gcse?.maths4 ?? null,
    text: (v) => `${v.toFixed(0)}% got grade 4+ in GCSE maths`,
    short: (v) => `${v.toFixed(0)}%`,
    bins: [60, 70, 80, 90],
    labels: ['under 60%', '60–69%', '70–79%', '80–89%', '90%+'],
    none: 'No GCSE results (16–19 or new school)',
  },
  maths5: {
    title: 'GCSE maths, grade 5 or above',
    value: (s) => s.gcse?.maths5 ?? null,
    text: (v) => `${v.toFixed(0)}% got grade 5+ in GCSE maths`,
    short: (v) => `${v.toFixed(0)}%`,
    bins: [40, 55, 70, 85],
    labels: ['under 40%', '40–54%', '55–69%', '70–84%', '85%+'],
    none: 'No GCSE results (16–19 or new school)',
  },
  alevel: {
    title: 'A level average grade · UCAS points per A level',
    value: (s) => s.alevel?.aps ?? null,
    text: (v) => `A level average ${minus(gradeFromAps(v))} · ≈${ucas(v).toFixed(0)} UCAS points per A level`,
    short: (v) => minus(gradeFromAps(v)),
    bins: [31.67, 35, 38.33, 45],
    labels: ['C or below · <33', 'C+ · 33–36', 'B− · 36–39', 'B, B+ · 39–44', 'A− or above · 44+'],
    none: 'No A level results',
  },
};
const binOf = (bins, v) => bins.filter((b) => v >= b).length;

const ROLE_GROUP = { teacher: 'teacher', trainee: 'trainee', speculative: 'speculative', leadership: 'leadership', support: 'support', tutor: 'support', other: 'support' };
const SECTOR_GROUP = { state: 'state', trust: 'state', independent: 'independent', special: 'special' };
const ROLE_LABEL = { trainee: 'Teacher training', speculative: 'Speculative application', leadership: 'Leadership / TLR', support: 'Support role', tutor: 'Tutor', other: 'Other role' };
const SECTOR_LABEL = { trust: 'Trust-wide role', independent: 'Independent', special: 'Special / alternative provision', primary: 'Primary', agency: 'Agency', unknown: 'Employer not matched', university: 'University' };
const CATEGORY_LABEL = { secondary: 'Secondary school', 'all-through': 'All-through school', '16-19': '16–19 school', 'sixth-form-college': 'Sixth form college', 'fe-college': 'FE college' };

const ICON = {
  check: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6.2 11.6 2.6 8l1.1-1.1 2.5 2.5 6.1-6.1 1.1 1.1z"/></svg>',
  half: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="currentColor" d="M8 2.5a5.5 5.5 0 0 1 0 11z"/></svg>',
  dash: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 7.2h10v1.6H3z"/></svg>',
  cap: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 2 0.8 5.6 8 9.2l5.6-2.8v3.8h1.4V5.6zM3.6 8.4v2.8L8 13.4l4.4-2.2V8.4L8 10.6z"/></svg>',
};

const ECT_PILL = {
  yes: ['ect-yes', ICON.check, 'Suitable for ECTs'],
  likely: ['ect-likely', ICON.half, 'Likely open to ECTs'],
  no: ['ect-no', ICON.dash, 'Not aimed at ECTs'],
  training: ['ect-training', ICON.cap, 'Teacher training route'],
};

const state = {
  jobs: [],
  sources: [],
  generated: null,
  schools: [],
  schoolsMeta: null,
  schoolByUrn: new Map(),
  jobsByUrn: new Map(),
};

const DEFAULT_FILTERS = { q: '', ect: 'friendly', sector: ['state'], phase: 'any', role: ['teacher', 'trainee', 'speculative'], borough: '', pay: '', contract: '', sort: 'closing' };
let filters = { ...DEFAULT_FILTERS, ...store.get('sq1-filters', {}) };
if (!Array.isArray(filters.sector) || !Array.isArray(filters.role)) filters = { ...DEFAULT_FILTERS };

// ---------- theme ----------
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function setupTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('sq1-theme', next);
    } catch {}
    onThemeChange();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onThemeChange);
}
function onThemeChange() {
  if (map) {
    drawMarkers();
    renderLegend();
  }
}

// ---------- dates ----------
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const stampFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
function closingInfo(iso) {
  if (!iso) return { text: 'No closing date given', soon: false };
  const d = new Date(iso);
  const days = Math.ceil((d - Date.now()) / 864e5);
  if (days > 300) return { text: 'Open application', soon: false };
  const when = dayFmt.format(d);
  if (days <= 0) return { text: `${when} (today)`, soon: true };
  if (days === 1) return { text: `${when} (tomorrow)`, soon: true };
  return { text: `${when} (${days} days)`, soon: days <= 3 };
}

function startText(v) {
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const uk = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const d = iso ? new Date(+iso[1], iso[2] - 1, +iso[3]) : uk ? new Date(+uk[3], uk[2] - 1, +uk[1]) : null;
  if (!d) return v;
  // Some boards fill in the posting date when no start date was given.
  if (d < new Date(Date.now() - 864e5)) return 'As soon as possible';
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// ---------- jobs ----------
function jobMatches(job) {
  if (filters.ect === 'yes' && job.ect !== 'yes') return false;
  if (filters.ect === 'friendly' && job.ect === 'no') return false;
  if (!filters.role.includes(ROLE_GROUP[job.role] ?? 'support')) return false;
  if (!filters.sector.includes(SECTOR_GROUP[job.sector] ?? 'other')) return false;
  if (filters.phase === 'sixthform' && !job.sixthForm) return false;
  if (filters.phase === 'ks5' && !job.ks5) return false;
  if (filters.borough && job.borough !== filters.borough) return false;
  if (filters.pay && job.payArea !== filters.pay) return false;
  if (filters.contract && job.contract !== filters.contract) return false;
  if (filters.q) {
    const hay = [job.title, job.employer, job.school, job.borough, job.trust, job.postcode, job.summary].join(' ').toLowerCase();
    if (!filters.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const SORTS = {
  closing: (a, b) => (a.closing ?? '9999').localeCompare(b.closing ?? '9999'),
  newest: (a, b) => (b.posted ?? '').localeCompare(a.posted ?? ''),
  gcse: (a, b) => (state.schoolByUrn.get(b.urn)?.gcse?.maths4 ?? -1) - (state.schoolByUrn.get(a.urn)?.gcse?.maths4 ?? -1),
  alevel: (a, b) => (state.schoolByUrn.get(b.urn)?.alevel?.aps ?? -1) - (state.schoolByUrn.get(a.urn)?.alevel?.aps ?? -1),
};

function pill(job) {
  const p = ECT_PILL[job.ect];
  return p ? `<span class="pill ${p[0]}">${p[1]}${p[2]}</span>` : '';
}

function snapshot(job) {
  const s = state.schoolByUrn.get(job.urn);
  if (!s) {
    return job.sector === 'trust'
      ? `<div class="snapshot none">Trust-wide role. Check the advert for which school${job.trust ? ` in ${esc(job.trust)}` : ''} you would work in.</div>`
      : '';
  }
  const b = state.schoolsMeta.boroughs[s.borough];
  const stats = [];
  if (s.gcse?.maths4 != null) {
    stats.push(`<div class="stat"><b>${pct(s.gcse.maths4)}</b><span>GCSE maths 4+${b?.maths4 != null ? ` · borough ${pct(b.maths4)}` : ''}</span></div>`);
  }
  if (s.alevel?.aps != null) {
    stats.push(`<div class="stat"><b>${minus(s.alevel.grade ?? gradeFromAps(s.alevel.aps))}</b><span>A level average · ≈${s.alevel.ucas3} UCAS for 3</span></div>`);
  }
  if (s.alevel?.mathsPct != null) stats.push(`<div class="stat"><b>${pct(s.alevel.mathsPct)}</b><span>of A level students take maths</span></div>`);
  if (!s.hasSixthForm) stats.push(`<div class="stat"><b>11–16</b><span>no sixth form</span></div>`);
  if (s.fsm != null) stats.push(`<div class="stat"><b>${pct(s.fsm)}</b><span>free school meals</span></div>`);
  return `<div class="snapshot">${stats.join('')}<a class="button ghost" href="#school-${s.urn}">School profile &amp; map</a></div>`;
}

function jobCard(job) {
  const main = job.sources[0];
  const close = closingInfo(job.closing);
  const tags = [];
  if (ROLE_LABEL[job.role]) tags.push(`<span class="tag">${ROLE_LABEL[job.role]}</span>`);
  if (job.ks5) tags.push('<span class="tag strong">A level / KS5</span>');
  else if (job.sixthForm) tags.push('<span class="tag">Sixth form school</span>');
  if (SECTOR_LABEL[job.sector]) tags.push(`<span class="tag">${SECTOR_LABEL[job.sector]}</span>`);
  if (job.stale) tags.push('<span class="tag">Board unavailable at last check</span>');

  const facts = [
    ['Closes', `<span class="${close.soon ? 'closing-soon' : ''}">${esc(close.text)}</span>`],
    job.salary && ['Pay', esc(job.salary)],
    job.contract && ['Contract', esc(job.contract)],
    job.workingPattern && ['Hours', esc(job.workingPattern)],
    job.start && ['Starts', esc(startText(job.start))],
  ].filter(Boolean);

  const where = [job.borough, job.payArea && `${job.payArea} pay`].filter(Boolean).map(esc).join(' · ');
  const reasons = (job.ectReasons ?? []).map((r) => `<li>${esc(r)}</li>`).join('');
  const signals = (job.ectSignals ?? []).map((s) => `<span class="tag">${esc(s)}</span>`).join(' ');
  const links = job.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join('');

  return `<li class="job">
    <div class="job-top">${pill(job)}${tags.join('')}</div>
    <h3 class="job-title"><a href="${esc(main.url)}" target="_blank" rel="noopener">${esc(job.title)}</a></h3>
    <p class="job-employer"><strong>${esc(job.school ?? job.employer)}</strong>${where ? ` · ${where}` : ''}</p>
    <dl class="job-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${snapshot(job)}
    <details>
      <summary>Why this rating, and where it is listed</summary>
      ${reasons ? `<ul class="why">${reasons}</ul>` : ''}
      ${signals ? `<p class="excerpt">Advert mentions: ${signals}</p>` : ''}
      ${job.summary ? `<p class="excerpt">${esc(job.summary)}</p>` : ''}
      <div class="also"><span>Listed on</span>${links}</div>
    </details>
  </li>`;
}

function renderJobs() {
  const list = state.jobs.filter(jobMatches).sort(SORTS[filters.sort] ?? SORTS.closing);
  $('#job-list').innerHTML = list.map(jobCard).join('');
  $('#jobs-empty').hidden = list.length > 0;
  $('#results-count').innerHTML = `<strong>${list.length}</strong> of ${state.jobs.length} jobs match`;
}

function readFilters() {
  filters = {
    q: $('#f-q').value.trim(),
    ect: $('input[name="f-ect"]:checked').value,
    sector: $$('input[name="f-sector"]:checked').map((i) => i.value),
    phase: $('input[name="f-phase"]:checked').value,
    role: $$('input[name="f-role"]:checked').map((i) => i.value),
    borough: $('#f-borough').value,
    pay: $('#f-pay').value,
    contract: $('#f-contract').value,
    sort: $('#f-sort').value,
  };
  store.set('sq1-filters', filters);
  renderJobs();
}

function writeFilters() {
  $('#f-q').value = filters.q;
  $$('input[name="f-ect"]').forEach((i) => (i.checked = i.value === filters.ect));
  $$('input[name="f-sector"]').forEach((i) => (i.checked = filters.sector.includes(i.value)));
  $$('input[name="f-phase"]').forEach((i) => (i.checked = i.value === filters.phase));
  $$('input[name="f-role"]').forEach((i) => (i.checked = filters.role.includes(i.value)));
  $('#f-borough').value = filters.borough;
  $('#f-pay').value = filters.pay;
  $('#f-contract').value = filters.contract;
  $('#f-sort').value = filters.sort;
}

function setupFilters() {
  const boroughs = [...new Set(state.schools.map((s) => s.borough))].sort();
  for (const sel of ['#f-borough', '#m-borough']) {
    $(sel).insertAdjacentHTML('beforeend', boroughs.map((b) => `<option>${esc(b)}</option>`).join(''));
  }
  writeFilters();
  $('#filters-body').addEventListener('input', readFilters);
  $('#filters-body').addEventListener('change', readFilters);
  $('#filters-body').addEventListener('submit', (e) => e.preventDefault());
  $('#f-sort').addEventListener('change', readFilters);
  $('#f-reset').addEventListener('click', () => {
    filters = { ...DEFAULT_FILTERS };
    writeFilters();
    readFilters();
  });
  const toggle = $('#filters-toggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    $('#filters-body').classList.toggle('open', open);
  });
}

// ---------- map ----------
let map, tiles, markerLayer, renderer;
const markers = new Map();
let selectedUrn = null;
const mapState = { metric: 'maths4', kind: 'all', borough: '', q: '' };

function visibleSchools() {
  const q = mapState.q.toLowerCase();
  return state.schools.filter((s) => {
    if (mapState.kind === 'sixthform' && !s.hasSixthForm) return false;
    if (mapState.kind === 'post16' && !['16-19', 'sixth-form-college'].includes(s.category)) return false;
    if (mapState.kind === 'vacancies' && !state.jobsByUrn.has(s.urn)) return false;
    if (mapState.borough && s.borough !== mapState.borough) return false;
    if (q && !`${s.name} ${s.postcode} ${s.trust ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// OpenStreetMap tiles, greyed (and inverted in dark mode) by a CSS filter
// so the coloured school markers carry the meaning.
function setTiles() {
  if (tiles) return;
  tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'basemap',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
}

function markerStyle(s) {
  const m = METRICS[mapState.metric];
  const v = m.value(s);
  const ramp = RAMP[isDark() ? 'dark' : 'light'];
  const hasJobs = state.jobsByUrn.has(s.urn);
  const selected = s.urn === selectedUrn;
  return {
    renderer,
    radius: selected ? 10 : hasJobs ? 8 : 5.5,
    fillColor: v == null ? cssVar('--surface') : ramp[binOf(m.bins, v)],
    fillOpacity: 1,
    color: selected ? cssVar('--ink') : hasJobs ? cssVar('--margin') : v == null ? cssVar('--ink-3') : cssVar('--surface'),
    weight: selected || hasJobs ? 3 : 1.5,
  };
}

function tipFor(s) {
  const m = METRICS[mapState.metric];
  const v = m.value(s);
  const jobs = state.jobsByUrn.get(s.urn)?.length ?? 0;
  return `<b>${esc(s.name)}</b>${v == null ? esc(m.none) : esc(m.text(v))}${jobs ? `<br>${jobs} maths job${jobs > 1 ? 's' : ''} open` : ''}`;
}

function drawMarkers() {
  markerLayer.clearLayers();
  markers.clear();
  // Schools with open jobs go on top so their rings are never hidden.
  const list = visibleSchools().filter((s) => s.lat != null);
  list.sort((a, b) => Number(state.jobsByUrn.has(a.urn)) - Number(state.jobsByUrn.has(b.urn)));
  for (const s of list) {
    const marker = L.circleMarker([s.lat, s.lon], markerStyle(s))
      .bindTooltip(() => tipFor(s), { className: 'school-tip', direction: 'top', offset: [0, -8] })
      .on('click', () => openSchool(s.urn, { fly: false }));
    marker.addTo(markerLayer);
    markers.set(s.urn, marker);
  }
  renderSchoolList();
}

function renderLegend() {
  const m = METRICS[mapState.metric];
  const ramp = RAMP[isDark() ? 'dark' : 'light'];
  $('#legend').innerHTML = `
    <div class="legend-title">${esc(m.title)}</div>
    <div class="legend-steps">${m.labels.map((l, i) => `<span class="legend-step"><span class="dot" style="background:${ramp[i]}"></span>${esc(l)}</span>`).join('')}</div>
    <div class="legend-steps">
      <span class="legend-step"><span class="dot ring"></span>Maths job open now</span>
      <span class="legend-step"><span class="dot nodata"></span>${esc(m.none)}</span>
    </div>`;
}

function renderSchoolList() {
  if (!map) return;
  const m = METRICS[mapState.metric];
  const bounds = map.getBounds();
  const inView = visibleSchools().filter((s) => s.lat != null && bounds.contains([s.lat, s.lon]));
  inView.sort((a, b) => (m.value(b) ?? -1) - (m.value(a) ?? -1));
  const what = mapState.metric === 'alevel' ? 'best A level results first' : 'best GCSE maths first';
  $('#school-count').textContent = `${inView.length} school${inView.length === 1 ? '' : 's'} in this view, ${what}`;
  $('#school-list').innerHTML = inView
    .map((s) => {
      const v = m.value(s);
      const jobs = state.jobsByUrn.get(s.urn)?.length ?? 0;
      const meta = [s.borough, CATEGORY_LABEL[s.category], s.hasSixthForm && s.category !== '16-19' && !s.category.endsWith('college') ? 'sixth form' : null]
        .filter(Boolean)
        .join(' · ');
      return `<li><button type="button" data-urn="${s.urn}">
        <span class="s-name">${esc(s.name)}</span>
        <span class="s-val">${v == null ? '–' : esc(m.short(v))}</span>
        <span class="s-meta">${esc(meta)}${jobs ? ` · <span class="s-jobs">${jobs} maths job${jobs > 1 ? 's' : ''}</span>` : ''}</span>
      </button></li>`;
    })
    .join('');
}

function cmpRows(rows, max, fmt) {
  return rows
    .filter((r) => r.value != null)
    .map(
      (r) => `<div class="cmp-row${r.school ? ' is-school' : ''}" title="${esc(r.label)}: ${esc(fmt(r.value))}">
        <span class="cmp-label">${esc(r.label)}</span>
        <span class="cmp-track"><span class="cmp-bar" style="width:${Math.max(1, Math.min(100, (r.value / max) * 100))}%"></span></span>
        <span class="cmp-val">${esc(fmt(r.value))}</span>
      </div>`,
    )
    .join('');
}

function schoolDetail(s) {
  const meta = state.schoolsMeta;
  const b = meta.boroughs[s.borough] ?? {};
  const lon = meta.averages.london, eng = meta.averages.england;
  const tags = [
    s.hasSixthForm ? (s.category === 'secondary' || s.category === 'all-through' ? 'Has a sixth form' : 'Post-16 only') : 'No sixth form (11–16)',
    s.admissions === 'Selective' && 'Selective (grammar)',
    s.gender && s.gender !== 'Mixed' && `${s.gender} only`,
    s.religion,
  ].filter(Boolean);
  const facts = [
    ['Type', `${s.type}${s.ageRange ? `, ages ${s.ageRange}` : ''}`],
    s.trust && ['Trust', s.trust],
    s.pupils && ['Pupils', `${s.pupils.toLocaleString('en-GB')}${s.capacity ? ` (capacity ${s.capacity.toLocaleString('en-GB')})` : ''}`],
    s.fsm != null && ['Free school meals', `${s.fsm}% of pupils`],
    s.payArea && ['Pay area', `${s.payArea} · M1 from £${M1[s.payArea].toLocaleString('en-GB')}`],
    ['Address', `${s.address}, ${s.postcode}`],
    s.phone && ['Phone', s.phone],
  ].filter(Boolean);

  let gcse = '';
  if (s.gcse) {
    const g = s.gcse;
    gcse = `<section class="block">
      <h3>GCSE maths</h3>
      <p class="src">Year 11 in ${esc(meta.gcseYear)}${g.pupils ? ` · ${g.pupils} pupils` : ''}</p>
      <div class="headline-nums">
        <div><b>${pct(g.maths4, 1)}</b><span>grade 4 or above</span></div>
        <div><b>${pct(g.maths5, 1)}</b><span>grade 5 or above</span></div>
        ${g.engMaths4 != null ? `<div><b>${pct(g.engMaths4, 1)}</b><span>4+ in English and maths</span></div>` : ''}
      </div>
      <div class="cmp" role="group" aria-label="GCSE maths grade 4 or above compared">
        <span class="cmp-caption">Grade 4+ in maths compared</span>
        ${cmpRows(
          [
            { label: 'This school', value: g.maths4, school: true },
            { label: s.borough, value: b.maths4 },
            { label: 'London', value: lon.maths4 },
            { label: 'England (state)', value: eng.maths4 },
          ],
          100,
          (v) => `${v.toFixed(0)}%`,
        )}
      </div>
    </section>`;
  }

  let alevel = '';
  if (s.alevel) {
    const a = s.alevel;
    const grade = a.aps != null ? minus(a.grade ?? gradeFromAps(a.aps)) : null;
    const extra = [
      a.mathsPct != null && `${pct(a.mathsPct)} of A level students take maths${a.furtherMathsPct != null ? `, ${pct(a.furtherMathsPct)} further maths` : ''}`,
      a.aab2fac != null && `${pct(a.aab2fac)} get AAB or better with two facilitating subjects`,
      a.va != null && `Value added ${a.va > 0 ? '+' : ''}${a.va.toFixed(2)} grades (0 is the national average)`,
      a.gradePrev && `Previous year’s average: ${minus(a.gradePrev)}`,
    ].filter(Boolean);
    alevel = `<section class="block">
      <h3>A level</h3>
      <p class="src">16–18 students in ${esc(meta.alevelYear)}${a.students ? ` · ${a.students} took A levels` : ''}</p>
      ${
        a.aps != null
          ? `<div class="headline-nums">
        <div><b>${esc(grade)}</b><span>average grade</span></div>
        <div><b>${a.ucasPerEntry.toFixed(0)}</b><span>UCAS points per A level</span></div>
        <div><b>≈${a.ucas3}</b><span>UCAS points for three</span></div>
      </div>
      <div class="cmp" role="group" aria-label="A level average compared">
        <span class="cmp-caption">Average grade compared (UCAS points per A level)</span>
        ${cmpRows(
          [
            { label: 'This school', value: a.aps, school: true },
            { label: s.borough, value: b.alevelAps },
            { label: 'London', value: lon.alevelAps },
            { label: 'England (state)', value: eng.alevelAps },
          ],
          60,
          (v) => `${minus(gradeFromAps(v))} · ${ucas(v).toFixed(0)}`,
        )}
      </div>`
          : ''
      }
      ${extra.length ? `<ul class="why">${extra.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  const jobs = state.jobsByUrn.get(s.urn) ?? [];
  const vacancies = jobs.length
    ? `<section class="block">
        <h3>Maths jobs here now</h3>
        <ul class="vacancies">${jobs
          .map((j) => `<li>${pill(j)}<a href="${esc(j.sources[0].url)}" target="_blank" rel="noopener">${esc(j.title)}</a><span class="src">Closes ${esc(closingInfo(j.closing).text)} · ${j.sources.map((x) => esc(x.name)).join(', ')}</span></li>`)
          .join('')}</ul>
      </section>`
    : '';

  const links = [
    s.website && `<a href="${esc(s.website)}" target="_blank" rel="noopener">School website</a>`,
    `<a href="${esc(s.links.performance)}" target="_blank" rel="noopener">DfE performance tables</a>`,
    `<a href="${esc(s.links.ofsted)}" target="_blank" rel="noopener">Ofsted reports</a>`,
    `<a href="${esc(s.links.gias)}" target="_blank" rel="noopener">School register</a>`,
  ].filter(Boolean);

  return `
    <button type="button" class="link-button back" id="back-to-list">← All schools in view</button>
    <header>
      <h2>${esc(s.name)}</h2>
      <p class="sub">${esc(CATEGORY_LABEL[s.category])} · ${esc(s.borough)}</p>
    </header>
    <div class="job-top">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    ${vacancies}
    ${gcse}
    ${alevel}
    ${!s.gcse && !s.alevel ? '<p class="note">No published results yet. New schools appear once their first pupils finish Year 11 or Year 13.</p>' : ''}
    <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <p class="links-row">${links.join('')}</p>`;
}

function openSchool(urn, { fly = true } = {}) {
  const s = state.schoolByUrn.get(urn);
  if (!s) return;
  const previous = selectedUrn;
  selectedUrn = urn;
  const detail = $('#school-detail');
  detail.innerHTML = schoolDetail(s);
  detail.hidden = false;
  $('#school-list-view').hidden = true;
  $('#school-panel').scrollTop = 0;
  $('#back-to-list').addEventListener('click', closeSchool);
  for (const u of [previous, urn]) {
    const mk = markers.get(u);
    const sc = state.schoolByUrn.get(u);
    if (mk && sc) mk.setStyle(markerStyle(sc));
  }
  if (!markers.has(urn) && map && s.lat != null) {
    // Selected from a job while filtered out: clear the map filters.
    Object.assign(mapState, { kind: 'all', borough: '', q: '' });
    $('#m-kind').value = 'all';
    $('#m-borough').value = '';
    $('#m-q').value = '';
    drawMarkers();
  }
  markers.get(urn)?.bringToFront();
  if (fly && map && s.lat != null) map.setView([s.lat, s.lon], Math.max(map.getZoom(), 13));
  if (location.hash !== `#school-${urn}`) history.replaceState(null, '', `#school-${urn}`);
}

function closeSchool() {
  const prev = selectedUrn;
  selectedUrn = null;
  const mk = markers.get(prev);
  if (mk) mk.setStyle(markerStyle(state.schoolByUrn.get(prev)));
  $('#school-detail').hidden = true;
  $('#school-list-view').hidden = false;
  history.replaceState(null, '', '#map');
  renderSchoolList();
}

function initMap() {
  if (map) return;
  renderer = L.canvas({ padding: 0.3, tolerance: 6 });
  map = L.map('leaflet', { minZoom: 9, maxBounds: [[51.1, -0.75], [51.85, 0.5]], zoomSnap: 0.5 }).setView([51.5, -0.11], 10.5);
  setTiles();
  markerLayer = L.layerGroup().addTo(map);
  map.on('moveend', renderSchoolList);
  drawMarkers();
  renderLegend();
  $('#m-metric').addEventListener('change', (e) => {
    mapState.metric = e.target.value;
    drawMarkers();
    renderLegend();
    if (selectedUrn) markers.get(selectedUrn)?.bringToFront();
  });
  for (const [id, key] of [['#m-kind', 'kind'], ['#m-borough', 'borough'], ['#m-q', 'q']]) {
    $(id).addEventListener('input', (e) => {
      mapState[key] = e.target.value.trim();
      drawMarkers();
      if (key === 'borough') {
        const pts = visibleSchools().filter((s) => s.lat != null).map((s) => [s.lat, s.lon]);
        if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
      }
    });
  }
  $('#school-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-urn]');
    if (btn) openSchool(btn.dataset.urn);
  });
}

// ---------- sources tab ----------
function renderSources() {
  $('#source-grid').innerHTML = state.sources
    .map(
      (s) => `<article class="source">
        <h4>${esc(s.name)}</h4>
        <p class="status ${s.ok ? 'ok' : 'fail'}">${s.ok ? `${s.found} London maths adverts found` : `Could not be reached at the last check${s.error ? ` (${esc(s.error)})` : ''}`}</p>
        <a href="${esc(s.searchUrl)}" target="_blank" rel="noopener">Search on ${esc(s.name.replace(/ \(.*\)$/, ''))}</a>
      </article>`,
    )
    .join('');
}

async function setupRefresh() {
  // Only the local server (npm start) has an API; GitHub Pages does not,
  // and the Android app refreshes on the phone instead.
  if (NATIVE) return;
  try {
    const res = await fetch('api/status', { cache: 'no-store' });
    if (!res.ok) return;
    const status = await res.json();
    $('#refresh-row').hidden = false;
    const button = $('#refresh-button');
    const label = $('#refresh-status');
    const show = (s) => (label.textContent = s.running ? 'Checking the job boards… this takes about a minute.' : s.lastError ? `Last check failed: ${s.lastError}` : '');
    show(status);
    button.addEventListener('click', async () => {
      button.disabled = true;
      show({ running: true });
      await fetch('api/refresh', { method: 'POST' });
      const poll = setInterval(async () => {
        const s = await (await fetch('api/status', { cache: 'no-store' })).json();
        show(s);
        if (!s.running) {
          clearInterval(poll);
          button.disabled = false;
          await loadJobs();
          renderAll();
          label.textContent = `Updated ${stampFmt.format(new Date(state.generated))}.`;
        }
      }, 3000);
    });
  } catch {}
}

// ---------- tabs ----------
const TABS = ['jobs', 'map', 'guide', 'sources'];
function route() {
  const hash = location.hash.slice(1);
  const school = hash.match(/^school-(\d+)$/)?.[1];
  const tab = school ? 'map' : TABS.includes(hash) ? hash : 'jobs';
  for (const t of TABS) {
    $(`#${t}`).hidden = t !== tab;
    $(`#tab-${t}`).setAttribute('aria-selected', String(t === tab));
  }
  if (tab === 'map') {
    initMap();
    requestAnimationFrame(() => map.invalidateSize());
    if (school) openSchool(school);
  }
  // Tabs are sections of one page: open each one from the top, not at the
  // browser's anchor position.
  window.scrollTo({ top: 0 });
}

// ---------- boot ----------
// Inside the Android app the page can check the job boards itself.
const NATIVE = Boolean(window.Capacitor?.isNativePlatform?.());
const CACHE_KEY = 'sq1-jobs';
const AUTO_REFRESH_HOURS = 6;

function applyJobs(data) {
  state.jobs = data.jobs;
  state.sources = data.sources;
  state.generated = data.generated;
  state.jobsByUrn = new Map();
  for (const j of state.jobs) if (j.urn) state.jobsByUrn.set(j.urn, [...(state.jobsByUrn.get(j.urn) ?? []), j]);
}

async function loadJobs() {
  const bundled = await (await fetch('data/jobs.json', { cache: 'no-cache' })).json();
  const cached = NATIVE ? store.get(CACHE_KEY, null) : null;
  applyJobs(cached?.jobs && cached.generated > bundled.generated ? cached : bundled);
}

function setSync(text, busy = false) {
  $('#sync-text').textContent = text;
  $('#refresh-status').textContent = busy ? text : '';
  for (const id of ['#sync-button', '#refresh-button']) $(id).disabled = busy;
  $('#sync').classList.toggle('busy', busy);
}

const jobKey = (j) => j.sources[0]?.url;
let refreshing = null;

function refreshOnDevice() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    setSync('Checking the job boards…', true);
    try {
      const [{ buildJobsData }, establishments] = await Promise.all([
        import('./engine/lib/pipeline.js'),
        fetch('data/london-establishments.json').then((r) => r.json()),
      ]);
      const data = await buildJobsData({
        schools: state.schools,
        establishments,
        previous: { jobs: state.jobs },
        onProgress: ({ step, total, source }) => setSync(`Checking ${source} (${step} of ${total})…`, true),
      });
      if (!data.sources.some((s) => s.ok)) throw new Error('none of the job boards answered');
      const before = new Set(state.jobs.map(jobKey));
      const fresh = data.jobs.filter((j) => !before.has(jobKey(j))).length;
      store.set(CACHE_KEY, data);
      applyJobs(data);
      renderAll();
      setSync(`Updated ${stampFmt.format(new Date(data.generated))}${fresh ? ` · ${fresh} new job${fresh === 1 ? '' : 's'}` : ''}`);
    } catch (e) {
      console.error(e);
      setSync(`Could not check the job boards (${e.message}). Showing jobs from ${stampFmt.format(new Date(state.generated))}.`);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function setupSync() {
  setSync(`Jobs checked ${stampFmt.format(new Date(state.generated))}`);
  if (!NATIVE) return;
  document.documentElement.classList.add('native');
  $('#sync-button').hidden = false;
  $('#sync-button').addEventListener('click', refreshOnDevice);
  $('#refresh-row').hidden = false;
  $('#refresh-button').addEventListener('click', refreshOnDevice);
  // Check automatically when the jobs are more than a few hours old, unless
  // the phone is offline or in data saver mode.
  const ageHours = (Date.now() - new Date(state.generated)) / 36e5;
  if (ageHours > AUTO_REFRESH_HOURS && navigator.onLine !== false && !navigator.connection?.saveData) refreshOnDevice();
}

function renderAll() {
  renderJobs();
  renderSources();
  const ectCount = state.jobs.filter((j) => j.ect === 'yes').length;
  $('#tally-jobs').textContent = state.jobs.length;
  $('#tally-ect').textContent = ectCount;
  $('#tally-schools').textContent = state.schools.length;
  $('#updated').textContent = `Jobs checked ${stampFmt.format(new Date(state.generated))} · results ${state.schoolsMeta.gcseYear}`;
  if (map) drawMarkers();
}

async function boot() {
  setupTheme();
  try {
    const [schools] = await Promise.all([(await fetch('data/schools.json')).json(), loadJobs()]);
    state.schoolsMeta = schools;
    state.schools = schools.schools;
    state.schoolByUrn = new Map(state.schools.map((s) => [s.urn, s]));
  } catch (e) {
    $('#results-count').textContent = 'The job data could not be loaded. If you opened index.html straight from disk, run `npm start` and use http://localhost:8080 instead.';
    console.error(e);
    return;
  }
  for (const id of ['guide-gcse-year', 'data-years']) $(`#${id}`).textContent = state.schoolsMeta.gcseYear;
  $('#guide-alevel-year').textContent = state.schoolsMeta.alevelYear;
  setupFilters();
  renderAll();
  window.addEventListener('hashchange', route);
  route();
  setupSync();
  setupRefresh();
}

boot();

// Small fetch wrapper: browser-like user agent, timeouts, retries and a
// polite per-host delay so we never hammer the job sites.

export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0 Safari/537.36 LondonMathsECTJobs/1.0';

const lastHit = new Map();
const HOST_GAP_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHost(url) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + HOST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

export async function request(url, { method = 'GET', headers = {}, body, timeout = 45000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitForHost(url);
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-GB,en;q=0.9', ...headers },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status} for ${url}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.status = res.status;
        err.fatal = true;
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function getText(url, opts) {
  return (await request(url, opts)).text();
}

export async function getJSON(url, opts) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts?.headers ?? {}) } });
  return res.json();
}

export async function getBuffer(url, opts) {
  return Buffer.from(await (await request(url, opts)).arrayBuffer());
}

// Run async work over a list with limited concurrency.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

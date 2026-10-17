// Small HTTP helper: browser-like user agent, timeouts, retries and a
// polite per-host delay so we never hammer the job sites.
//
// In Node (and the GitHub Action) it uses fetch. Inside the Android app it
// calls Capacitor's native HTTP plugin instead: the WebView's own fetch is
// blocked by CORS on the job sites and silently drops headers like Referer.

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

const capacitor = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor : null;
export const usingNativeHttp = Boolean(capacitor);

// Give a native response the parts of the fetch Response API we use.
function nativeResponse(r) {
  const data = r.data;
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    headers: r.headers ?? {},
    text: async () => text,
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
  };
}

function send(url, { method, headers, body, timeout }) {
  if (capacitor) {
    const isJson = /json/i.test(headers['Content-Type'] ?? '');
    const data = body === undefined ? undefined : isJson && typeof body === 'string' ? JSON.parse(body) : String(body);
    return capacitor
      .nativePromise('CapacitorHttp', 'request', { url, method, headers, data, responseType: 'text', connectTimeout: timeout, readTimeout: timeout })
      .then(nativeResponse);
  }
  return fetch(url, {
    method,
    body: body instanceof URLSearchParams ? body.toString() : body,
    headers,
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
}

function withTimeout(promise, ms, url) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s: ${url}`)), ms + 1000);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

export async function request(url, { method = 'GET', headers = {}, body, timeout = 45000, retries = 2 } = {}) {
  let lastErr;
  const allHeaders = { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-GB,en;q=0.9', ...headers };
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitForHost(url);
    try {
      const res = await withTimeout(send(url, { method, headers: allHeaders, body, timeout }), timeout, url);
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

// Node only (used by the school data build).
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

// Text helpers shared by the scrapers.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

export function htmlToText(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// Normalise a school name for fuzzy matching across sites.
const STOP = new Set(['the', 'school', 'academy', 'college', 'and', 'of', 'a', 'for', 'high', 'secondary', 'london', 'trust', 'sixth', 'form', 'centre', 'church', 'england', 'ce', 'c', 'e', 'rc', 'catholic', 'roman', 'voluntary', 'aided']);

export function nameTokens(name = '') {
  return decodeEntities(name)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\bst\.?\b/g, 'saint')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

export function nameKey(name = '') {
  return decodeEntities(name)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\bst\.?\b/g, 'saint')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Jaccard similarity of the distinctive words in two school names.
export function nameSimilarity(a, b) {
  const A = new Set(nameTokens(a)), B = new Set(nameTokens(b));
  if (!A.size || !B.size) return nameKey(a) === nameKey(b) ? 1 : 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export const normPostcode = (p) => (p ? String(p).toUpperCase().replace(/\s+/g, '').replace(/^(.+)(\d[A-Z]{2})$/, '$1 $2') : null);

// UK postcode anywhere in a string.
export const findPostcode = (s = '') => normPostcode(String(s).toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/)?.[1]);

// Just enough of an OpenDocument spreadsheet (.ods) reader to pull a sheet
// out as rows of strings. The Welsh Government publishes its school list as .ods.

import { readZip } from './zip.mjs';

const decode = (s) =>
  s
    .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, n) => ' '.repeat(Number(n ?? 1)))
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .trim();

export function readOdsSheet(buf, sheetName) {
  const xml = readZip(buf).read('content.xml').toString('utf8');
  const start = xml.indexOf(`<table:table table:name="${sheetName}"`);
  if (start < 0) throw new Error(`No sheet called ${sheetName}`);
  const table = xml.slice(start, xml.indexOf('</table:table>', start));
  const rows = [];
  for (const row of table.matchAll(/<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g)) {
    const cells = [];
    for (const c of row[1].matchAll(/<table:table-cell([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)) {
      // Trailing empty cells are stored as one cell repeated thousands of times.
      const repeat = Math.min(Number(c[1].match(/number-columns-repeated="(\d+)"/)?.[1] ?? 1), 50);
      const value = decode(c[2] ?? '');
      for (let i = 0; i < repeat; i++) cells.push(value);
    }
    rows.push(cells);
  }
  return rows;
}

// Rows as objects keyed by the first row.
export function readOdsObjects(buf, sheetName) {
  const [header, ...rows] = readOdsSheet(buf, sheetName);
  return rows
    .filter((r) => r.some((v) => v))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']).filter(([h]) => h)));
}

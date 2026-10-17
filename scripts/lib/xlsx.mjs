// Just enough of an .xlsx reader to pull a worksheet out as rows of values.

import { readZip } from './zip.mjs';

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readSheet(buf, sheetName) {
  const zip = readZip(buf);
  const text = (name) => zip.read(name).toString('utf8');

  const shared = [];
  if (zip.names.includes('xl/sharedStrings.xml')) {
    for (const si of text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(decodeXml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
    }
  }

  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  const sheets = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({
    name: decodeXml(m[1]),
    rid: m[2],
  }));
  const sheet = sheets.find((s) => s.name === sheetName) ?? sheets[sheets.length - 1];
  const target = rels.match(new RegExp(`Id="${sheet.rid}"[^>]*Target="([^"]+)"`))?.[1] ??
    rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${sheet.rid}"`))?.[1];
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;

  const rows = [];
  for (const rowMatch of text(path).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of rowMatch[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, inner = ''] = c;
      const type = attrs.match(/t="(\w+)"/)?.[1];
      let value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (type === 's') value = shared[Number(value)];
      else if (type === 'inlineStr') value = decodeXml(inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '');
      else if (value !== undefined) value = decodeXml(value);
      row[colIndex(ref)] = value ?? '';
    }
    rows.push(row);
  }
  return rows;
}

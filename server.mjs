#!/usr/bin/env node
// Local server: serves the site from public/ and lets the page trigger a
// fresh scrape of the job boards (POST /api/refresh).
//
//   npm start            -> http://localhost:8080
//   PORT=3000 npm start

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8080;
const MIN_GAP_MS = 10 * 60 * 1000; // be polite to the job boards

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const refresh = { running: false, lastRun: 0, lastError: null };

function runScrape() {
  refresh.running = true;
  refresh.lastError = null;
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'scrape-jobs.mjs')], { stdio: ['ignore', 'inherit', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.on('close', (code) => {
    refresh.running = false;
    refresh.lastRun = Date.now();
    if (code !== 0) refresh.lastError = stderr.trim().split('\n').pop() || `exit code ${code}`;
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/status') return send(res, 200, refresh);
  if (url.pathname === '/api/refresh') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
    if (refresh.running) return send(res, 202, refresh);
    if (Date.now() - refresh.lastRun < MIN_GAP_MS) {
      return send(res, 429, { ...refresh, error: 'The job boards were checked less than 10 minutes ago.' });
    }
    runScrape();
    return send(res, 202, refresh);
  }

  let path;
  try {
    path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  } catch {
    return send(res, 400, 'Bad request', 'text/plain');
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = join(PUBLIC, path);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const ext = extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.json' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(await readFile(file));
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
});

server.listen(PORT, () => console.log(`Square One running at http://localhost:${PORT}`));

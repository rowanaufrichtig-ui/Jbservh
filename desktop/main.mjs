// Square One for Mac (and Windows/Linux): an Electron window around the
// website in app-web/. Job checks run here in the main process with the same
// pipeline the GitHub Action uses, so there are no CORS limits.
//
//   npm run desktop            run from source
//   npm run desktop:mac        build the .dmg (on a Mac)
//
// SQUAREONE_SMOKE=1 opens the app, checks the page rendered, presses "Check
// now" for London, switches to Cardiff and checks again, opens the map and
// exits 0/1 (used in CI).

import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, session, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'app-web');
const ORIGIN = 'app://squareone';
const SMOKE = process.env.SQUAREONE_SMOKE === '1';
const APP_UA = `SquareOneMathsJobs/${app.getVersion()} (+https://github.com/rowanaufrichtig-ui/Jbservh)`;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Serve app-web/ at app://squareone/, refusing anything outside it.
function serveAppFiles() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = normalize(join(WEB, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(WEB + sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// OpenStreetMap's tile policy asks apps to identify themselves.
function identifyToTileServer() {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://tile.openstreetmap.org/*'] }, (details, callback) => {
    details.requestHeaders['User-Agent'] = `${details.requestHeaders['User-Agent']} ${APP_UA}`;
    details.requestHeaders.Referer = 'https://github.com/rowanaufrichtig-ui/Jbservh';
    callback({ requestHeaders: details.requestHeaders });
  });
}

const readJSON = async (path) => JSON.parse(await readFile(path, 'utf8'));
let refreshing = null;

// Run the job pipeline for the renderer, for whichever area it has chosen,
// streaming progress back to it.
ipcMain.handle('jobs:refresh', async (event, area, previous) => {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const engine = (name) => import(pathToFileURL(join(WEB, 'engine', 'lib', `${name}.js`)).toString());
    const [{ buildJobsData }, { regionsForArea }] = await Promise.all([engine('pipeline'), engine('places')]);
    const index = await readJSON(join(WEB, 'data', 'schools', 'index.json'));
    const regions = regionsForArea(area, index.regions);
    const schools = [], establishments = [];
    for (const r of regions) {
      schools.push(...(await readJSON(join(WEB, 'data', 'schools', `${r.slug}.json`))).schools);
      establishments.push(...(await readJSON(join(WEB, 'data', 'establishments', `${r.slug}.json`))));
    }
    return buildJobsData({
      area,
      schools,
      establishments,
      previous,
      log: (...a) => console.log(`[jobs:${area.name}]`, ...a),
      onProgress: (p) => !event.sender.isDestroyed() && event.sender.send('jobs:progress', p),
    });
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 420,
    minHeight: 560,
    show: false,
    title: 'Square One',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1422' : '#f6f8fc',
    webPreferences: {
      preload: join(ROOT, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Job adverts, school websites and gov.uk pages open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

async function smokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (code, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(code)) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  };
  const rendered = await wait(`document.querySelectorAll('.job').length > 0`, 30000);
  const before = await js(`({ jobs: document.querySelectorAll('.job').length, schools: document.querySelector('#tally-schools').textContent, desktop: document.documentElement.classList.contains('native'), sync: document.querySelector('#sync-text').textContent })`);
  await js(`document.querySelector('#sync-button').click()`);
  const finished = await wait(`/^(Updated|Could not)/.test(document.querySelector('#sync-text').textContent)`, 240000);
  const after = await js(`({ sync: document.querySelector('#sync-text').textContent, count: document.querySelector('#results-count').textContent })`);
  // Switch area and check again there.
  await js(`document.querySelector('#area-button').click(); document.querySelector('button[data-slug="cardiff"]').click()`);
  const switched = await wait(`document.querySelector('#area-name').textContent.startsWith('Cardiff') && !document.querySelector('#sync-button').disabled`, 30000);
  await js(`document.querySelector('#sync-button').click()`);
  const cardiffDone = await wait(`/^(Updated|Could not)/.test(document.querySelector('#sync-text').textContent)`, 240000);
  const cardiff = await js(`({ sync: document.querySelector('#sync-text').textContent, schools: document.querySelector('#tally-schools').textContent, pay: [...document.querySelectorAll('#f-pay option')].map((o) => o.textContent) })`);
  await js(`location.hash = 'map'`);
  const mapOk = await wait(`document.querySelectorAll('.leaflet-interactive, canvas').length > 0 && document.querySelector('#school-list li') !== null`, 30000);
  if (process.env.SQUAREONE_SCREENSHOT) {
    await js(`location.hash = 'school-' + document.querySelector('#school-list button').dataset.urn`);
    await new Promise((r) => setTimeout(r, 4000));
    await writeFile(process.env.SQUAREONE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  const ok =
    rendered && before.desktop && Number(before.schools) > 400 && finished && /^Updated/.test(after.sync) &&
    switched && cardiffDone && /^Updated/.test(cardiff.sync) && Number(cardiff.schools) > 20 && cardiff.pay.includes('Wales') &&
    mapOk && errors.length === 0;
  console.log(JSON.stringify({ ok, rendered, before, after, cardiff, mapOk, errors }, null, 2));
  app.exit(ok ? 0 : 1);
}

app.setName('Square One');
app.whenReady().then(() => {
  serveAppFiles();
  identifyToTileServer();
  const win = createWindow();
  if (SMOKE) smokeTest(win).catch((e) => {
    console.error(e);
    app.exit(1);
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

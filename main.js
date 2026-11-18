'use strict';
const { app, BrowserWindow, ipcMain, session, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const TOR_PROXY = 'socks5://127.0.0.1:9050';
const R = (...p) => path.join(__dirname, 'renderer', ...p);

/* ================= persistent store ================= */
const DEFAULT_SETTINGS = {
  searchEngine: 'startpage',     // startpage | duckduckgo | brave | google
  fpSpoof: true,                 // anti-fingerprinting master toggle
  strictBlock: false,            // block ALL third-party except CDN allowlist
  weatherCity: 'London',
  simpleLoginKey: '',
  lumoUrl: 'https://lumo.proton.me'
};
let store = {
  bookmarks: [],
  history: [],                   // newest first, capped at 500
  stats: { blocked: 0, requests: 0 },
  settings: Object.assign({}, DEFAULT_SETTINGS)
};
function loadStore() {
  try { Object.assign(store, JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'store.json'), 'utf8'))); }
  catch (_) { /* first run */ }
  store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings);
}
function saveStore() {
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'store.json'), JSON.stringify(store, null, 2)); } catch (_) {}
}

/* ================= search engines ================= */
const ENGINES = {
  startpage:  q => 'https://www.startpage.com/sp/search?query=' + encodeURIComponent(q),
  duckduckgo: q => 'https://duckduckgo.com/?q=' + encodeURIComponent(q),
  brave:      q => 'https://search.brave.com/search?q=' + encodeURIComponent(q),
  google:     q => 'https://www.google.com/search?q=' + encodeURIComponent(q)
};
function resolveInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^(https?:\/\/|file:\/\/)/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$|\?|#)/.test(s)) return 'https://' + s;
  return (ENGINES[store.settings.searchEngine] || ENGINES.startpage)(s);
}

/* ================= tracker / ad blocking ================= */
const BLOCKLIST = [
  'doubleclick.net','googlesyndication.com','googleadservices.com','googletagservices.com',
  'google-analytics.com','googletagmanager.com','adservice.google.com','app-measurement.com',
  'connect.facebook.net','facebook.net','analytics.tiktok.com','ads.tiktok.com',
  'static.ads-twitter.com','ads-twitter.com','analytics.twitter.com','snap.licdn.com',
  'px.ads.linkedin.com','ct.pinterest.com','tr.snapchat.com','sc-static.net',
  'bat.bing.com','clarity.ms','mc.yandex.ru','scorecardresearch.com','quantserve.com',
  'quantcount.com','chartbeat.com','parsely.com','mixpanel.com','segment.io','segment.com',
  'amplitude.com','heapanalytics.com','kissmetrics.com','branch.io','appsflyer.com',
  'adjust.com','kochava.com','singular.net','onelink.me',
  'hotjar.com','hotjar.io','fullstory.com','logrocket.com','logrocket.io',
  'luckyorange.com','mouseflow.com','crazyegg.com','clicktale.net','smartlook.com',
  'inspectlet.com',
  'fpjs.io','fpjsapi.azurewebsites.net','openfpcdn.io','fingerprintjs.com',
  'threatmetrix.com','h.online-metrix.net','perimeterx.net','px-cdn.net','pxchk.net',
  'datadome.co','distinctid.com',
  'adnxs.com','rubiconproject.com','pubmatic.com','criteo.com','criteo.net','bidswitch.net',
  'taboola.com','outbrain.com','amazon-adsystem.com','moatads.com','doubleverify.com',
  'adsrvr.org','casalemedia.com','smartadserver.com','teads.tv','sharethrough.com',
  'media.net','revcontent.com','mgid.com','popads.net','propellerads.com','zedo.com',
  'openx.net','indexww.com','gumgum.com','sovrn.com','lijit.com','yieldmo.com',
  'sentry.io','nr-data.net','bugsnag.com'
];
const CDN_ALLOW = new Set([
  'fonts.googleapis.com','fonts.gstatic.com','cdn.jsdelivr.net','unpkg.com',
  'cdnjs.cloudflare.com','tile.openstreetmap.org','basemaps.cartocdn.com',
  'a.basemaps.cartocdn.com','b.basemaps.cartocdn.com','c.basemaps.cartocdn.com',
  'd.basemaps.cartocdn.com','api.open-meteo.com','geocoding-api.open-meteo.com',
  'nominatim.openstreetmap.org','unpkg.com'
]);
function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch (_) { return ''; } }
function isBlocked(host) { return !!host && BLOCKLIST.some(d => host === d || host.endsWith('.' + d)); }

function applyBlocking(ses) {
  const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
  ses.webRequest.onBeforeRequest(filter, (details, cb) => {
    store.stats.requests++;
    const host = hostOf(details.url);
    if (isBlocked(host)) { store.stats.blocked++; return cb({ cancel: true }); }
    if (store.settings.strictBlock) {
      const init = hostOf(details.initiator || details.referrer || '');
      // file:// initiators (our own app pages) have an empty host — allow their deps
      if (init && host && init !== host && !CDN_ALLOW.has(host)) {
        store.stats.blocked++;
        return cb({ cancel: true });
      }
    }
    cb({});
  });
}

/* ================= sessions ================= */
const SES  = () => session.fromPartition('persist:pw');
const INCG = () => session.fromPartition('pw-incog');
const TOR  = () => session.fromPartition('pw-tor');

function setupSession(name, opts = {}) {
  const ses = session.fromPartition(name);
  if (opts.tor) {
    ses.setProxy({ proxyRules: TOR_PROXY, proxyBypassRules: '<local>' }).catch(() => {});
    ses.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0');
  }
  if (typeof ses.setWebRTCIPHandlingPolicy === 'function') {
  ses.setWebRTCIPHandlingPolicy(opts.tor ? 'disable_non_proxied_udp' : 'default_public_interface_only');
}
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    if (permission === 'geolocation') return cb(false);   // hard deny
    cb(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
  applyBlocking(ses);
  return ses;
}

/* ================= helpers ================= */
function run(bin, args) {
  return new Promise(res => execFile(bin, args, { timeout: 15000, windowsHide: true },
    (err, stdout, stderr) => res({ ok: !err, out: (stdout || stderr || '').trim() })));
}
function findVpnBin() {
  return new Promise(resolve => {
    if (IS_WIN) {
      execFile('where', ['protonvpn-cli'], { windowsHide: true }, (err, out) =>
        resolve(err ? null : (String(out).split(/\r?\n/)[0] || null)));
    } else {
      execFile('sh', ['-c', 'command -v protonvpn-cli || command -v protonvpn'],
        (err, out) => resolve(err ? null : (String(out).trim().split('\n')[0] || null)));
    }
  });
}

async function weatherGet() {
  const city = store.settings.weatherCity;
  const geo = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(city) + '&count=1&language=en').then(r => r.json());
  const loc = geo && geo.results && geo.results[0];
  if (!loc) return { error: 'City not found' };
  const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude +
    '&longitude=' + loc.longitude + '&current_weather=true' +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=auto').then(r => r.json());
  return {
    city: loc.name, country: loc.country,
    temp: w.current_weather.temperature, wind: w.current_weather.windspeed,
    code: w.current_weather.weathercode,
    max: w.daily.temperature_2m_max[0], min: w.daily.temperature_2m_min[0]
  };
}

/* ================= file conversion (offline) ================= */
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}
function toCSV(rows) {
  return rows.map(r => r.map(v => {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\n');
}
function md2html(md) {
  let h = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^###### (.*)$/gm, '<h6>$1</h6>').replace(/^##### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4>$1</h4>').replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>\n');
  return '<!doctype html><meta charset="utf-8"><title>Converted</title><article><p>' + h + '</p></article>';
}
function convertRun(payload) {
  const text = Buffer.from(payload.data, 'base64').toString('utf8');
  const stripExt = n => n.replace(/\.[^.]+$/, '');
  switch (payload.mode) {
    case 'csv2json': {
      const rows = parseCSV(text);
      const head = rows[0].map(h => h.trim());
      const out = rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
      return { name: stripExt(payload.name) + '.json', contentBase64: Buffer.from(JSON.stringify(out, null, 2)).toString('base64') };
    }
    case 'json2csv': {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr) || !arr.length) throw new Error('Need a JSON array of objects');
      const head = [...arr.reduce((s, o) => { Object.keys(o || {}).forEach(k => s.add(k)); return s; }, new Set())];
      return { name: stripExt(payload.name) + '.csv', contentBase64: Buffer.from(toCSV([head, ...arr.map(o => head.map(h => (o || {})[h]))])).toString('base64') };
    }
    case 'json2min':    return { name: stripExt(payload.name) + '.min.json',    contentBase64: Buffer.from(JSON.stringify(JSON.parse(text))).toString('base64') };
    case 'json2pretty': return { name: stripExt(payload.name) + '.pretty.json', contentBase64: Buffer.from(JSON.stringify(JSON.parse(text), null, 2)).toString('base64') };
    case 'md2html':     return { name: stripExt(payload.name) + '.html',        contentBase64: Buffer.from(md2html(text)).toString('base64') };
    case 'b64encode':   return { name: payload.name + '.b64.txt',               contentBase64: payload.data };
    case 'b64decode':   return { name: stripExt(payload.name) + '.decoded',     contentBase64: Buffer.from(text, 'utf8').toString('base64') };
    default: throw new Error('Unknown mode: ' + payload.mode);
  }
}

/* ================= window & state broadcast ================= */
let win;
function broadcast() {
  if (win && !win.isDestroyed())
    win.webContents.send('pw:state', { bookmarks: store.bookmarks, settings: store.settings, stats: store.stats });
}
function createWindow() {
  const icon = nativeImage.createFromPath(R('icons', 'browser.png'));
  win = new BrowserWindow({
    width: 1280, height: 850, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#16151d', icon: icon.isEmpty() ? undefined : icon,
    webPreferences: { preload: R('preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true }
  });
  win.loadFile(R('index.html'));
  win.webContents.on('did-finish-load', () => broadcast());   // first paint gets state
  win.on('maximize',   () => win.webContents.send('pw:max', true));
  win.on('unmaximize', () => win.webContents.send('pw:max', false));
}

/* ================= IPC ================= */
ipcMain.on('pw:win', (_e, cmd) => {
  if (cmd === 'min') win.minimize();
  else if (cmd === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (cmd === 'close') win.close();
});
ipcMain.handle('pw:resolve', (_e, input) => resolveInput(input));
ipcMain.handle('pw:paths', () => ({
  newtab: 'file://' + R('newtab.html'),
  maps: 'file://' + R('maps.html'),
  calc: 'file://' + R('calc.html'),
  converter: 'file://' + R('converter.html'),
  pagePreload: R('page-preload.js')
}));
ipcMain.on('pw:record', (_e, url, title) => {           // history at event time
  const u = String(url || '');
  if (!u || u.startsWith('file://')) return;
  store.history = store.history.filter(h => h.url !== u);
  store.history.unshift({ url: u, title: title || u, ts: Date.now() });
  if (store.history.length > 500) store.history.length = 500;
});
ipcMain.handle('pw:history', () => store.history);
ipcMain.handle('pw:bookmarks', () => store.bookmarks);
ipcMain.handle('pw:stats', () => store.stats);          // NEW TAB STATS WIDGET
ipcMain.on('pw:bookmark-toggle', (_e, item) => {
  const i = store.bookmarks.findIndex(b => b.url === item.url);
  if (i >= 0) store.bookmarks.splice(i, 1);
  else store.bookmarks.unshift({ url: item.url, title: item.title || item.url, ts: Date.now() });
  saveStore(); broadcast();
});
ipcMain.handle('pw:settings-get', () => store.settings);
ipcMain.on('pw:settings-set', (_e, patch) => {
  Object.assign(store.settings, patch || {});
  saveStore(); broadcast();
});
ipcMain.handle('pw:weather', async (_e, city) => {
  if (city && city.trim()) { store.settings.weatherCity = city.trim(); saveStore(); }
  try { return await weatherGet(); } catch (err) { return { error: String(err.message || err) }; }
});
ipcMain.handle('pw:news', async () => {
  try {
    const r = await fetch('https://feeds.bbci.co.uk/news/world/rss.xml');
    return { xml: await r.text() };
  } catch (err) { return { error: String(err.message || err) }; }
});
ipcMain.handle('pw:alias-create', async (_e, hostname) => {
  const key = store.settings.simpleLoginKey;
  if (!key) return { error: 'No SimpleLogin API key set (Settings → SimpleLogin API key)' };
  try {
    const r = await fetch('https://app.simplelogin.io/api/alias/random/new?hostname=' +
      encodeURIComponent(hostname || 'purplewren.local'), {
      method: 'POST', headers: { Authentication: key, 'Content-Type': 'application/json' }, body: '{}'
    });
    const j = await r.json();
    return r.ok ? j : { error: j.error || ('HTTP ' + r.status) };
  } catch (err) { return { error: String(err.message || err) }; }
});
ipcMain.handle('pw:vpn-find', async () => !!(await findVpnBin()));
ipcMain.handle('pw:vpn', async (_e, action) => {
  const bin = await findVpnBin();
  if (!bin) return { ok: false, out: 'Proton VPN CLI not found. Install it from protonvpn.com/support/official-linux-vpn (Windows client ships no CLI).' };
  const args = action === 'connect' ? ['c', '--cc', 'fastest'] : action === 'disconnect' ? ['d'] : ['s'];
  return run(bin, args);
});
ipcMain.handle('pw:convert', (_e, payload) => {
  try { return { ok: true, ...convertRun(payload) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('pw:convert-save', async (_e, payload) => {
  const { filePath } = await dialog.showSaveDialog(win, { defaultPath: payload.name });
  if (!filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, Buffer.from(payload.contentBase64, 'base64'));
  return { ok: true };
});
ipcMain.on('pw:lumo-ask', (_e, question) => {           // Maps → Lumo dock
  if (win && !win.isDestroyed()) win.webContents.send('pw:maps-ask', question);
});

/* ================= lifecycle ================= */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    loadStore();
    setupSession('persist:pw', {});
    setupSession('pw-incog', {});
    setupSession('pw-tor', { tor: true });
    if (IS_WIN) {                                       // default-browser eligibility
      app.setAsDefaultProtocolClient('http');
      app.setAsDefaultProtocolClient('https');
    }
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}

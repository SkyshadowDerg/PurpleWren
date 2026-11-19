'use strict';
const { app, BrowserWindow, ipcMain, session, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { Request } = require('@ghostery/adblocker');
const crossFetch = require('cross-fetch');
const { autoUpdater } = require('electron-updater');

const IS_WIN = process.platform === 'win32';
const TOR_PROXY = 'socks5://127.0.0.1:9050';
const R = (...p) => path.join(__dirname, 'renderer', ...p);

/* F12 opens DevTools for whatever has focus (browser UI or a webview's page). */
app.on('web-contents-created', (_e, wc) => {
  wc.on('before-input-event', (ev, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      ev.preventDefault();
      wc.toggleDevTools();
    }
  });
  /* WrenBlock cosmetic filtering: hide ad/cookie-wall elements as pages load */
  wc.on('dom-ready', () => {
    try {
      const url = (wc.getURL && wc.getURL()) || '';
      if (!url.startsWith('http') || !wbEngine || !store.settings.wrenblock.enabled) return;
      const hostname = hostOf(url);
      const domain = hostname.split('.').slice(-2).join('.');
      const { styles } = wbEngine.getCosmeticsFilters({
        hostname, domain, url,
        classes: [], ids: [], hrefs: [], decorations: []
      });
      if (styles) wc.insertCSS(styles, { cssOrigin: 'user' });
    } catch (_) {}
  });
});

/* ================= persistent store ================= */
const DEFAULT_SETTINGS = {
  searchEngine: 'startpage',
  fpSpoof: true,
  strictBlock: false,
  weatherCity: 'London',
  simpleLoginKey: '',
  lumoUrl: 'https://lumo.proton.me',
  wrenblock: {
    enabled: true,
    lists: {
      easylist: true, easyprivacy: true, annoyance: true,
      cookie: true, social: true, germany: false
    },
    customUrls: [],
    trusted: []              // hostnames user marked "trust this site"
  }
};
let store = {
  bookmarks: [],
  history: [],
  stats: { blocked: 0, requests: 0 },
  settings: Object.assign({}, DEFAULT_SETTINGS)
};
function loadStore() {
  try { Object.assign(store, JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'store.json'), 'utf8'))); }
  catch (_) { /* first run */ }
  const merged = Object.assign({}, DEFAULT_SETTINGS, store.settings);
  merged.wrenblock = Object.assign({}, DEFAULT_SETTINGS.wrenblock, (store.settings && store.settings.wrenblock) || {});
  merged.wrenblock.lists = Object.assign({}, DEFAULT_SETTINGS.wrenblock.lists, merged.wrenblock.lists);
  store.settings = merged;
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

/* ================= WrenBlock ================= */
const WRENBLOCK_LISTS = {
  easylist:    { name: 'EasyList',                        url: 'https://easylist.to/easylist/easylist.txt' },
  easyprivacy: { name: 'EasyPrivacy',                     url: 'https://easylist.to/easylist/easyprivacy.txt' },
  annoyance:   { name: "Fanboy's Annoyance (overlays)",   url: 'https://secure.fanboy.co.nz/fanboy-annoyance.txt' },
  cookie:      { name: 'EasyList Cookie (banners)',       url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt' },
  social:      { name: "Fanboy's Social (widgets)",       url: 'https://secure.fanboy.co.nz/fanboy-social.txt' },
  germany:     { name: 'EasyList Germany (regional)',     url: 'https://easylist.to/easylistgermany/easylistgermany.txt' }
};

/* strict-mode third-party lockdown still uses this allowlist */
const CDN_ALLOW = new Set([
  'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com',
  'cdnjs.cloudflare.com', 'tile.openstreetmap.org', 'basemaps.cartocdn.com',
  'a.basemaps.cartocdn.com', 'b.basemaps.cartocdn.com', 'c.basemaps.cartocdn.com',
  'd.basemaps.cartocdn.com', 'api.open-meteo.com', 'geocoding-api.open-meteo.com',
  'nominatim.openstreetmap.org'
]);

function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch (_) { return ''; } }

let wbEngine = null;
const wbCounts = new Map();          // initiator hostname -> blocked-on-this-site count

function wrenblockUrls() {
  const conf = store.settings.wrenblock;
  return Object.entries(WRENBLOCK_LISTS)
    .filter(([id]) => conf.lists[id])
    .map(([, l]) => l.url)
    .concat(conf.customUrls || []);
}

async function buildWrenblock() {
  const conf = store.settings.wrenblock;
  if (!conf.enabled) { wbEngine = null; return; }
  const urls = wrenblockUrls();
  if (!urls.length) { wbEngine = null; return; }
  wbEngine = await ElectronBlocker.fromLists(crossFetch, urls, {
    path: path.join(app.getPath('userData'), 'wrenblock-engine.bin'),
    read: fs.promises.readFile,
    write: fs.promises.writeFile
  });
  console.log('[WrenBlock] engine ready,', urls.length, 'filter lists');
}

/* Electron resourceType -> adblocker request type */
const TYPE_MAP = {
  mainFrame: 'document', subFrame: 'sub_frame', stylesheet: 'stylesheet',
  script: 'script', image: 'image', font: 'font', xhr: 'xhr', fetch: 'xhr',
  ping: 'ping', cspReport: 'other', media: 'media', webSocket: 'websocket',
  webTransport: 'websocket', other: 'other'
};

function wireWrenblock(ses) {
  const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
  ses.webRequest.onBeforeRequest(filter, (details, cb) => {
    store.stats.requests++;
    const host = hostOf(details.url);
    const init = hostOf(details.initiator || details.referrer || '');
    const conf = store.settings.wrenblock;

    if (conf.enabled && conf.trusted.includes(init)) return cb({});   // user trusts this site

    if (conf.enabled && wbEngine) {
      try {
        const req = Request.fromRawDetails({
          url: details.url,
          type: TYPE_MAP[details.resourceType] || 'other'
        });
        if (wbEngine.match(req).match) {
          store.stats.blocked++;
          const key = init || host;
          wbCounts.set(key, (wbCounts.get(key) || 0) + 1);
          return cb({ cancel: true });
        }
      } catch (_) { /* fall through to allow */ }
    }

    if (store.settings.strictBlock && init && host && init !== host && !CDN_ALLOW.has(host)) {
      store.stats.blocked++;
      return cb({ cancel: true });
    }
    cb({});
  });
}

/* ================= sessions ================= */
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
    if (permission === 'geolocation') return cb(false);
    cb(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
  wireWrenblock(ses);
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
    '&daily=temperature_2m_max,temperature_2m_min' +
    '&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto').then(r => r.json());
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
    frame: false, backgroundColor: '#131118', icon: icon.isEmpty() ? undefined : icon,
    webPreferences: { preload: R('preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true }
  });
  win.loadFile(R('index.html'));

  win.webContents.on('did-finish-load', () => broadcast());
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
ipcMain.on('pw:record', (_e, url, title) => {
  const u = String(url || '');
  if (!u || u.startsWith('file://')) return;
  store.history = store.history.filter(h => h.url !== u);
  store.history.unshift({ url: u, title: title || u, ts: Date.now() });
  if (store.history.length > 500) store.history.length = 500;
});
ipcMain.handle('pw:history', () => store.history);
ipcMain.handle('pw:bookmarks', () => store.bookmarks);
ipcMain.handle('pw:stats', () => store.stats);
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

/* ---- WrenBlock popup IPC ---- */
ipcMain.handle('pw:wrenblock-stats', (_e, host) => {
  const conf = store.settings.wrenblock;
  return {
    enabled: !!conf.enabled,
    engineReady: !!wbEngine,
    trusted: conf.trusted.includes(host),
    blockedOnSite: wbCounts.get(host) || 0,
    totalBlocked: store.stats.blocked
  };
});
ipcMain.handle('pw:wrenblock-trust', (_e, host) => {
  const conf = store.settings.wrenblock;
  const i = conf.trusted.indexOf(host);
  if (i >= 0) conf.trusted.splice(i, 1); else conf.trusted.push(host);
  saveStore();
  return { trusted: i < 0 };
});
ipcMain.handle('pw:wrenblock-set', async (_e, patch) => {
  const conf = store.settings.wrenblock;
  if (patch && typeof patch.enabled === 'boolean') conf.enabled = patch.enabled;
  if (patch && patch.lists) conf.lists = Object.assign({}, conf.lists, patch.lists);
  if (patch && Array.isArray(patch.customUrls)) conf.customUrls = patch.customUrls;
  saveStore(); broadcast();
  await buildWrenblock();          // handler closures read wbEngine live — no rewiring needed
  return { ok: true };
});

/* ---- auto-update IPC ---- */
ipcMain.on('pw:update-check', () => autoUpdater.checkForUpdatesAndNotify());
ipcMain.on('pw:update-install', () => autoUpdater.quitAndInstall());

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
ipcMain.on('pw:lumo-ask', (_e, question) => {
  if (win && !win.isDestroyed()) win.webContents.send('pw:maps-ask', question);
});
ipcMain.on('pw:open-settings-request', () => {
  if (win && !win.isDestroyed()) win.webContents.send('pw:show-settings');
});

/* ================= lifecycle ================= */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    loadStore();
    setupSession('persist:pw', {});
    setupSession('pw-incog', {});
    setupSession('pw-tor', { tor: true });
    buildWrenblock().catch(err => console.error('[WrenBlock]', err));   // async; handler allows requests until ready
    if (IS_WIN) {
      app.setAsDefaultProtocolClient('http');
      app.setAsDefaultProtocolClient('https');
    }
    createWindow();

    /* ---- auto-updater (works only in packaged NSIS builds) ---- */
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', (info) => {
      if (win && !win.isDestroyed())
        win.webContents.send('pw:update-ready', info.version);
    });
    autoUpdater.on('error', (err) => console.error('[Updater]', err));
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 30_000);                 // check 30s after launch
    setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 6 * 60 * 60 * 1000);    // then every 6h

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
'use strict';
/* PurpleWren UI controller — tabs, toolbar, dock, panels (v1.0.0) */

const $ = id => document.getElementById(id);
const state = { tabs: [], activeId: null, dock: null, bookmarks: [], settings: null };

const DOCKS = {
  lumo:      { title: '◆ Lumo' },
  calc:      { title: '🧮 Calculator' },
  converter: { title: '🔀 Converter' },
  hub:       { title: '☁ Proton hub' },
  mail:      { title: '✉ Proton Mail' }
};

let PATHS = null;
async function ensurePaths() {
  if (!PATHS) PATHS = await window.purplewren.paths();
  return PATHS;
}

/* ================= fingerprint spoof script ================= */
const FINGERPRINT_JS = `
  if (typeof cfg !== 'undefined' && cfg) {
    const off = -cfg.tzOffsetMinutes;
    Date.prototype.getTimezoneOffset = function(){ return off; };
    const RealDTF = Intl.DateTimeFormat;
    const P = function(...a){ if (!a[0]) a[0] = cfg.locale; return new RealDTF(...a); };
    P.prototype = RealDTF.prototype;
    Object.defineProperty(Intl, 'DateTimeFormat', { value: P, configurable: true });
    Object.defineProperty(navigator, 'language',  { get: () => cfg.locale });
    Object.defineProperty(navigator, 'languages', { get: () => [cfg.locale] });
    Object.defineProperty(screen, 'width',       { get: () => 1920 });
    Object.defineProperty(screen, 'height',      { get: () => 1080 });
    Object.defineProperty(screen, 'availWidth',  { get: () => 1920 });
    Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
    Object.defineProperty(navigator, 'platform', get(){}; )0
    Object.defineProperty(navigator, 'platform',           { get: () => 'Win32' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8 });
    let seed = cfg.seed >>> 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...a){
      const ctx = origGetContext.call(this, type, ...a);
      if (ctx && type === '2d') {
        const orig = ctx.getImageData.bind(ctx);
        ctx.getImageData = function(x, y, w, h){
          const d = orig(x, y, w, h);
          for (let i = 0; i < d.data.length; i += 4)
            d.data[i] = (d.data[i] + Math.floor(rnd() * 3)) & 0xff;
          return d;
        };
      }
      return ctx;
    };
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...a){
      const ctx = origGetContext.call(this, '2d');
      if (ctx) { ctx.fillStyle = 'rgba(0,0,0,0.01)'; ctx.fillRect(0, 0, 1, 1); }
      return origToDataURL.apply(this, a);
    };
    const mask = (proto) => {
      const orig = proto.getParameter;
      proto.getParameter = function(p){
        if (p === 37445) return 'Mozilla';
        if (p === 37446) return 'Mozilla';
        return orig.call(this, p);
      };
    };
    if (window.WebGLRenderingContext)  mask(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) mask(WebGL2RenderingContext.prototype);
    if (window.AudioContext || window.webkitAudioContext) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const origCh = AC.prototype.getChannelData;
      AC.prototype.getChannelData = function(ch){
        const data = origCh.call(this, ch);
        for (let i = 0; i < data.length; i += 500) data[i] += (rnd() - 0.5) * 1e-7;
        return data;
      };
    }
    navigator.geolocation.getCurrentPosition = (_, err) => err && err({ code: 1, message: 'denied' });
    navigator.geolocation.watchPosition = (_, err) => err && err({ code: 1, message: 'denied' });
  }
`;

/* ================= tabs ================= */
function newTab(url, kind = 'normal', activate = true) {
  const id = 'tab-' + Date.now() + Math.random().toString(36).slice(2, 6);
  const tab = { id, kind, title: kind === 'tor' ? 'New Tor tab' : kind === 'incog' ? 'New incognito tab' : 'New Tab', url: '', view: null };
  state.tabs.push(tab);
  if (activate) setActive(id);
  renderTabs();
  navigate(tab, url);
  return tab;
}

async function navigate(tab, input) {
  if (!input) {                                   // blank → New Tab dashboard
    const p = await ensurePaths();
    input = p.newtab;
  }
  const resolved = /^(https?:\/\/|file:\/\/)/i.test(input)
    ? input
    : (await window.purplewren.resolve(input));
  if (!resolved) return;
  tab.url = resolved;
  tab.view = tab.view || makeView(tab);
  tab.view.loadURL(resolved);
}

function makeView(tab) {
  const v = document.createElement('webview');
  if (PATHS && PATHS.pagePreload) v.setAttribute('preload', PATHS.pagePreload);   // bridge for local pages
  const sesAttr = tab.kind === 'incog' ? 'pw-incog' : tab.kind === 'tor' ? 'pw-tor' : 'persist:pw';
  v.setAttribute('partition', sesAttr);
  v.setAttribute('allowpopups', '');
  v.classList.add('hidden');
  if (/^file:.*(?:newtab|maps|calc|converter)\.html/.test(tab.url || '')) v.classList.add('local-page');
  $('content').appendChild(v);

  v.addEventListener('dom-ready', async () => {
    try {
      const u = v.getURL() || '';
      if (!u.startsWith('file://') && state.settings && state.settings.fpSpoof) {
        const cfg = {
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          locale: 'en-US',
          seed: (Math.random() * 0xffffffff) >>> 0
        };
        await v.executeJavaScript('const cfg=' + JSON.stringify(cfg) + ';' + FINGERPRINT_JS, false);
      }
    } catch (_) {}
  });

  v.addEventListener('page-title-updated', e => {
    tab.title = e.title; renderTabs();
  });
  v.addEventListener('did-navigate', e => {
    tab.url = e.url; renderTabs(); renderOmnibox();
    if (tab.kind === 'normal' && !e.url.startsWith('file://'))
      window.purplewren.record(e.url, tab.title);
  });
  v.addEventListener('did-navigate-in-page', e => {
    if (e.url) { tab.url = e.url; renderOmnibox(); }
  });
  v.addEventListener('page-favicon-updated', e => { tab.favicon = (e.favicons || [])[0]; renderTabs(); });
  return v;
}

function setActive(id) {
  state.activeId = id;
  for (const t of state.tabs) {
    if (t.view) t.view.classList.toggle('hidden', t.id !== id);
  }
  renderTabs(); renderOmnibox();
}

function closeTab(id) {
  const i = state.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const t = state.tabs[i];
  if (t.view) t.view.remove();
  state.tabs.splice(i, 1);
  if (state.tabs.length === 0) { newTab(null); return; }
  if (state.activeId === id) setActive(state.tabs[Math.max(0, i - 1)].id);
  renderTabs();
}

function activeTab() { return state.tabs.find(t => t.id === state.activeId); }

function renderTabs() {
  const el = $('tabs'); el.innerHTML = '';
  for (const t of state.tabs) {
    const d = document.createElement('div');
    d.className = 'tab' + (t.id === state.activeId ? ' active' : '')
      + (t.kind === 'incog' ? ' incog' : '') + (t.kind === 'tor' ? ' tor' : '');
    d.innerHTML = `<span class="tab-badge">${t.kind === 'tor' ? '🧅' : t.kind === 'incog' ? '🕶' : ''}</span>`
      + `<span class="tab-title"></span><button class="tab-close" title="Close">&#10005;</button>`;
    d.querySelector('.tab-title').textContent = t.title;
    d.onclick = () => setActive(t.id);
    d.querySelector('.tab-close').onclick = e => { e.stopPropagation(); closeTab(t.id); };
    el.appendChild(d);
  }
  const t = activeTab();
  $('shield-badge').classList.toggle('on', !!(state.settings && state.settings.fpSpoof));
  $('btn-bookmark').style.color =
    t && state.bookmarks.some(b => b.url === t.url) ? 'var(--accent)' : '';
}

function activeTab() { return state.tabs.find(t => t.id === state.activeId); }

function renderOmnibox() {
  const t = activeTab();
  $('omnibox').value = t && t.url && !t.url.startsWith('file://') ? t.url : '';
}

/* ================= dock ================= */
async function openDock(id) {
  if (state.dock === id) { closeDock(); return; }
  state.dock = id;
  const paths = await ensurePaths();
  $('dock').classList.remove('hidden');
  $('dock-title').textContent = DOCKS[id].title;
  const c = $('dock-content'); c.innerHTML = '';

  if (id === 'lumo' || id === 'hub' || id === 'mail') {
    const v = document.createElement('webview');
    v.setAttribute('partition', 'persist:proton');
    v.setAttribute('allowpopups', '');
    if (PATHS && PATHS.pagePreload) v.setAttribute('preload', PATHS.pagePreload);
    if (id === 'lumo') v.src = (state.settings && state.settings.lumoUrl) || 'https://lumo.proton.me';
    else if (id === 'mail') v.src = 'https://mail.proton.me';
    else {
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:4px;padding:6px;background:var(--bg3);flex-wrap:wrap';
      const apps = { Mail: 'https://mail.proton.me', Docs: 'https://docs.proton.me',
                     Sheets: 'https://sheets.proton.me', Drive: 'https://drive.proton.me',
                     Meet: 'https://meet.proton.me' };
      for (const [name, url] of Object.entries(apps)) {
        const b = document.createElement('button');
        b.className = 'mini-btn'; b.textContent = name;
        b.onclick = () => { v.src = url; };
        bar.appendChild(b);
      }
      c.appendChild(bar);
      v.src = 'https://mail.proton.me';
    }
    c.appendChild(v);
  } else {
    const v = document.createElement('webview');
    v.src = id === 'calc' ? paths.calc : paths.converter;
    v.setAttribute('partition', 'pw-dock');
    v.setAttribute('preload', paths.pagePreload);
    c.appendChild(v);
  }
  document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active-dock'));
  const btnIds = { lumo: 'btn-lumo', calc: 'btn-calc', converter: 'btn-convert', hub: 'btn-hub', mail: 'btn-mail' };
  $(btnIds[id]).classList.add('active-dock');
}
function closeDock() {
  state.dock = null;
  $('dock').classList.add('hidden');
  $('dock-content').innerHTML = '';
  document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active-dock'));
}

/* ================= omnibox & toolbar wiring ================= */
$('omnibox').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const t = activeTab(); if (!t) return;
  const v = e.target.value.trim();
  if (v) { await navigate(t, v); t.view.focus(); }
});

$('btn-back').onclick   = () => { const t = activeTab(); t && t.view && t.view.goBack(); };
$('btn-fwd').onclick    = () => { const t = activeTab(); t && t.view && t.view.goForward(); };
$('btn-reload').onclick = () => { const t = activeTab(); t && t.view && t.view.reload(); };
$('btn-newtab').onclick = () => newTab(null);
$('btn-newtab-tor').onclick = () => newTab(null, 'tor');
$('btn-newtab-incog').onclick = () => newTab(null, 'incog');
$('tb-min').onclick   = () => window.purplewren.win('min');
$('tb-max').onclick   = () => window.purplewren.win('max');
$('tb-close').onclick = () => window.purplewren.win('close');

$('btn-bookmark').onclick = () => {
  const t = activeTab(); if (!t || !t.url || t.url.startsWith('file://')) return;
  window.purplewren.bookmarkToggle({ url: t.url, title: t.title });
};
$('btn-lumo').onclick     = () => openDock('lumo');
$('btn-calc').onclick     = () => openDock('calc');
$('btn-convert').onclick  = () => openDock('converter');
$('btn-hub').onclick      = () => openDock('hub');
$('btn-mail').onclick     = () => openDock('mail');
$('btn-map').onclick      = async () => { const p = await ensurePaths(); newTab(p.maps); };
$('btn-history').onclick  = () => showHistory();
$('btn-settings').onclick = () => showSettings();

$('btn-alias').onclick = () => {
  const t = activeTab();
  $('alias-host').value = t && t.url && !t.url.startsWith('file://') ? hostOf(t.url) : '';
  $('alias-result').classList.add('hidden');
  $('alias-modal').classList.remove('hidden');
  $('alias-host').focus();
};
$('alias-cancel').onclick = () => $('alias-modal').classList.add('hidden');
$('alias-go').onclick = async () => {
  const r = await window.purplewren.aliasCreate($('alias-host').value.trim());
  if (r.error) { alert('Alias failed: ' + r.error); return; }
  $('alias-address').textContent = r.alias;
  $('alias-result').classList.remove('hidden');
};
$('alias-copy').onclick = () => navigator.clipboard.writeText($('alias-address').textContent);
function hostOf(u) { try { return new URL(u).hostname; } catch (_) { return ''; } }

$('btn-vpn').onclick = async () => {
  const ok = await window.purplewren.vpnFind();
  if (!ok) { showSettings(); return; }
  const r = await window.purplewren.vpn('status');
  const on = /connected/i.test(r.out || '');
  const res = await window.purplewren.vpn(on ? 'disconnect' : 'connect');
  $('btn-vpn').style.color = res.ok && !on ? 'var(--ok)' : '';
};

/* history panel */
async function showHistory() {
  const list = await window.purplewren.history();
  const el = $('history-list'); el.innerHTML = '';
  for (const h of list.slice(0, 100)) {
    const d = document.createElement('div');
    d.className = 'history-item';
    d.innerHTML = '<div class="h-title"></div><div class="h-url"></div>';
    d.querySelector('.h-title').textContent = h.title;
    d.querySelector('.h-url').textContent = h.url;
    d.onclick = () => {
      const t = activeTab(); t && navigate(t, h.url);
      $('history-panel').classList.add('hidden');
    };
    el.appendChild(d);
  }
  $('history-panel').classList.remove('hidden');
}
$('history-close').onclick = () => $('history-panel').classList.add('hidden');

/* settings panel */
async function showSettings() {
  const s = await window.purplewren.settingsGet();
  $('set-engine').value = s.searchEngine;
  $('set-fp').checked = s.fpSpoof;
  $('set-strict').checked = s.strictBlock;
  $('set-city').value = s.weatherCity;
  $('set-slkey').value = s.simpleLoginKey;
  refreshVpnStatus();
  $('settings-panel').classList.remove('hidden');
}
$('settings-close').onclick = () => $('settings-panel').classList.add('hidden');
['set-engine','set-fp','set-strict','set-city','set-slkey'].forEach(id =>
  $(id).addEventListener('change', () => window.purplewren.settingsSet({
    searchEngine: $('set-engine').value,
    fpSpoof: $('set-fp').checked,
    strictBlock: $('set-strict').checked,
    weatherCity: $('set-city').value.trim() || 'London',
    simpleLoginKey: $('set-slkey').value.trim()
  })));

async function refreshVpnStatus() {
  const ok = await window.purplewren.vpnFind();
  $('vpn-status').textContent = ok
    ? 'Proton VPN CLI detected.'
    : 'Not installed. Official CLI: protonvpn.com/support/official-linux-vpn (Windows client ships no CLI).';
}
$('vpn-recheck').onclick = refreshVpnStatus;
$('vpn-connect').onclick = async () => { await window.purplewren.vpn('connect'); refreshVpnStatus(); };
$('vpn-disconnect').onclick = async () => { await window.purplewren.vpn('disconnect'); refreshVpnStatus(); };

/* push-events from main */
window.purplewren.onState(s => {
  state.bookmarks = s.bookmarks || [];
  state.settings = s.settings;
  renderTabs();
});
window.purplewren.onMax(m => { $('tb-max').innerHTML = m ? '&#x29c9;' : '&#x25a1;'; });

window.purplewren.onMapsAsk(q => {
  if (state.dock !== 'lumo') openDock('lumo');
  setTimeout(() => {
    $('omnibox').placeholder = 'Ask Lumo: ' + q;
    $('omnibox').focus();
  }, 600);
});

/* keyboard shortcuts */
window.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  const k = e.key.toLowerCase();
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === 't' && e.shiftKey) { stop(); newTab(null, 'incog'); }
  else if (k === 'y' && e.altKey) { stop(); newTab(null, 'tor'); }
  else if (k === 't') { stop(); newTab(null); }
  else if (k === 'w') { stop(); const t = activeTab(); t && closeTab(t.id); }
  else if (k === 'l') { stop(); $('omnibox').focus(); $('omnibox').select(); }
  else if (k === 'd') { stop(); $('btn-bookmark').click(); }
  else if (k === 'h') { stop(); showHistory(); }
  else if (k === 'j') { stop(); openDock('lumo'); }
  else if (k === 'm') { stop(); $('btn-map').click(); }
  else if (k === 'c' && e.shiftKey) { stop(); openDock('calc'); }
  else if (k === 'f' && e.shiftKey) { stop(); openDock('converter'); }
  else if (k === 'p' && e.shiftKey) { stop(); openDock('hub'); }
  else if (k === ',') { stop(); showSettings(); }
});

/* ================= boot ================= */
(async function boot() {
  state.settings = await window.purplewren.settingsGet();
  state.bookmarks = await window.purplewren.bookmarks();
  newTab(null);
})();

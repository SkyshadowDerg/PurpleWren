'use strict';
const { contextBridge, ipcRenderer } = require('electron');

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

contextBridge.exposeInMainWorld('pwpage', {
  weather:   city => ipcRenderer.invoke('pw:weather', city),
  news:      ()    => ipcRenderer.invoke('pw:news'),
  settings:  ()    => ipcRenderer.invoke('pw:settings-get'),
  history:   ()    => ipcRenderer.invoke('pw:history'),
  stats:     ()    => ipcRenderer.invoke('pw:stats'),
  resolve:   input => ipcRenderer.invoke('pw:resolve', input),
  askLumo:   name  => ipcRenderer.send('pw:lumo-ask', name),
  convert:      payload => ipcRenderer.invoke('pw:convert', payload),
  convertSave:  payload => ipcRenderer.invoke('pw:convert-save', payload),
  requestSettings: () => ipcRenderer.send('pw:open-settings-request')
});

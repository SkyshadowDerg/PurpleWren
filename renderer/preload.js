'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('purplewren', {
  win:            cmd => ipcRenderer.send('pw:win', cmd),
  resolve:        input => ipcRenderer.invoke('pw:resolve', input),
  paths:          () => ipcRenderer.invoke('pw:paths'),
  record:         (url, title) => ipcRenderer.send('pw:record', url, title),
  history:        () => ipcRenderer.invoke('pw:history'),
  bookmarks:      () => ipcRenderer.invoke('pw:bookmarks'),
  bookmarkToggle: item => ipcRenderer.send('pw:bookmark-toggle', item),
  settingsGet:    () => ipcRenderer.invoke('pw:settings-get'),
  settingsSet:    patch => ipcRenderer.send('pw:settings-set', patch),
  aliasCreate:    host => ipcRenderer.invoke('pw:alias-create', host),
  vpnFind:        () => ipcRenderer.invoke('pw:vpn-find'),
  vpn:            action => ipcRenderer.invoke('pw:vpn', action),
  openMaps:       () => {},     // maps opens via dock/webview; kept for compat
  onState:    cb => ipcRenderer.on('pw:state', (_e, s) => cb(s)),
  onMax:      cb => ipcRenderer.on('pw:max', (_e, m) => cb(m)),
  onMapsAsk:  cb => ipcRenderer.on('pw:maps-ask', (_e, q) => cb(q))
});

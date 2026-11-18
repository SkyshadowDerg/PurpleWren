'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pwpage', {
  weather:   city => ipcRenderer.invoke('pw:weather', city),
  news:      ()    => ipcRenderer.invoke('pw:news'),
  settings:  ()    => ipcRenderer.invoke('pw:settings-get'),
  history:   ()    => ipcRenderer.invoke('pw:history'),
  stats:     ()    => ipcRenderer.invoke('pw:stats'),
  resolve:   input => ipcRenderer.invoke('pw:resolve', input),
  askLumo:   name  => ipcRenderer.send('pw:lumo-ask', name),
  convert:      payload => ipcRenderer.invoke('pw:convert', payload),
  convertSave:  payload => ipcRenderer.invoke('pw:convert-save', payload)
});

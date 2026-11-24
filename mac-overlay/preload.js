'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  start(payload) {
    ipcRenderer.send('start-overlay', payload);
  },
  onData(callback) {
    ipcRenderer.on('setup-data', (_event, data) => callback(data));
  },
  onError(callback) {
    ipcRenderer.on('setup-error', (_event, message) => callback(message || ''));
  },
});

contextBridge.exposeInMainWorld('desktop', {
  getConfig() {
    return ipcRenderer.invoke('desktop-get-config');
  },
  saveConfig(patch) {
    return ipcRenderer.invoke('desktop-save-config', patch);
  },
  setQr(on) {
    return ipcRenderer.invoke('overlay-qr', on);
  },
  setDanmaku(on) {
    return ipcRenderer.invoke('overlay-danmaku', on);
  },
  saveCsv(payload) {
    return ipcRenderer.invoke('save-csv', payload);
  },
});

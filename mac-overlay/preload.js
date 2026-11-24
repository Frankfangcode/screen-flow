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

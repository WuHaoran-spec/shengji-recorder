'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', Object.freeze({
  listSources: () => ipcRenderer.invoke('shengji:list-sources'),
  selectSource: id => ipcRenderer.invoke('shengji:select-source', id),
}));

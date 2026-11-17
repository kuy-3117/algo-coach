'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('algoCoachDesktop', {
  getApiKeyStatus: () => ipcRenderer.invoke('desktop:get-api-key-status'),
  saveApiKey: (key) => ipcRenderer.invoke('desktop:save-api-key', key),
  clearApiKey: () => ipcRenderer.invoke('desktop:clear-api-key'),
  getDataDirectory: () => ipcRenderer.invoke('desktop:get-data-directory'),
  openDataDirectory: () => ipcRenderer.invoke('desktop:open-data-directory'),
  openExportsDirectory: () => ipcRenderer.invoke('desktop:open-exports-directory'),
});

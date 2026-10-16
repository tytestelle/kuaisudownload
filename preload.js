const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDir: () => ipcRenderer.invoke('select-dir'),
  openDir: (dirPath) => ipcRenderer.invoke('open-dir', dirPath),
  startDownload: (payload) => ipcRenderer.invoke('start-download', payload),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, msg) => cb(msg)),
});

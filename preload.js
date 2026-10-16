
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDir: () => ipcRenderer.invoke('select-dir'),
  startDownload: (payload) => ipcRenderer.invoke('start-download', payload),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, msg) => cb(msg)),
});

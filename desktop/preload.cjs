// Exposes the one thing the page needs from the desktop app: a way to ask
// the main process to check the job boards for an area, with progress updates.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('squareOneDesktop', {
  platform: process.platform,
  refreshJobs(area, previous, onProgress) {
    const listener = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on('jobs:progress', listener);
    return ipcRenderer.invoke('jobs:refresh', area, previous).finally(() => ipcRenderer.removeListener('jobs:progress', listener));
  },
});

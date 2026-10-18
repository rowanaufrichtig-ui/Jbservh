// Exposes the one thing the page needs from the desktop app: a way to ask
// the main process to check the job boards, with progress updates.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('squareOneDesktop', {
  platform: process.platform,
  refreshJobs(previous, onProgress) {
    const listener = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on('jobs:progress', listener);
    return ipcRenderer.invoke('jobs:refresh', previous).finally(() => ipcRenderer.removeListener('jobs:progress', listener));
  },
});

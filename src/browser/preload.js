const { contextBridge, ipcRenderer } = require('electron');

// Toolbar of the built-in browser; the page itself is a separate view with no preload.
contextBridge.exposeInMainWorld('browserHost', {
  go: (input) => ipcRenderer.send('browser:go', input),
  back: () => ipcRenderer.send('browser:back'),
  forward: () => ipcRenderer.send('browser:forward'),
  reload: (hard) => ipcRenderer.send('browser:reload', !!hard),
  devtools: () => ipcRenderer.send('browser:devtools'),
  device: (name) => ipcRenderer.send('browser:device', name),
  screenshot: () => ipcRenderer.invoke('browser:screenshot'),
  external: () => ipcRenderer.send('browser:external'),
  onState: (cb) => ipcRenderer.on('browser:state', (_e, s) => cb(s)),
  onStatus: (cb) => ipcRenderer.on('browser:status', (_e, msg) => cb(msg))
});

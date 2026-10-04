const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdView', {
  onRender: (cb) => ipcRenderer.on('md:render', (_e, doc) => cb(doc)),
  openLink: (href, from) => ipcRenderer.send('md:link', { href, from })
});

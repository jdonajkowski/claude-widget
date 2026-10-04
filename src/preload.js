const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('widget', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  pty: {
    start: (cols, rows) => ipcRenderer.send('pty:start', { cols, rows }),
    write: (data) => ipcRenderer.send('pty:input', data),
    resize: (cols, rows) => ipcRenderer.send('pty:resize', { cols, rows }),
    onData: on('pty:data'),
    onExit: on('pty:exit'),
    onRestart: on('pty:restart')
  },
  win: {
    togglePin: () => ipcRenderer.invoke('win:togglePin'),
    opacity: (delta) => ipcRenderer.invoke('win:opacity', delta),
    minimize: () => ipcRenderer.send('win:minimize'),
    hide: () => ipcRenderer.send('win:hide'),
    close: () => ipcRenderer.send('win:close'),
    progress: (state, value) => ipcRenderer.send('win:progress', { state, value })
  },
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.send('clipboard:write', text)
  },
  openConfig: () => ipcRenderer.send('app:openConfig'),
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url)
});

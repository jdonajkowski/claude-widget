const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// Every PTY, worker and status message carries the session (project) id.
contextBridge.exposeInMainWorld('widget', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  pty: {
    write: (id, data) => ipcRenderer.send('pty:input', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
    restart: (id, cols, rows) => ipcRenderer.send('pty:restart', { id, cols, rows }),
    onData: on('pty:data'),
    onExit: on('pty:exit'),
    onRestartActive: on('pty:restartActive')
  },
  projects: {
    get: () => ipcRenderer.invoke('projects:get'),
    open: (id, cols, rows) => ipcRenderer.invoke('project:open', { id, cols, rows }),
    close: (id) => ipcRenderer.send('session:close', { id }),
    menu: (id) => ipcRenderer.send('project:menu', { id }),
    addMenu: () => ipcRenderer.send('projects:addMenu'),
    onList: on('projects:list'),
    onClosed: on('session:closed'),
    onSelect: on('projects:select')
  },
  rail: {
    toggle: () => ipcRenderer.send('rail:toggle'),
    onState: on('rail:state')
  },
  win: {
    togglePin: () => ipcRenderer.invoke('win:togglePin'),
    opacity: (delta) => ipcRenderer.invoke('win:opacity', delta),
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    toggleFullScreen: () => ipcRenderer.send('win:toggleFullScreen'),
    onZoom: on('win:zoom'),
    hide: () => ipcRenderer.send('win:hide'),
    close: () => ipcRenderer.send('win:close'),
    progress: (state, value) => ipcRenderer.send('win:progress', { state, value })
  },
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.send('clipboard:write', text)
  },
  workers: {
    onEvents: on('workers:events')
  },
  status: {
    onUpdate: on('status:update'),
    onGit: on('git:update')
  },
  md: {
    resolve: (candidates, id) => ipcRenderer.invoke('md:resolve', { candidates, id }),
    open: (file, id) => ipcRenderer.send('md:open', { file, id })
  },
  onToast: on('toast'),
  openConfig: () => ipcRenderer.send('app:openConfig'),
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url)
});

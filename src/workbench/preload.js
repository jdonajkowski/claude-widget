const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (arg) => ipcRenderer.invoke(ch, arg);
const snd = (ch) => (arg) => ipcRenderer.send(ch, arg);
const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, payload) => cb(payload));

// Workbench window: everything goes through the main process (src/workbench-main.js).
contextBridge.exposeInMainWorld('wb', {
  context: inv('wb:context'),
  onTab: on('wb:tab'),
  git: {
    status: inv('wb:git:status'),
    diff: inv('wb:git:diff'),
    stage: inv('wb:git:stage'),
    unstage: inv('wb:git:unstage'),
    discard: inv('wb:git:discard'),
    commit: inv('wb:git:commit'),
    push: inv('wb:git:push'),
    pull: inv('wb:git:pull'),
    suggest: inv('wb:git:suggest'),
    openFile: inv('wb:git:openFile')
  },
  changes: {
    list: inv('wb:changes:list'),
    undo: inv('wb:changes:undo'),
    copy: snd('wb:changes:copy'),
    openDir: snd('wb:changes:openDir'),
    setMode: inv('wb:changes:setMode')
  },
  sys: {
    watch: snd('wb:sys:watch'),
    onSample: on('sys:sample')
  },
  snapshot: {
    create: inv('wb:snapshot:create'),
    openRestore: snd('wb:snapshot:openRestore'),
    tools: inv('wb:snapshot:tools')
  },
  bench: {
    list: inv('wb:bench:list'),
    run: inv('wb:bench:run'),
    baseline: inv('wb:bench:baseline'),
    remove: inv('wb:bench:delete'),
    compare: inv('wb:bench:compare'),
    onProgress: on('bench:progress')
  },
  logs: {
    get: inv('wb:logs:get'),
    ask: inv('wb:logs:ask')
  },
  usage: { get: inv('wb:usage:get') },
  templates: inv('wb:templates'),
  createProject: inv('wb:project:create'),
  templateLatest: inv('wb:template:latest')
});

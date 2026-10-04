const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, shell, clipboard, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const { createSessions } = require('./sessions');
const projects = require('./projects');
const gitStatus = require('./git-status');
const { summarize } = require('./footer');
const files = require('./files');

const isWin = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Settings (stored in %APPDATA%\Claude Widget\config.json)
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  // Shell that hosts Claude Code. On Windows, PowerShell runs `claude` and stays
  // open afterwards, so quitting Claude drops you at a prompt instead of closing.
  shell: isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash',
  shellArgs: isWin ? ['-NoLogo', '-NoExit', '-Command', 'claude'] : ['-lc', 'claude; exec $SHELL'],
  // Command each project's session runs. Unset: the last shellArgs element (which it replaces), else `claude`.
  claudeCommand: '',
  // The rail lists every subfolder of projectsRoot plus pinned extras (projects.json).
  projectsRoot: path.join(os.homedir(), 'Projects'),
  cwd: os.homedir(),
  env: {},
  alwaysOnTop: true,
  opacity: 0.95,
  // Windows 11 22H2+ only: "none" | "acrylic" | "mica" | "tabbed"
  backgroundMaterial: 'none',
  showInTaskbar: false,
  hotkey: 'Control+Alt+Space',
  fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
  fontSize: 13,
  theme: {
    background: '#1f1e1d',
    foreground: '#e8e6e3',
    cursor: '#d97757',
    selectionBackground: '#d9775755'
  }
};

const userDir = app.getPath('userData');
const configPath = path.join(userDir, 'config.json');
const statePath = path.join(userDir, 'window-state.json');
// Pinned extras and hidden projects for the rail, kept apart from the hand-edited config.json.
const projectsPath = path.join(userDir, 'projects.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to write', file, err);
  }
}

function loadConfig() {
  if (!fs.existsSync(configPath)) writeJson(configPath, DEFAULT_CONFIG);
  const user = readJson(configPath, {});
  return { ...DEFAULT_CONFIG, ...user, theme: { ...DEFAULT_CONFIG.theme, ...(user.theme || {}) } };
}

let config = loadConfig();
let state = readJson(statePath, {});

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let win = null;
let tray = null;
const mdWindows = new Map();
let activeId = null;

// One live session per opened project. Each one's worker log (hooks/workers-hook.js) and statusLine
// JSON (hooks/statusline-tee.js) live in sessions/<hash>/, and its PTY env points the hooks there (see README).
const sessions = createSessions({
  pty,
  config,
  userDir,
  home: os.homedir(),
  isWin,
  send,
  onStatus: (id) => { if (id === activeId) pollGit(); }
});

// The project rail adds its width to the window, growing it to the left, so the terminal stays put.
// window-state.json keeps the bounds without the rail.
const RAIL_EXPANDED = 170;
const RAIL_COLLAPSED = 36;
const MIN_WIDTH = 320;
const railWidth = () => (state.railCollapsed ? RAIL_COLLAPSED : RAIL_EXPANDED);
// Rail width when the window was maximized or went full screen, to fix the size on the way back.
let zoomRail = null;

const withRail = (b) => ({ ...b, x: b.x - railWidth(), width: b.width + railWidth() });

// Keep the window on its display: shift it right first, shrink it (the terminal) only as a last resort.
function fitWorkArea(b) {
  const { workArea: wa } = screen.getDisplayMatching(b);
  const out = { ...b };
  if (out.x < wa.x) out.x = wa.x;
  if (out.x + out.width > wa.x + wa.width) out.width = Math.max(MIN_WIDTH + railWidth(), wa.x + wa.width - out.x);
  return out;
}

function applyRail(oldRail) {
  const rail = railWidth();
  win.setMinimumSize(MIN_WIDTH + rail, 180);
  send('rail:state', { collapsed: !!state.railCollapsed, width: rail });
  // Maximized or full screen: the window can't grow, so the terminal takes the difference.
  if (win.isMaximized() || win.isFullScreen()) return;
  const b = win.getBounds();
  const delta = rail - oldRail;
  setBoundsExact(fitWorkArea({ ...b, x: b.x - delta, width: b.width + delta }));
}

// At 125% scaling, setBounds on the frameless window lands a few px larger (+2 wide, +1 tall), and
// repeated rail toggles would add that up. Measure once and set again with the error taken off.
function setBoundsExact(target) {
  win.setBounds(target);
  const got = win.getBounds();
  if (got.x === target.x && got.y === target.y && got.width === target.width && got.height === target.height) return;
  win.setBounds({ x: 2 * target.x - got.x, y: 2 * target.y - got.y, width: 2 * target.width - got.width, height: 2 * target.height - got.height });
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 874;
  const height = 552;
  return { width, height, x: workArea.x + workArea.width - width - 24, y: workArea.y + workArea.height - height - 24 };
}

function boundsAreVisible(b) {
  return screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y);
}

function createWindow() {
  const bounds = fitWorkArea(withRail(state.bounds && boundsAreVisible(state.bounds) ? state.bounds : defaultBounds()));
  const material = isWin && config.backgroundMaterial !== 'none' ? config.backgroundMaterial : undefined;

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH + railWidth(),
    minHeight: 180,
    frame: false,
    show: false,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    alwaysOnTop: state.alwaysOnTop ?? config.alwaysOnTop,
    skipTaskbar: !config.showInTaskbar,
    backgroundColor: material ? '#00000000' : config.theme.background,
    backgroundMaterial: material,
    roundedCorners: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    title: 'Claude Widget',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.setOpacity(clampOpacity(state.opacity ?? config.opacity));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Maximize only after showing at the normal bounds: maximizing a hidden frameless window
  // makes Windows restore it a few pixels off.
  win.once('ready-to-show', () => {
    win.show();
    setBoundsExact(bounds);
    if (state.maximized) win.maximize();
  });

  const saveState = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    // Keep the normal bounds while maximized or full screen, so leaving either returns to them.
    const zoomed = win.isMaximized() || win.isFullScreen();
    if (!zoomed) {
      const b = win.getBounds();
      state.bounds = { ...b, x: b.x + railWidth(), width: b.width - railWidth() };
    }
    if (!win.isFullScreen()) state.maximized = win.isMaximized();
    writeJson(statePath, state);
  };
  win.on('moved', saveState);
  win.on('resized', saveState);
  win.on('close', saveState);
  win.on('closed', () => { win = null; });
  win.on('focus', scanProjects);
  const sendZoom = () => send('win:zoom', { maximized: win.isMaximized(), fullScreen: win.isFullScreen() });
  win.webContents.on('did-finish-load', sendZoom);
  for (const ev of ['maximize', 'enter-full-screen']) win.on(ev, () => { if (zoomRail === null) zoomRail = railWidth(); });
  // These events fire before Windows finishes the transition (and in bursts), so read the state once it settles.
  let zoomTimer;
  const onZoomChange = () => {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      sendZoom();
      // The rail changed while zoomed: Windows restored the old outer size, so apply the saved bounds plus today's rail.
      if (!win.isMaximized() && !win.isFullScreen() && zoomRail !== null) {
        if (zoomRail !== railWidth() && state.bounds) setBoundsExact(fitWorkArea(withRail(state.bounds)));
        zoomRail = null;
      }
      // Only the flag: bounds read mid-transition can be off, so they are saved on user moves/resizes only.
      if (!win.isFullScreen()) state.maximized = win.isMaximized();
      writeJson(statePath, state);
    }, 150);
  };
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, onZoomChange);

  // Open links (Claude's login URL, docs links) in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function clampOpacity(v) {
  return Math.min(1, Math.max(0.3, Number(v) || 1));
}

function toggleWindow() {
  if (!win) return createWindow();
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// Projects: subfolders of projectsRoot plus pinned extras, minus hidden ones
// ---------------------------------------------------------------------------
let saved = loadSaved();
let projectList = [];
let rootWarned = false;
let rootWatcher = null;

function loadSaved() {
  const raw = readJson(projectsPath, {});
  const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []);
  return { pinned: strs(raw.pinned), hidden: strs(raw.hidden) };
}

function projectsRoot() {
  return config.projectsRoot || path.join(os.homedir(), 'Projects');
}

function scanRoot() {
  const root = projectsRoot();
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => path.join(root, d.name));
  } catch {
    if (!rootWarned) {
      rootWarned = true;
      send('toast', `Projects folder not found: ${root}`);
    }
    return null;
  }
}

function scanProjects() {
  const scanned = scanRoot();
  const list = projects.buildList({ scanned: scanned || [], pinned: saved.pinned, hidden: saved.hidden, exists: (p) => fs.existsSync(p), isWin });
  // A running session keeps its row even if its folder disappeared or was hidden, until it is closed.
  const known = new Set(list.map((p) => p.id));
  for (const id of sessions.ids()) {
    if (known.has(id)) continue;
    const cwd = sessions.cwd(id);
    const name = path.basename(cwd) || cwd;
    list.push({ id, path: cwd, name, initials: projects.initials(name), pinned: false, missing: !fs.existsSync(cwd), orphan: true });
  }
  list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  projectList = list;
  sendProjects();
  if (scanned && !rootWatcher) watchRoot();
}

function sendProjects() {
  send('projects:list', { list: projectList, open: sessions.ids(), active: activeId });
}

function watchRoot() {
  let timer;
  try {
    rootWatcher = fs.watch(projectsRoot(), { persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(scanProjects, 300);
    });
    rootWatcher.on('error', () => { rootWatcher.close(); rootWatcher = null; });
  } catch {
    rootWatcher = null;
  }
}

function saveProjects() {
  writeJson(projectsPath, saved);
  scanProjects();
}

// Launch: activeProject from window state, else config.cwd if it is a project, else the first project.
function initialActive() {
  const usable = (id) => projectList.find((p) => p.id === id && !p.missing);
  const hit = (state.activeProject && usable(state.activeProject)) || usable(projects.normId(config.cwd, isWin)) || projectList.find((p) => !p.missing);
  return hit ? hit.id : null;
}

ipcMain.handle('projects:get', () => {
  scanProjects();
  return { list: projectList, open: sessions.ids(), active: initialActive() };
});

// Makes a project active, starting its session the first time. Returns false for a missing folder.
ipcMain.handle('project:open', (_e, { id, cols, rows }) => {
  if (!sessions.has(id)) {
    const p = projectList.find((x) => x.id === id);
    if (!p || p.missing || !fs.existsSync(p.path)) return false;
    sessions.open(id, p.path, cols, rows);
  }
  if (activeId !== id) {
    activeId = id;
    state.activeProject = id;
    writeJson(statePath, state);
    lastGit = undefined;
    pollGit();
  }
  sendProjects();
  return true;
});

function closeSession(id) {
  if (!sessions.close(id)) return;
  send('session:closed', { id });
  scanProjects();
}

ipcMain.on('pty:input', (_e, { id, data }) => sessions.write(id, data));
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => sessions.resize(id, cols, rows));
ipcMain.on('pty:restart', (_e, { id, cols, rows }) => sessions.restart(id, cols, rows));
ipcMain.on('session:close', (_e, { id }) => closeSession(id));

// Row context menu: Close session, Open in Explorer, then Hide (scanned) or Unpin (pinned extras).
ipcMain.on('project:menu', (_e, { id }) => {
  const p = projectList.find((x) => x.id === id);
  if (!p || !win) return;
  const items = [];
  if (sessions.has(id)) items.push({ label: 'Close session', click: () => closeSession(id) }, { type: 'separator' });
  items.push({ label: 'Open in Explorer', enabled: !p.missing, click: () => shell.openPath(p.path) });
  if (p.pinned) {
    items.push({ label: 'Unpin', click: () => { saved.pinned = saved.pinned.filter((x) => projects.normId(x, isWin) !== id); saveProjects(); } });
  } else if (!p.orphan) {
    items.push({ label: 'Hide', click: () => { saved.hidden.push(id); saveProjects(); } });
  }
  Menu.buildFromTemplate(items).popup({ window: win });
});

// The + button: Add folder… (pinned) and Show hidden (n), which un-hides one project.
ipcMain.on('projects:addMenu', () => {
  if (!win) return;
  const hidden = saved.hidden;
  Menu.buildFromTemplate([
    { label: 'Add folder…', click: addFolder },
    {
      label: `Show hidden (${hidden.length})`,
      enabled: hidden.length > 0,
      submenu: hidden.map((h) => ({ label: h, click: () => { saved.hidden = saved.hidden.filter((x) => x !== h); saveProjects(); } }))
    }
  ]).popup({ window: win });
});

async function addFolder() {
  const r = await dialog.showOpenDialog(win, { title: 'Add project folder', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  const dir = r.filePaths[0];
  const id = projects.normId(dir, isWin);
  saved.hidden = saved.hidden.filter((x) => projects.normId(x, isWin) !== id);
  if (!saved.pinned.some((x) => projects.normId(x, isWin) === id)) saved.pinned.push(dir);
  saveProjects();
  send('projects:select', { id });
}

ipcMain.on('rail:toggle', () => {
  if (!win) return;
  const old = railWidth();
  state.railCollapsed = !state.railCollapsed;
  writeJson(statePath, state);
  applyRail(old);
});

// ---------------------------------------------------------------------------
// Footer: statusLine JSON per session, git status of the active session's folder
// ---------------------------------------------------------------------------
let gitBusy = false;
let lastGit;

// The session's current folder (from its status JSON), else the folder it started in.
function baseCwd(id = activeId) {
  const status = id ? summarize(sessions.status(id)) : null;
  return (status && status.cwd) || (id && sessions.cwd(id)) || (fs.existsSync(config.cwd) ? config.cwd : os.homedir());
}

async function pollGit() {
  if (gitBusy || !activeId || !win || win.isDestroyed() || !win.isVisible()) return;
  gitBusy = true;
  const id = activeId;
  const info = await gitStatus.read(baseCwd(id));
  gitBusy = false;
  if (id !== activeId) return pollGit(); // switched while reading
  const json = JSON.stringify(info);
  if (json !== lastGit) { lastGit = json; send('git:update', { id, info }); }
}

const statusTimer = setInterval(() => sessions.pollStatus(), 500);
const gitTimer = setInterval(pollGit, 3000);

// ---------------------------------------------------------------------------
// Markdown popouts: .md paths clicked in the terminal open rendered in their own window
// ---------------------------------------------------------------------------
const MD_EXT = /\.(md|markdown)$/i;

function resolveMd(p, from) {
  let file = String(p).trim();
  if (/^file:\/\//i.test(file)) {
    try { file = require('url').fileURLToPath(file); } catch { return null; }
  }
  if (file.startsWith('~')) file = path.join(os.homedir(), file.slice(1));
  file = path.resolve(from, file);
  if (!MD_EXT.test(file)) return null;
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

function renderMd(file) {
  const { marked } = require('marked');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return { file, error: err.message }; }
  // YAML front matter is metadata, not content.
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  return { file, dir: path.dirname(file), html: marked.parse(text, { gfm: true }) };
}

function openMd(file) {
  const key = file.toLowerCase();
  const existing = mdWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  const md = new BrowserWindow({
    width: 760,
    height: 860,
    title: path.basename(file),
    backgroundColor: config.theme.background,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'md', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  md.setMenu(null);
  mdWindows.set(key, md);
  const push = () => !md.isDestroyed() && md.webContents.send('md:render', renderMd(file));
  md.webContents.on('did-finish-load', push);
  // Re-render when the file changes on disk, e.g. while Claude is still editing it.
  const onChange = (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) push(); };
  fs.watchFile(file, { interval: 500 }, onChange);
  md.on('closed', () => {
    fs.unwatchFile(file, onChange);
    if (mdWindows.get(key) === md) mdWindows.delete(key);
  });
  md.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  md.webContents.on('will-navigate', (e) => e.preventDefault());
  md.loadFile(path.join(__dirname, 'md', 'md.html'));
}

// Markdown files of a project, for paths Claude prints relative to a subfolder or as a bare name.
// Cached briefly: the link provider asks once per hovered row.
const mdIndex = new Map();
function projectMdFiles(root) {
  const hit = mdIndex.get(root);
  if (hit && Date.now() - hit.at < 5000) return hit.files;
  const entry = { at: Date.now(), files: files.mdFiles(root) };
  mdIndex.set(root, entry);
  return entry.files;
}

// A printed path as-is (relative to the session's folder), else the project file it is the tail of.
function findMd(p, id) {
  const from = baseCwd(id);
  const direct = resolveMd(p, from);
  if (direct) return direct;
  const root = projectPath(id);
  if (!root) return null;
  const rel = files.findByTail(projectMdFiles(root), p, isWin);
  return rel ? resolveMd(rel, root) : null;
}

// Candidates come from md-links.js, longest first; the first one that is an existing file wins.
ipcMain.handle('md:resolve', (_e, { candidates, id }) => {
  if (!Array.isArray(candidates)) return null;
  for (let i = 0; i < candidates.length && i < 16; i++) {
    const file = findMd(candidates[i], id);
    if (file) return { index: i, file };
  }
  return null;
});
ipcMain.on('md:open', (_e, { file: p, id }) => {
  const file = findMd(p, id);
  if (file) openMd(file);
});
// Links inside a popout: web links go to the browser, other Markdown files open in their own popout.
ipcMain.on('md:link', (_e, { href, from }) => {
  if (/^https?:\/\//i.test(href)) return shell.openExternal(href);
  let target;
  try { target = decodeURIComponent(String(href).split('#')[0]); } catch { return; }
  const file = target && resolveMd(target, path.dirname(String(from)));
  if (file) openMd(file);
});

// ---------------------------------------------------------------------------
// Files pane: browse the active project's folder
// ---------------------------------------------------------------------------
function projectPath(id) {
  if (!id) return null;
  const p = projectList.find((x) => x.id === id);
  return (p && !p.missing && p.path) || (sessions.has(id) ? sessions.cwd(id) : null);
}

ipcMain.on('files:setOpen', (_e, open) => {
  state.filesOpen = !!open;
  writeJson(statePath, state);
});

ipcMain.handle('files:list', (_e, { id, rel }) => {
  const root = projectPath(id);
  if (!root) return null;
  return { root, entries: files.listDir(root, rel) };
});

function fileTarget(id, rel) {
  const root = projectPath(id);
  return root ? files.safeJoin(root, rel) : null;
}

// Click: Markdown opens in the viewer, runnable files are shown in Explorer, the rest open in their default app.
ipcMain.on('files:open', (_e, { id, rel }) => {
  const file = fileTarget(id, rel);
  if (!file || !fs.existsSync(file)) return;
  const action = files.openAction(file);
  if (action === 'md') openMd(file);
  else if (action === 'reveal') shell.showItemInFolder(file);
  else shell.openPath(file);
});

ipcMain.on('files:menu', (_e, { id, rel, dir }) => {
  const file = fileTarget(id, rel);
  if (!file || !win) return;
  const items = [];
  if (!dir && files.openAction(file) === 'md') items.push({ label: 'Open in viewer', click: () => openMd(file) });
  if (!dir && files.openAction(file) === 'open') items.push({ label: 'Open', click: () => shell.openPath(file) });
  if (dir) items.push({ label: 'Open in Explorer', click: () => shell.openPath(file) });
  else items.push({ label: 'Show in Explorer', click: () => shell.showItemInFolder(file) });
  items.push(
    { type: 'separator' },
    { label: 'Copy path', click: () => clipboard.writeText(file) },
    { label: 'Copy relative path', click: () => clipboard.writeText(String(rel).replace(/\//g, path.sep)) }
  );
  Menu.buildFromTemplate(items).popup({ window: win });
});

// ---------------------------------------------------------------------------
// Window controls from the renderer
// ---------------------------------------------------------------------------
ipcMain.handle('config:get', () => ({
  fontFamily: config.fontFamily,
  fontSize: config.fontSize,
  theme: config.theme,
  transparent: isWin && config.backgroundMaterial !== 'none',
  alwaysOnTop: win ? win.isAlwaysOnTop() : config.alwaysOnTop,
  opacity: win ? win.getOpacity() : config.opacity,
  rail: { collapsed: !!state.railCollapsed, width: railWidth() },
  filesOpen: !!state.filesOpen
}));
ipcMain.handle('win:togglePin', () => {
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'floating');
  state.alwaysOnTop = next;
  writeJson(statePath, state);
  return next;
});
ipcMain.handle('win:opacity', (_e, delta) => {
  const next = clampOpacity(Math.round((win.getOpacity() + delta) * 100) / 100);
  win.setOpacity(next);
  state.opacity = next;
  writeJson(statePath, state);
  return next;
});
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:toggleMaximize', () => {
  if (!win) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  else if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('win:toggleFullScreen', () => win && win.setFullScreen(!win.isFullScreen()));
ipcMain.on('win:hide', () => win && win.hide());
ipcMain.on('win:close', () => app.quit());
// OSC 9;4 states: 0 clear, 1 normal, 2 error, 3 indeterminate, 4 paused.
ipcMain.on('win:progress', (_e, { state, value }) => {
  if (!win || win.isDestroyed()) return;
  const mode = { 1: 'normal', 2: 'error', 3: 'indeterminate', 4: 'paused' }[state];
  if (!mode) return win.setProgressBar(-1);
  win.setProgressBar(state === 3 ? 2 : Math.min(100, Math.max(0, value)) / 100, { mode });
});
ipcMain.on('app:openConfig', () => shell.openPath(configPath));
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
ipcMain.on('shell:openExternal', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

// ---------------------------------------------------------------------------
// Tray + lifecycle
// ---------------------------------------------------------------------------
function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', isWin ? 'icon.ico' : 'icon.png'));
  tray.setToolTip('Claude Widget');
  tray.on('click', toggleWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide', click: toggleWindow },
    { label: 'Restart Claude session', click: () => send('pty:restartActive') },
    { label: 'Edit settings…', click: () => shell.openPath(configPath) },
    { label: 'Reset window position', click: () => win && setBoundsExact(fitWorkArea(withRail(defaultBounds()))) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return createWindow();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    if (config.hotkey && !globalShortcut.register(config.hotkey, toggleWindow)) {
      console.warn(`Could not register hotkey ${config.hotkey}`);
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    sessions.closeAll();
    if (rootWatcher) rootWatcher.close();
    clearInterval(statusTimer);
    clearInterval(gitTimer);
  });

  // The tray keeps the app alive when the window is hidden; closing the
  // widget with the X button quits explicitly via win:close.
  app.on('window-all-closed', () => app.quit());
  // Quitting from the widget also closes any open Markdown popouts.
  app.on('before-quit', () => { for (const md of mdWindows.values()) if (!md.isDestroyed()) md.destroy(); });
}

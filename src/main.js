const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, shell, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const { createLogTail } = require('./log-tail');
const gitStatus = require('./git-status');
const { summarize } = require('./footer');

const isWin = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Settings (stored in %APPDATA%\Claude Widget\config.json)
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  // Shell that hosts Claude Code. On Windows, PowerShell runs `claude` and stays
  // open afterwards, so quitting Claude drops you at a prompt instead of closing.
  shell: isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash',
  shellArgs: isWin ? ['-NoLogo', '-NoExit', '-Command', 'claude'] : ['-lc', 'claude; exec $SHELL'],
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
// Hook event log for the worker rows (written by hooks/workers-hook.js, see README).
const workersLogPath = path.join(userDir, 'workers.jsonl');
// Latest statusLine JSON for the footer (written by hooks/statusline-tee.js, see README).
const statusPath = path.join(userDir, 'status.json');

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
let term = null;
const workersTail = createLogTail(workersLogPath, (events) => send('workers:events', events));
const mdWindows = new Map();

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
  const bounds = state.bounds && boundsAreVisible(state.bounds) ? state.bounds : defaultBounds();
  const material = isWin && config.backgroundMaterial !== 'none' ? config.backgroundMaterial : undefined;

  win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 180,
    frame: false,
    show: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
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
  win.once('ready-to-show', () => win.show());

  const saveState = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    state.bounds = win.getBounds();
    writeJson(statePath, state);
  };
  win.on('moved', saveState);
  win.on('resized', saveState);
  win.on('close', saveState);
  win.on('closed', () => { win = null; });

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

// ---------------------------------------------------------------------------
// PTY
// ---------------------------------------------------------------------------
function spawnTerminal(cols, rows) {
  killTerminal();
  workersTail.reset();
  resetStatus();
  const cwd = fs.existsSync(config.cwd) ? config.cwd : os.homedir();
  try {
    term = pty.spawn(config.shell, config.shellArgs, {
      name: 'xterm-256color',
      cols: cols || 100,
      rows: rows || 30,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...config.env, CLAUDE_WIDGET_WORKERS: workersLogPath, CLAUDE_WIDGET_STATUS: statusPath },
      useConpty: isWin ? true : undefined
    });
  } catch (err) {
    send('pty:data', `\r\n\x1b[31mFailed to start ${config.shell}: ${err.message}\x1b[0m\r\n`);
    return;
  }
  const current = term;
  current.onData((data) => send('pty:data', data));
  current.onExit(({ exitCode }) => {
    if (term !== current) return; // replaced by a restart
    term = null;
    send('pty:exit', exitCode);
  });
}

function killTerminal() {
  if (!term) return;
  const old = term;
  term = null;
  try { old.kill(); } catch { /* already gone */ }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

ipcMain.on('pty:start', (_e, { cols, rows }) => spawnTerminal(cols, rows));
ipcMain.on('pty:input', (_e, data) => term && term.write(data));
ipcMain.on('pty:resize', (_e, { cols, rows }) => {
  if (term && cols > 0 && rows > 0) {
    try { term.resize(cols, rows); } catch { /* pty exited */ }
  }
});

// ---------------------------------------------------------------------------
// Footer: statusLine JSON and git status of the session's folder
// ---------------------------------------------------------------------------
let statusMtime = 0;
let sessionCwd = null; // the session's current folder, from the status JSON
let gitBusy = false;
let lastGit;

function pollStatus() {
  let mtime;
  try { mtime = fs.statSync(statusPath).mtimeMs; } catch { return; }
  if (mtime === statusMtime) return;
  const status = readJson(statusPath, null);
  if (!status) return; // mid-write: try again next poll
  statusMtime = mtime;
  send('status:update', status);
  const cwd = (summarize(status) || {}).cwd;
  if (cwd && cwd !== sessionCwd) {
    sessionCwd = cwd;
    pollGit();
  }
}

function resetStatus() {
  try { fs.rmSync(statusPath, { force: true }); } catch { /* stays stale until the next update */ }
  statusMtime = 0;
  sessionCwd = null;
  lastGit = undefined;
  send('status:update', null);
  send('git:update', null);
}

function baseCwd() {
  return sessionCwd || (fs.existsSync(config.cwd) ? config.cwd : os.homedir());
}

async function pollGit() {
  if (gitBusy || !win || win.isDestroyed() || !win.isVisible()) return;
  gitBusy = true;
  const info = await gitStatus.read(baseCwd());
  gitBusy = false;
  const json = JSON.stringify(info);
  if (json !== lastGit) { lastGit = json; send('git:update', info); }
}

const statusTimer = setInterval(pollStatus, 500);
const gitTimer = setInterval(pollGit, 3000);

// ---------------------------------------------------------------------------
// Markdown popouts: .md paths clicked in the terminal open rendered in their own window
// ---------------------------------------------------------------------------
const MD_EXT = /\.(md|markdown)$/i;

function resolveMd(p, from = baseCwd()) {
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

// Candidates come from md-links.js, longest first; the first one that is an existing file wins.
ipcMain.handle('md:resolve', (_e, candidates) => {
  if (!Array.isArray(candidates)) return null;
  for (let i = 0; i < candidates.length && i < 16; i++) {
    const file = resolveMd(candidates[i]);
    if (file) return { index: i, file };
  }
  return null;
});
ipcMain.on('md:open', (_e, p) => {
  const file = resolveMd(p);
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
// Window controls from the renderer
// ---------------------------------------------------------------------------
ipcMain.handle('config:get', () => ({
  fontFamily: config.fontFamily,
  fontSize: config.fontSize,
  theme: config.theme,
  transparent: isWin && config.backgroundMaterial !== 'none',
  alwaysOnTop: win ? win.isAlwaysOnTop() : config.alwaysOnTop,
  opacity: win ? win.getOpacity() : config.opacity
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
    { label: 'Restart Claude session', click: () => send('pty:restart') },
    { label: 'Edit settings…', click: () => shell.openPath(configPath) },
    { label: 'Reset window position', click: () => win && win.setBounds(defaultBounds()) },
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
    killTerminal();
    workersTail.close();
    clearInterval(statusTimer);
    clearInterval(gitTimer);
  });

  // The tray keeps the app alive when the window is hidden; closing the
  // widget with the X button quits explicitly via win:close.
  app.on('window-all-closed', () => app.quit());
  // Quitting from the widget also closes any open Markdown popouts.
  app.on('before-quit', () => { for (const md of mdWindows.values()) if (!md.isDestroyed()) md.destroy(); });
}

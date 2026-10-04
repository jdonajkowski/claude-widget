// Built-in browser: one window with a toolbar page (src/browser) and the web page in a WebContentsView
// below it. Pages get their own session with no permissions, no Node and no preload. Local files reload
// when anything in their folder changes, so mockups update while Claude edits them.
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { BrowserWindow, WebContentsView, session, shell, dialog, app } = require('electron');
const { toUrl } = require('./browser-url');

const BAR_HEIGHT = 40; // matches #bar in browser.css
const DEVICES = { full: 0, desktop: 1440, laptop: 1280, tablet: 768, mobile: 390 };
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

function createBrowser({ background, icon, projectDir = () => null, isWin }) {
  let win = null;
  let view = null;
  let device = 'full';
  let watcher = null;
  let reloadTimer;

  function pageSession() {
    const ses = session.fromPartition('persist:widget-browser');
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(ALLOWED_PERMISSIONS.has(perm)));
    ses.setPermissionCheckHandler((_wc, perm) => ALLOWED_PERMISSIONS.has(perm));
    return ses;
  }

  const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

  function sendState() {
    if (!view) return;
    const wc = view.webContents;
    send('browser:state', {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
      device
    });
  }

  // Narrow devices are centered, with the window background around them.
  function layout() {
    if (!win || !view) return;
    const [w, h] = win.getContentSize();
    const width = DEVICES[device] ? Math.min(DEVICES[device], w) : w;
    view.setBounds({ x: Math.floor((w - width) / 2), y: BAR_HEIGHT, width, height: Math.max(0, h - BAR_HEIGHT) });
  }

  function watchLocal(url) {
    if (watcher) { watcher.close(); watcher = null; }
    if (!/^file:/i.test(url)) return;
    let dir;
    try { dir = path.dirname(fileURLToPath(url)); } catch { return; }
    try {
      watcher = fs.watch(dir, { persistent: false }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => view && view.webContents.reloadIgnoringCache(), 250);
      });
      watcher.on('error', () => { watcher = null; });
    } catch {
      watcher = null;
    }
  }

  function create() {
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: 'Browser',
      backgroundColor: '#2a2927',
      autoHideMenuBar: true,
      icon,
      webPreferences: {
        preload: path.join(__dirname, 'browser', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    view = new WebContentsView({
      webPreferences: { session: pageSession(), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    view.setBackgroundColor(background || '#ffffff');
    win.contentView.addChildView(view);
    const wc = view.webContents;

    // Pages may only go to http, https and file URLs; popups load in the same view.
    wc.setWindowOpenHandler(({ url }) => {
      const u = toUrl(url);
      if (u) wc.loadURL(u);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => { if (!toUrl(url)) e.preventDefault(); });
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) wc.on(ev, sendState);
    wc.on('did-navigate', (_e, url) => watchLocal(url));
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain && code !== -3) send('browser:status', `Could not load ${url}: ${desc}`); // -3: aborted by a new navigation
    });
    wc.on('page-title-updated', (_e, title) => win && !win.isDestroyed() && win.setTitle(`${title} — Browser`));
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const k = input.key.toLowerCase();
      if (k === 'f5' || (input.control && k === 'r')) { e.preventDefault(); input.shift ? wc.reloadIgnoringCache() : wc.reload(); }
      else if (k === 'f12') { e.preventDefault(); toggleDevTools(); }
      else if (input.control && k === 'l') { e.preventDefault(); win.webContents.focus(); win.webContents.executeJavaScript("document.getElementById('url').focus()"); }
      else if (input.alt && k === 'arrowleft') { e.preventDefault(); wc.navigationHistory.goBack(); }
      else if (input.alt && k === 'arrowright') { e.preventDefault(); wc.navigationHistory.goForward(); }
    });

    win.on('resize', layout);
    win.webContents.on('did-finish-load', sendState);
    win.on('closed', () => {
      if (watcher) watcher.close();
      watcher = null;
      clearTimeout(reloadTimer);
      if (view && !view.webContents.isDestroyed()) view.webContents.close();
      view = null;
      win = null;
    });
    layout();
    return win.loadFile(path.join(__dirname, 'browser', 'browser.html'));
  }

  function toggleDevTools() {
    const wc = view && view.webContents;
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  async function open(input) {
    if (!win || win.isDestroyed()) await create();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (!input) {
      win.webContents.focus();
      win.webContents.executeJavaScript("document.getElementById('url').focus()").catch(() => {});
      return;
    }
    go(input);
  }

  function go(input) {
    const url = toUrl(input, { home: app.getPath('home'), isWin });
    if (!url) return send('browser:status', `Can't open "${input}". Use an http(s) URL, localhost:port or a file path.`);
    view.webContents.loadURL(url).catch(() => {}); // failures are reported by did-fail-load
    view.webContents.focus();
  }

  // Saved next to the active project by default, so Claude can look at it too.
  async function screenshot() {
    if (!view) return { error: 'No page' };
    const image = await view.webContents.capturePage();
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const dir = projectDir() || app.getPath('pictures');
    const r = await dialog.showSaveDialog(win, {
      title: 'Save screenshot',
      defaultPath: path.join(dir, `screenshot-${stamp}.png`),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    });
    if (r.canceled || !r.filePath) return {};
    try {
      fs.writeFileSync(r.filePath, image.toPNG());
      return { file: r.filePath };
    } catch (err) {
      return { error: err.message };
    }
  }

  // IPC from the toolbar; each handler ignores calls from any other window.
  const fromToolbar = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
  function handle(ipcMain) {
    ipcMain.on('browser:go', (e, input) => { if (fromToolbar(e)) go(input); });
    ipcMain.on('browser:back', (e) => { if (fromToolbar(e)) view.webContents.navigationHistory.goBack(); });
    ipcMain.on('browser:forward', (e) => { if (fromToolbar(e)) view.webContents.navigationHistory.goForward(); });
    ipcMain.on('browser:reload', (e, hard) => { if (fromToolbar(e)) (hard ? view.webContents.reloadIgnoringCache() : view.webContents.reload()); });
    ipcMain.on('browser:devtools', (e) => { if (fromToolbar(e)) toggleDevTools(); });
    ipcMain.on('browser:device', (e, name) => {
      if (!fromToolbar(e) || !(name in DEVICES)) return;
      device = name;
      layout();
      sendState();
    });
    ipcMain.handle('browser:screenshot', (e) => (fromToolbar(e) ? screenshot() : null));
    ipcMain.on('browser:external', (e) => {
      if (!fromToolbar(e)) return;
      const url = view.webContents.getURL();
      if (/^https?:/i.test(url)) shell.openExternal(url);
      else if (/^file:/i.test(url)) shell.openPath(fileURLToPath(url));
    });
  }

  return {
    open,
    handle,
    close: () => { if (win && !win.isDestroyed()) win.destroy(); }
  };
}

module.exports = { createBrowser };

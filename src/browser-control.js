// Lets Claude drive the built-in browser's page from a session: `widget-browser <command>` (bin/) talks to
// this HTTP endpoint on 127.0.0.1, which runs Chrome DevTools Protocol commands on the browser page only
// (webContents.debugger), never on the widget's own windows. Every request needs the per-run token that
// widget sessions get in CLAUDE_WIDGET_BROWSER_TOKEN; requests from web pages (Origin header) are refused.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// CDP domains `widget-browser cdp` may use: the page's own. Target, Browser and the like could reach
// other targets (the widget's windows), so they are refused.
const CDP_DOMAINS = new Set(['Accessibility', 'Animation', 'Audits', 'CacheStorage', 'CSS', 'Debugger', 'DOM', 'DOMDebugger',
  'DOMSnapshot', 'DOMStorage', 'Emulation', 'Fetch', 'HeapProfiler', 'IndexedDB', 'Input', 'LayerTree', 'Log', 'Network',
  'Overlay', 'Page', 'Performance', 'PerformanceTimeline', 'Profiler', 'Runtime', 'Security', 'Storage', 'WebAudio']);
const cdpAllowed = (method) => typeof method === 'string' && CDP_DOMAINS.has(method.split('.')[0]) && /^\w+\.\w+$/.test(method);

const MAX_BODY = 4 * 1024 * 1024;
const MAX_TEXT = 60000;
const LOG_KEEP = 300;

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Whether a request may run: right token, aimed at the loopback host (no DNS rebinding), not from a web page.
function authorized(req, token) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (host !== '127.0.0.1' && host !== 'localhost') return false;
  if (req.headers.origin) return false;
  const auth = String(req.headers.authorization || '');
  return auth.startsWith('Bearer ') && sameToken(auth.slice(7), token);
}

const clip = (s, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);

// The console and network entries of the page, kept from the moment it was created.
function createPageLog() {
  const consoleLog = [];
  const network = new Map();
  const push = (list, item) => { list.push(item); if (list.length > LOG_KEEP) list.shift(); };
  return {
    console: consoleLog,
    network,
    // Uncaught errors arrive here too ("Uncaught Error: ..."). Electron's own development warning is left out.
    onConsole: (level, message, source) => {
      if (/^%cElectron Security Warning/.test(message)) return;
      push(consoleLog, { level, message, source, at: Date.now() });
    },
    onCdp: (method, p) => {
      if (method === 'Network.requestWillBeSent') {
        network.set(p.requestId, { id: p.requestId, method: p.request.method, url: p.request.url, type: p.type, at: Date.now() });
        if (network.size > LOG_KEEP) network.delete(network.keys().next().value);
      } else if (method === 'Network.responseReceived' && network.has(p.requestId)) {
        Object.assign(network.get(p.requestId), { status: p.response.status, mime: p.response.mimeType });
      } else if (method === 'Network.loadingFailed' && network.has(p.requestId)) {
        Object.assign(network.get(p.requestId), { failed: p.errorText || 'failed' });
      }
    },
    clear: () => { consoleLog.length = 0; network.clear(); }
  };
}

const LEVELS = { 0: 'debug', 1: 'info', 2: 'warning', 3: 'error' };

// browser: src/browser-window.js. shotsDir: where screenshots go unless --out says otherwise.
function createControl({ browser, token = crypto.randomBytes(24).toString('hex'), shotsDir = path.join(os.tmpdir(), 'claude-widget', 'screenshots') }) {
  let log = createPageLog();
  let attachedTo = null;

  // Attaches the debugger to the current page (once per page) and starts the console/network log.
  browser.onPage((wc) => {
    log = createPageLog();
    attachedTo = null;
    wc.on('console-message', (e) => log.onConsole(e.level || LEVELS[e.level] || 'info', e.message, e.sourceId ? `${e.sourceId}:${e.lineNumber}` : ''));
    ensureDebugger(wc).catch(() => {});
  });

  async function ensureDebugger(wc) {
    if (attachedTo === wc && wc.debugger.isAttached()) return;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    attachedTo = wc;
    wc.debugger.on('message', (_e, method, params) => log.onCdp(method, params || {}));
    wc.debugger.on('detach', () => { if (attachedTo === wc) attachedTo = null; });
    await wc.debugger.sendCommand('Runtime.enable');
    await wc.debugger.sendCommand('Network.enable');
    await wc.debugger.sendCommand('Page.enable');
  }

  async function page({ open = true } = {}) {
    let wc = browser.page();
    if (!wc && open) { await browser.load(null, { focus: false }); wc = browser.page(); }
    if (!wc) throw new Error('The browser is not open. Run: widget-browser open <file-or-url>');
    await ensureDebugger(wc);
    return wc;
  }
  const cdp = async (method, params = {}) => (await page()).debugger.sendCommand(method, params);

  async function evaluate(expression) {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  }

  // Runs fn(selector, ...args) in the page; the selector is passed as data, never pasted into code.
  const inPage = (fn, ...args) => evaluate(`(${fn})(...${JSON.stringify(args)})`);

  async function waitFor(selector, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (await inPage((s) => !!document.querySelector(s), selector)) return true;
      if (Date.now() > end) throw new Error(`Nothing matches ${selector} after ${timeoutMs / 1000}s`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const commands = {
    async open({ target, cwd }) {
      if (!target) throw new Error('Usage: widget-browser open <file-or-url>');
      const abs = /^[a-z][\w+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target) ? target
        : /^(localhost|127\.|\[::1\])/i.test(target) ? target : path.resolve(cwd || process.cwd(), target);
      const r = await browser.load(abs, { focus: false });
      await page();
      return r;
    },
    async status() {
      const wc = browser.page();
      if (!wc) return { open: false };
      return { open: true, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), viewport: browser.device() };
    },
    async reload() { (await page()).reloadIgnoringCache(); return { ok: true }; },
    async back() { (await page()).navigationHistory.goBack(); return { ok: true }; },
    async viewport({ name }) {
      if (!browser.setDevice(name)) throw new Error('Viewport is one of: full, desktop, laptop, tablet, mobile');
      return { viewport: name };
    },
    async screenshot({ out, full, selector, cwd }) {
      await page();
      const params = { format: 'png', captureBeyondViewport: !!full };
      if (full || selector) {
        const box = await inPage((s, whole) => {
          if (!s) return whole ? { x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } : null;
          const el = document.querySelector(s);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + scrollX, y: r.top + scrollY, width: Math.max(1, r.width), height: Math.max(1, r.height) };
        }, selector || '', !!full);
        if (selector && !box) throw new Error(`Nothing matches ${selector}`);
        if (box) params.clip = { ...box, scale: 1 };
        params.captureBeyondViewport = true;
      }
      const { data } = await cdp('Page.captureScreenshot', params);
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const file = out ? path.resolve(cwd || process.cwd(), out) : path.join(shotsDir, `shot-${stamp}-${crypto.randomBytes(2).toString('hex')}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return { file };
    },
    async eval({ js }) {
      if (!js) throw new Error('Usage: widget-browser eval "<javascript>"   (or --file script.js, or - to read stdin)');
      return { value: await evaluate(js) };
    },
    async text({ selector }) {
      const t = await inPage((s) => { const el = s ? document.querySelector(s) : document.body; return el ? el.innerText : null; }, selector || '');
      if (t === null) throw new Error(`Nothing matches ${selector}`);
      return { text: clip(t) };
    },
    async html({ selector }) {
      const h = await inPage((s) => { const el = s ? document.querySelector(s) : document.documentElement; return el ? el.outerHTML : null; }, selector || '');
      if (h === null) throw new Error(`Nothing matches ${selector}`);
      return { html: clip(h) };
    },
    async click({ selector }) {
      if (!selector) throw new Error('Usage: widget-browser click <css-selector>');
      await waitFor(selector, 5000);
      // A real mouse click at the element's center, so frameworks see the same events as from a user.
      const c = await inPage((s) => {
        const el = document.querySelector(s);
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, selector);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
      return { clicked: selector };
    },
    async type({ selector, text }) {
      if (!selector || text === undefined) throw new Error('Usage: widget-browser type <css-selector> <text>');
      await waitFor(selector, 5000);
      await inPage((s) => { const el = document.querySelector(s); el.focus(); if ('value' in el) el.value = ''; }, selector);
      await cdp('Input.insertText', { text: String(text) });
      return { typed: selector };
    },
    async press({ key }) {
      if (!key) throw new Error('Usage: widget-browser press <key>   e.g. Enter, Tab, Escape, ArrowDown');
      const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };
      const k = key === 'Space' ? ' ' : key;
      const base = { key: k, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: codes[key] || key.toUpperCase().charCodeAt(0) };
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(key === 'Enter' ? { text: '\r' } : k.length === 1 ? { text: k } : {}) });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      return { pressed: key };
    },
    async wait({ selector, timeout }) {
      if (!selector) throw new Error('Usage: widget-browser wait <css-selector> [--timeout seconds]');
      await page();
      await waitFor(selector, (Number(timeout) || 10) * 1000);
      return { found: selector };
    },
    async console({ clear, errors }) {
      await page();
      const entries = log.console.filter((e) => !errors || e.level === 'error' || e.level === 'warning');
      const out = entries.map((e) => `[${e.level}] ${e.message}${e.source ? `  (${e.source})` : ''}`);
      if (clear) log.clear();
      return { entries: out };
    },
    async network({ clear, failed }) {
      await page();
      const list = [...log.network.values()].filter((r) => !failed || r.failed || r.status >= 400);
      const out = list.map((r) => `${r.status || (r.failed ? 'ERR' : '…')} ${r.method} ${r.url}${r.failed ? `  (${r.failed})` : ''}`);
      if (clear) log.clear();
      return { requests: out };
    },
    async cdp({ method, params }) {
      if (!cdpAllowed(method)) throw new Error(`Not allowed: ${method}. Only the page's own domains (${[...CDP_DOMAINS].join(', ')}) can be used.`);
      return { result: await cdp(method, params || {}) };
    }
  };

  async function run(cmd, body) {
    const fn = Object.prototype.hasOwnProperty.call(commands, cmd) ? commands[cmd] : null;
    if (!fn) throw new Error(`Unknown command: ${cmd}. Run: widget-browser help`);
    return fn(body || {});
  }

  let server = null;
  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const reply = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (!authorized(req, token)) return reply(403, { error: 'Forbidden' });
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (d) => { raw += d; if (raw.length > MAX_BODY) req.destroy(); });
        req.on('end', async () => {
          let body;
          try { body = raw ? JSON.parse(raw) : {}; } catch { return reply(400, { error: 'Bad JSON' }); }
          try {
            reply(200, await run(decodeURIComponent(req.url.slice(1)), body));
          } catch (err) {
            reply(200, { error: err.message || String(err) });
          }
        });
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
  }

  return {
    token,
    start,
    run,
    url: () => (server && server.address() ? `http://127.0.0.1:${server.address().port}` : null),
    stop: () => { if (server) server.close(); server = null; }
  };
}

module.exports = { createControl, authorized, cdpAllowed, createPageLog, CDP_DOMAINS };

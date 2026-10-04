/* global Terminal, FitAddon, WebLinksAddon */
(async () => {
  const { widget } = window;
  const cfg = await widget.getConfig();

  if (cfg.transparent) document.body.classList.add('transparent');
  document.documentElement.style.setProperty('--bg', cfg.theme.background);

  const term = new Terminal({
    fontFamily: cfg.fontFamily,
    fontSize: cfg.fontSize,
    cursorBlink: true,
    allowProposedApi: true,
    allowTransparency: cfg.transparent,
    scrollback: 10000,
    theme: cfg.transparent ? { ...cfg.theme, background: '#00000000' } : cfg.theme
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, url) => widget.openExternal(url)));
  term.open(document.getElementById('terminal'));
  fit.fit();

  // --- toast -------------------------------------------------------------
  const toastEl = document.getElementById('toast');
  let toastTimer;
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1200);
  };

  // --- PTY wiring ----------------------------------------------------------
  const start = () => {
    document.body.classList.remove('exited');
    term.reset();
    fit.fit();
    widget.pty.start(term.cols, term.rows);
  };

  widget.pty.onData((data) => term.write(data));
  widget.pty.onExit((code) => {
    document.body.classList.add('exited');
    term.write(`\r\n\x1b[90m[session ended (exit ${code}). Press Enter to restart]\x1b[0m\r\n`);
  });
  widget.pty.onRestart(start);

  term.onData((data) => {
    if (document.body.classList.contains('exited')) {
      if (data === '\r') start();
      return;
    }
    widget.pty.write(data);
  });
  term.onResize(({ cols, rows }) => widget.pty.resize(cols, rows));

  new ResizeObserver(() => {
    try { fit.fit(); } catch { /* not visible yet */ }
  }).observe(document.getElementById('terminal'));

  // --- Keyboard: copy/paste, newline, restart -----------------------------
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const key = e.key.toLowerCase();

    // Ctrl+C copies when text is selected, otherwise it is sent as SIGINT.
    if (e.ctrlKey && !e.shiftKey && key === 'c' && term.hasSelection()) {
      widget.clipboard.write(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (e.ctrlKey && e.shiftKey && key === 'c') {
      if (term.hasSelection()) widget.clipboard.write(term.getSelection());
      return false;
    }
    // Ctrl+V / Ctrl+Shift+V paste (bracketed paste handled by xterm).
    if (e.ctrlKey && key === 'v') {
      widget.clipboard.read().then((text) => text && term.paste(text));
      return false;
    }
    // Shift+Enter inserts a newline in Claude Code's prompt (sent as Esc+Enter).
    if (e.shiftKey && !e.ctrlKey && !e.altKey && key === 'enter') {
      widget.pty.write('\x1b\r');
      return false;
    }
    if (e.ctrlKey && e.shiftKey && key === 'r') {
      start();
      return false;
    }
    // Ctrl+= / Ctrl+- zoom the font.
    if (e.ctrlKey && (key === '=' || key === '+' || key === '-')) {
      const size = Math.min(32, Math.max(8, term.options.fontSize + (key === '-' ? -1 : 1)));
      term.options.fontSize = size;
      fit.fit();
      toast(`Font ${size}px`);
      return false;
    }
    return true;
  });

  // Right-click: copy selection if any, otherwise paste (Windows Terminal style).
  document.getElementById('terminal').addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      widget.clipboard.write(term.getSelection());
      term.clearSelection();
      toast('Copied');
    } else {
      const text = await widget.clipboard.read();
      if (text) term.paste(text);
    }
  });

  // --- Title bar buttons --------------------------------------------------
  const pinBtn = document.getElementById('btn-pin');
  pinBtn.classList.toggle('on', cfg.alwaysOnTop);

  document.getElementById('btn-restart').onclick = start;
  document.getElementById('btn-fade').onclick = async () => toast(`Opacity ${Math.round((await widget.win.opacity(-0.05)) * 100)}%`);
  document.getElementById('btn-solid').onclick = async () => toast(`Opacity ${Math.round((await widget.win.opacity(0.05)) * 100)}%`);
  pinBtn.onclick = async () => {
    const on = await widget.win.togglePin();
    pinBtn.classList.toggle('on', on);
    toast(on ? 'Pinned on top' : 'Unpinned');
  };
  document.getElementById('btn-settings').onclick = () => widget.openConfig();
  document.getElementById('btn-min').onclick = () => widget.win.hide();
  document.getElementById('btn-close').onclick = () => widget.win.close();
  // Double-clicking the bar would maximize a frameless window; keep the widget size.
  document.getElementById('bar').addEventListener('dblclick', (e) => e.preventDefault());

  window.addEventListener('focus', () => term.focus());
  term.focus();
  start();
})();

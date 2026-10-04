/* global Terminal, FitAddon, WebLinksAddon, WidgetWorkers, WidgetFooter, WidgetMdLinks */
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
    theme: cfg.transparent ? { ...cfg.theme, background: '#00000000' } : cfg.theme,
    // OSC 8 hyperlinks: Markdown files open in a popout, web links in the browser.
    linkHandler: {
      allowNonHttpProtocols: true,
      activate: (_e, uri) => {
        if (/^file:/i.test(uri) && /\.(md|markdown)$/i.test(uri.split(/[?#]/)[0])) widget.md.open(uri);
        else if (/^https?:\/\//i.test(uri)) widget.openExternal(uri);
      }
    }
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

  // --- OSC 9;4 progress (title-bar strip + taskbar) -----------------------
  const progressEl = document.getElementById('progress');
  const setProgress = (state, value) => {
    progressEl.className = '';
    if (state >= 1 && state <= 4) {
      progressEl.classList.add('on');
      if (state === 2) progressEl.classList.add('error');
      if (state === 3) progressEl.classList.add('busy');
      if (state === 4) progressEl.classList.add('paused');
      progressEl.style.width = state === 3 ? '' : `${Math.min(100, Math.max(0, value))}%`;
    } else {
      progressEl.style.width = '0';
    }
    widget.win.progress(state, value);
    trackTurn(state);
  };
  term.parser.registerOscHandler(9, (data) => {
    const m = /^4;(\d)(?:;(\d{1,3}))?/.exec(data);
    if (!m) return false; // not a progress sequence; leave other OSC 9 uses alone
    setProgress(Number(m[1]), Number(m[2] || 0));
    return true;
  });

  // --- Side panel: worker rows on top, status footer at the bottom ------------
  const sideEl = document.getElementById('side');
  const workersEl = document.getElementById('workers');
  const countEl = document.getElementById('workers-count');
  const footerEl = document.getElementById('footer');
  let workerCount = 0;
  const updateSide = () => { sideEl.hidden = workerCount === 0 && footerEl.hidden; };

  // --- Footer: model, cost, context, rate limits (statusLine), git, turn timer ---
  const $ = (id) => document.getElementById(id);
  let status = null;
  let git = null;
  let turnStart = null;
  let lastTurnMs = null;
  let turnTimer = null;

  const setLevel = (el, pct) => {
    el.classList.remove('warm', 'hot');
    const lv = WidgetFooter.level(pct);
    if (lv) el.classList.add(lv);
  };

  const renderFooter = () => {
    const now = Date.now();
    const s = status;
    $('f-model').textContent = s && s.model ? (s.effort ? `${s.model} · ${s.effort}` : s.model) : '';
    $('f-cost').textContent = s && s.cost !== null ? `$${s.cost.toFixed(2)}` : '';
    $('f-ctx-row').hidden = !s || s.ctxPct === null;
    if (s && s.ctxPct !== null) {
      $('f-meter').style.width = `${s.ctxPct}%`;
      setLevel($('f-meter'), s.ctxPct);
      setLevel($('f-ctx'), s.ctxPct);
      const size = s.ctxSize ? `/${WidgetFooter.fmtTokens(s.ctxSize)}` : '';
      $('f-ctx').textContent = `${s.ctxPct}% ${WidgetFooter.fmtTokens(s.ctxTokens)}${size}`;
    }
    $('f-limits').hidden = !s || (s.fiveHour === null && s.sevenDay === null);
    if (s) {
      const resets = WidgetFooter.fmtResets(s.fiveHourResets, now);
      $('f-5h').textContent = s.fiveHour === null ? '' : `5h ${s.fiveHour}%${resets ? ` · resets ${resets}` : ''}`;
      $('f-7d').textContent = s.sevenDay === null ? '' : `7d ${s.sevenDay}%`;
      setLevel($('f-5h'), s.fiveHour);
      setLevel($('f-7d'), s.sevenDay);
    }
    $('f-git').textContent = WidgetFooter.fmtGit(git) || '';
    $('f-git').title = (s && s.cwd) || '';
    const turn = $('f-turn');
    turn.classList.toggle('busy', turnStart !== null);
    turn.textContent = turnStart !== null ? `▶ ${WidgetFooter.fmtDuration(now - turnStart)}`
      : lastTurnMs !== null ? `last ${WidgetFooter.fmtDuration(lastTurnMs)}` : '';
    footerEl.hidden = !s && !git && turnStart === null && lastTurnMs === null;
    updateSide();
  };

  // Claude Code sets OSC 9;4 progress when a turn starts and clears it when the turn ends.
  function trackTurn(state) {
    if (state >= 1 && state <= 4 && turnStart === null) {
      turnStart = Date.now();
      if (!turnTimer) turnTimer = setInterval(renderFooter, 1000);
    } else if (state === 0 && turnStart !== null) {
      lastTurnMs = Date.now() - turnStart;
      turnStart = null;
      clearInterval(turnTimer);
      turnTimer = null;
    }
    renderFooter();
  }

  widget.status.onUpdate((raw) => { status = WidgetFooter.summarize(raw); renderFooter(); });
  widget.status.onGit((info) => { git = info; renderFooter(); });

  const resetFooter = () => {
    status = null;
    git = null;
    turnStart = null;
    lastTurnMs = null;
    clearInterval(turnTimer);
    turnTimer = null;
    renderFooter();
  };

  // --- Worker rows (subagents + background shells, fed by hooks/workers-hook.js) ---
  const MAX_ROWS = 20;
  let workerEvents = [];
  let workerTimer = null;
  const rowEls = new Map();

  const fmtElapsed = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const makeRow = () => {
    const row = document.createElement('div');
    row.className = 'worker';
    row.innerHTML = '<span class="icon"></span><span class="label"></span><span class="time"></span>';
    return row;
  };

  const renderWorkers = () => {
    const now = Date.now();
    const workers = WidgetWorkers.reduce(workerEvents, now);
    const shown = workers.slice(0, MAX_ROWS);
    const keep = new Set(shown.map((w) => w.id));
    for (const [id, el] of rowEls) if (!keep.has(id)) { el.remove(); rowEls.delete(id); }
    let more = workersEl.querySelector('.more');
    for (const w of shown) {
      let row = rowEls.get(w.id);
      if (!row) {
        // Insert once and never move it: moving a node restarts its CSS fade/spin animations.
        // Workers start in time order, so a new row belongs at the end (before "+N more").
        row = makeRow();
        rowEls.set(w.id, row);
        workersEl.insertBefore(row, more);
      }
      row.querySelector('.label').textContent = w.label;
      row.querySelector('.time').textContent = fmtElapsed((w.doneAt ?? now) - w.startedAt);
      row.classList.toggle('done', w.doneAt !== null);
    }
    if (workers.length > MAX_ROWS) {
      if (!more) { more = document.createElement('div'); more.className = 'worker more'; workersEl.appendChild(more); }
      more.textContent = `+${workers.length - MAX_ROWS} more`;
    } else if (more) {
      more.remove();
    }
    const running = workers.filter((w) => w.doneAt === null).length;
    const done = workers.length - running;
    const parts = [];
    if (running) parts.push(`${running} running`);
    if (done) parts.push(`${done} done`);
    countEl.textContent = parts.join(' · ') || 'idle';
    countEl.classList.toggle('idle', running === 0);
    workerCount = workers.length;
    updateSide();
    if (workers.length === 0 && workerTimer) { clearInterval(workerTimer); workerTimer = null; }
  };

  const clearWorkers = () => {
    workerEvents = [];
    renderWorkers();
  };

  widget.workers.onEvents((events) => {
    workerEvents = workerEvents.concat(events);
    renderWorkers();
    if (!workerTimer) workerTimer = setInterval(renderWorkers, 1000);
  });

  // --- PTY wiring ----------------------------------------------------------
  const start = () => {
    document.body.classList.remove('exited');
    clearWorkers();
    resetFooter();
    setProgress(0, 0);
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

  // --- Markdown paths in the output open rendered in a popout (click) -------
  // Wrapped rows are joined so a long path that spans rows is still one link.
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const buf = term.buffer.active;
      let first = y - 1;
      while (first > 0 && buf.getLine(first) && buf.getLine(first).isWrapped) first--;
      let last = y - 1;
      while (buf.getLine(last + 1) && buf.getLine(last + 1).isWrapped) last++;
      let text = '';
      for (let r = first; r <= last; r++) {
        const line = buf.getLine(r);
        if (line) text += line.translateToString(r === last);
      }
      const matches = WidgetMdLinks.find(text);
      if (!matches.length) return callback(undefined);
      const cols = term.cols;
      const pos = (i) => ({ x: (i % cols) + 1, y: first + Math.floor(i / cols) + 1 });
      Promise.all(matches.map((m) => widget.md.resolve(m.candidates.map((c) => c.path))
        .then((hit) => hit && { c: m.candidates[hit.index], file: hit.file })))
        .then((hits) => {
          const links = hits.filter(Boolean).map(({ c, file }) => ({
            range: { start: pos(c.start), end: pos(c.end - 1) },
            text: c.path,
            decorations: { underline: true, pointerCursor: true },
            activate: () => widget.md.open(file)
          })).filter((l) => l.range.start.y <= y && l.range.end.y >= y);
          callback(links.length ? links : undefined);
        }, () => callback(undefined));
    }
  });

  // Debounced so a burst of size changes (window drag, worker panel opening) resizes the PTY once.
  let fitTimer;
  new ResizeObserver(() => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      try { fit.fit(); } catch { /* not visible yet */ }
    }, 60);
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
    if (key === 'f11' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      widget.win.toggleFullScreen();
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
  // Double-clicking the bar maximizes natively (it is an OS drag region).
  const maxBtn = document.getElementById('btn-max');
  maxBtn.onclick = () => widget.win.toggleMaximize();
  widget.win.onZoom(({ maximized, fullScreen }) => {
    maxBtn.textContent = maximized || fullScreen ? '❐' : '□';
    maxBtn.title = fullScreen ? 'Exit full screen (F11)' : maximized ? 'Restore' : 'Maximize (F11 for full screen)';
  });

  window.addEventListener('focus', () => term.focus());
  term.focus();
  start();
})();

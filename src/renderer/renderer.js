/* global WidgetWorkers, WidgetFooter, WidgetSessionState, WidgetTerminals, WidgetRail, WidgetFilesPane */
(async () => {
  const { widget } = window;
  const cfg = await widget.getConfig();
  const $ = (id) => document.getElementById(id);

  if (cfg.transparent) document.body.classList.add('transparent');
  document.documentElement.style.setProperty('--bg', cfg.theme.background);

  // --- toast -------------------------------------------------------------
  const toastEl = $('toast');
  let toastTimer;
  const toast = (msg, ms = 1200) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  };
  widget.onToast((msg) => toast(msg, 4000));

  // --- Per-session cache: dot state, worker events, footer status, progress, turn timer ---
  const SS = WidgetSessionState;
  const cache = new Map();
  const sess = (id) => {
    if (!cache.has(id)) {
      cache.set(id, { state: SS.initial(), workerEvents: [], status: null, git: null, progress: { state: 0, value: 0 }, turnStart: null, lastTurnMs: null });
    }
    return cache.get(id);
  };
  let projects = [];
  let openIds = new Set();
  let activeId = null;

  const update = (id, ev) => {
    const s = sess(id);
    s.state = SS.apply(s.state, ev, id === activeId);
    renderRail();
  };

  // --- Terminals ----------------------------------------------------------
  const terminals = WidgetTerminals.createTerminals({
    widget,
    cfg,
    host: $('terminal'),
    toast,
    onInput: (id) => update(id, { t: 'input' }),
    onProgress: (id, state, value) => {
      const s = sess(id);
      s.progress = { state, value };
      const ended = state === 0 && s.turnStart !== null;
      trackTurn(s, state);
      update(id, { t: 'progress', state });
      // Claude may have added or removed files during the turn.
      if (ended && id === activeId) filesPane.refresh();
      if (id === activeId) { renderProgress(); renderFooter(); }
      renderTaskbar();
    }
  });
  terminals.setOnRestart((id) => {
    cache.delete(id);
    update(id, { t: 'start' });
    if (id === activeId) renderActive();
    renderTaskbar();
  });

  widget.pty.onData(({ id, data }) => terminals.write(id, data));
  widget.pty.onExit(({ id, code }) => {
    terminals.markExited(id, code);
    const s = sess(id);
    s.progress = { state: 0, value: 0 };
    trackTurn(s, 0);
    update(id, { t: 'exit' });
    if (id === activeId) renderActive();
    renderTaskbar();
  });
  widget.pty.onRestartActive(() => activeId && terminals.restart(activeId));

  // --- Rail ---------------------------------------------------------------
  const rail = WidgetRail.createRail({
    el: $('rail'),
    onOpen: (id) => activate(id),
    onMenu: (id) => widget.projects.menu(id),
    onAdd: () => widget.projects.addMenu()
  });
  rail.setCollapsed(cfg.rail.collapsed, cfg.rail.width);
  widget.rail.onState(({ collapsed, width }) => rail.setCollapsed(collapsed, width));
  $('btn-rail').onclick = () => widget.rail.toggle();

  // --- Files pane ---------------------------------------------------------
  const filesPane = WidgetFilesPane.createFilesPane({ el: $('files'), widget, open: cfg.filesOpen });
  $('btn-files').onclick = () => { filesPane.toggle(); terminals.focus(); };
  $('btn-browser').onclick = () => widget.browser.open();

  function renderRail() {
    rail.render(projects, { active: activeId, open: openIds, dot: (id) => SS.dot(sess(id).state) });
  }

  widget.projects.onList(({ list, open }) => {
    projects = list;
    openIds = new Set(open);
    renderRail();
  });
  widget.projects.onSelect(({ id }) => activate(id));
  widget.projects.onClosed(({ id }) => {
    terminals.destroy(id);
    cache.delete(id);
    openIds.delete(id);
    renderRail();
    renderTaskbar();
    if (id === activeId) {
      showPlaceholder('Session closed. Press Enter or click the project to start it again.');
      renderActive();
    }
  });

  // --- Switching ----------------------------------------------------------
  const placeholderEl = $('placeholder');
  function showPlaceholder(text) {
    placeholderEl.textContent = text;
    placeholderEl.hidden = !text;
  }

  let switching = Promise.resolve();
  function activate(id) {
    switching = switching.then(() => doActivate(id)).catch(() => {});
    return switching;
  }

  async function doActivate(id) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    if (p.missing && !terminals.has(id)) return toast(`Folder missing: ${p.path}`, 2500);
    const fresh = !terminals.has(id);
    if (fresh) terminals.create(id);
    const t = terminals.show(id);
    const ok = await widget.projects.open(id, t.term.cols, t.term.rows);
    if (!ok) {
      terminals.destroy(id);
      toast(`Folder missing: ${p.path}`, 2500);
      if (activeId && terminals.has(activeId)) terminals.show(activeId);
      return;
    }
    activeId = id;
    openIds.add(id);
    showPlaceholder('');
    update(id, { t: 'activate' });
    renderActive();
  }

  // Everything that shows the active session: title, progress strip, workers, footer.
  function renderActive() {
    const p = projects.find((x) => x.id === activeId);
    $('title-text').textContent = p ? p.name : 'Claude Code';
    $('title').title = p ? p.path : '';
    filesPane.setProject(activeId);
    const t = activeId && terminals.get(activeId);
    document.body.classList.toggle('exited', !t || t.exited);
    rowEls.forEach((el) => el.remove());
    rowEls.clear();
    renderProgress();
    renderWorkers();
    renderFooter();
    renderRail();
  }

  // --- OSC 9;4 progress: strip shows the active session, taskbar is busy while any session works ---
  const progressEl = $('progress');
  function renderProgress() {
    const { state, value } = activeId ? sess(activeId).progress : { state: 0, value: 0 };
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
  }

  let lastTaskbar = '';
  function renderTaskbar() {
    const active = activeId && cache.has(activeId) ? cache.get(activeId).progress : { state: 0, value: 0 };
    const busy = [...cache.entries()].some(([id, s]) => openIds.has(id) && s.state.working);
    const { state, value } = active.state ? active : busy ? { state: 3, value: 0 } : { state: 0, value: 0 };
    const key = `${state}:${value}`;
    if (key === lastTaskbar) return;
    lastTaskbar = key;
    widget.win.progress(state, value);
  }

  // --- Side panel: worker rows on top, status footer at the bottom ------------
  const sideEl = $('side');
  const workersEl = $('workers');
  const countEl = $('workers-count');
  const footerEl = $('footer');
  let workerCount = 0;
  const updateSide = () => { sideEl.hidden = workerCount === 0 && footerEl.hidden; };

  // Collapsed, the panel is a slim strip with the running-worker count and a turn indicator.
  let sideCollapsed = !!cfg.sideCollapsed;
  const setSideCollapsed = (collapsed) => {
    sideCollapsed = collapsed;
    document.body.classList.toggle('side-collapsed', collapsed);
    widget.side.setCollapsed(collapsed);
  };
  document.body.classList.toggle('side-collapsed', sideCollapsed);
  $('side-toggle').onclick = () => { setSideCollapsed(true); terminals.focus(); };
  $('side-mini').onclick = () => { setSideCollapsed(false); terminals.focus(); };

  const setLevel = (el, pct) => {
    el.classList.remove('warm', 'hot');
    const lv = WidgetFooter.level(pct);
    if (lv) el.classList.add(lv);
  };

  function renderFooter() {
    const now = Date.now();
    const a = activeId ? sess(activeId) : null;
    const s = a && a.status;
    const git = a && a.git;
    const turnStart = a ? a.turnStart : null;
    const lastTurnMs = a ? a.lastTurnMs : null;
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
    $('mini-turn').classList.toggle('busy', turnStart !== null);
    $('mini-turn').title = turn.textContent;
    turn.textContent = turnStart !== null ? `▶ ${WidgetFooter.fmtDuration(now - turnStart)}`
      : lastTurnMs !== null ? `last ${WidgetFooter.fmtDuration(lastTurnMs)}` : '';
    footerEl.hidden = !s && !git && turnStart === null && lastTurnMs === null;
    updateSide();
  }

  // Claude Code sets OSC 9;4 progress when a turn starts and clears it when the turn ends.
  function trackTurn(s, state) {
    if (state >= 1 && state <= 4 && s.turnStart === null) {
      s.turnStart = Date.now();
    } else if (state === 0 && s.turnStart !== null) {
      s.lastTurnMs = Date.now() - s.turnStart;
      s.turnStart = null;
    }
  }

  widget.status.onUpdate(({ id, status }) => {
    sess(id).status = WidgetFooter.summarize(status);
    if (id === activeId) renderFooter();
  });
  widget.status.onGit(({ id, info }) => {
    sess(id).git = info;
    if (id === activeId) renderFooter();
  });

  // --- Worker rows (subagents + background shells, fed by hooks/workers-hook.js) ---
  const MAX_ROWS = 20;
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

  function renderWorkers() {
    const now = Date.now();
    const workers = activeId ? WidgetWorkers.reduce(sess(activeId).workerEvents, now) : [];
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
    $('mini-count').textContent = running ? String(running) : '';
    $('mini-count').classList.toggle('idle', running === 0);
    workerCount = workers.length;
    updateSide();
  }

  widget.workers.onEvents(({ id, events }) => {
    const s = sess(id);
    s.workerEvents = s.workerEvents.concat(events);
    // Permission prompts and questions (hooks/workers-hook.js) turn the row's dot to "needs you".
    if (events.some((e) => e && e.t === 'attention')) update(id, { t: 'attention' });
    if (id === activeId) renderWorkers();
  });

  // Elapsed times in the worker rows and the turn timer tick once a second.
  setInterval(() => {
    if (!activeId) return;
    const s = sess(activeId);
    if (s.workerEvents.length) renderWorkers();
    if (s.turnStart !== null) renderFooter();
  }, 1000);

  // Debounced so a burst of size changes (window drag, rail or worker panel opening) resizes the PTY once.
  let fitTimer;
  new ResizeObserver(() => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => terminals.fitActive(), 60);
  }).observe($('terminal'));

  // --- Keyboard (caught before xterm): Ctrl+1…9, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+Shift+B, Ctrl+Shift+E, Ctrl+Shift+W ---
  // The rail toggle is Ctrl+Shift+B, not Ctrl+B: Claude Code uses Ctrl+B to background a running command.
  window.addEventListener('keydown', (e) => {
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
      handled();
      const p = projects[Number(e.key) - 1];
      if (p) activate(p.id);
    } else if (e.ctrlKey && !e.altKey && e.key === 'Tab') {
      handled();
      const open = projects.filter((p) => openIds.has(p.id));
      if (open.length < 2) return;
      const i = open.findIndex((p) => p.id === activeId);
      activate(open[(i + (e.shiftKey ? -1 : 1) + open.length) % open.length].id);
    } else if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'b') {
      handled();
      widget.rail.toggle();
    } else if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'w') {
      handled();
      setSideCollapsed(!sideCollapsed);
    } else if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'e') {
      handled();
      filesPane.toggle();
    } else if (e.key === 'Enter' && !placeholderEl.hidden && activeId && !terminals.has(activeId)) {
      handled();
      activate(activeId);
    }
  }, true);

  // --- Title bar buttons --------------------------------------------------
  const pinBtn = $('btn-pin');
  pinBtn.classList.toggle('on', cfg.alwaysOnTop);

  $('btn-restart').onclick = () => activeId && terminals.restart(activeId);
  $('btn-fade').onclick = async () => toast(`Opacity ${Math.round((await widget.win.opacity(-0.05)) * 100)}%`);
  $('btn-solid').onclick = async () => toast(`Opacity ${Math.round((await widget.win.opacity(0.05)) * 100)}%`);
  pinBtn.onclick = async () => {
    const on = await widget.win.togglePin();
    pinBtn.classList.toggle('on', on);
    toast(on ? 'Pinned on top' : 'Unpinned');
  };
  $('btn-settings').onclick = () => widget.openConfig();
  widget.onConfigChanged(({ alwaysOnTop }) => pinBtn.classList.toggle('on', alwaysOnTop));
  $('btn-min').onclick = () => widget.win.hide();
  $('btn-close').onclick = () => widget.win.close();
  // Double-clicking the bar maximizes natively (it is an OS drag region).
  const maxBtn = $('btn-max');
  maxBtn.onclick = () => widget.win.toggleMaximize();
  widget.win.onZoom(({ maximized, fullScreen }) => {
    maxBtn.textContent = maximized || fullScreen ? '❐' : '□';
    maxBtn.title = fullScreen ? 'Exit full screen (F11)' : maximized ? 'Restore' : 'Maximize (F11 for full screen)';
  });

  window.addEventListener('focus', () => { terminals.focus(); filesPane.refresh(); });

  // --- Launch: open the last active project; every other one stays idle until clicked ---
  const initial = await widget.projects.get();
  projects = initial.list;
  openIds = new Set(initial.open);
  renderRail();
  if (initial.active) activate(initial.active);
  else showPlaceholder('No projects yet. Add a folder with + in the project list.');
})();

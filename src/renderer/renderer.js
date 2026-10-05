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

  const isAux = (id) => typeof id === 'string' && id.startsWith('aux:');
  const update = (id, ev) => {
    if (isAux(id)) return;
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
      if (isAux(id)) return;
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
    if (isAux(id)) return renderTabs();
    cache.delete(id);
    update(id, { t: 'start' });
    if (id === activeId) renderActive();
    renderTaskbar();
  });

  widget.pty.onData(({ id, data }) => terminals.write(id, data));
  widget.pty.onExit(({ id, code }) => {
    terminals.markExited(id, code);
    if (isAux(id)) return renderTabs();
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
  $('btn-run').onclick = () => widget.menus.run();
  $('btn-admin').onclick = () => widget.menus.admin();
  $('btn-workbench').onclick = () => widget.workbench.open();

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
    const view = viewOf.get(id);
    if (view && view !== id && terminals.has(view)) terminals.show(view);
    update(id, { t: 'activate' });
    renderActive();
  }

  // --- Terminal tabs: the project's Claude session plus Run-menu tasks, terminals and admin shells ---
  const tabsEl = $('tabs');
  let auxList = [];
  const viewOf = new Map(); // project id -> terminal id in front
  const shownView = () => (activeId && viewOf.get(activeId) && terminals.has(viewOf.get(activeId)) ? viewOf.get(activeId) : activeId);

  function showView(id) {
    if (!terminals.has(id)) return;
    terminals.show(id);
    viewOf.set(activeId, id);
    renderTabs();
  }

  function renderTabs() {
    const mine = auxList.filter((a) => a.projectId === activeId);
    const view = shownView();
    const front = mine.find((a) => a.id === view);
    document.body.classList.toggle('admin-view', !!front && front.kind.startsWith('admin'));
    tabsEl.hidden = !mine.length;
    if (!mine.length) { tabsEl.replaceChildren(); return; }
    const tabs = [{ id: activeId, title: 'Claude', kind: 'claude', running: true }, ...mine];
    tabsEl.replaceChildren(...tabs.map((t) => {
      const el = document.createElement('div');
      el.className = `tab k-${t.kind}${t.id === view ? ' on' : ''}${t.running ? '' : ' exited'}`;
      el.title = t.kind === 'admin' ? 'Administrator terminal' : t.kind === 'admin-claude' ? 'Claude running as administrator' : t.title;
      const label = document.createElement('span');
      label.className = 'tlabel';
      label.textContent = (t.kind.startsWith('admin') ? '⛨ ' : '') + t.title;
      el.appendChild(label);
      if (t.kind !== 'claude') {
        const x = document.createElement('button');
        x.className = 'tclose';
        x.textContent = '×';
        x.title = 'Close';
        x.onclick = (e) => { e.stopPropagation(); widget.aux.close(t.id); };
        el.appendChild(x);
      }
      el.onclick = () => { showView(t.id); terminals.focus(); };
      el.onauxclick = (e) => { if (e.button === 1 && t.kind !== 'claude') widget.aux.close(t.id); };
      return el;
    }));
  }

  function applyAux(list) {
    const ids = new Set(list.map((a) => a.id));
    for (const a of auxList) if (!ids.has(a.id)) terminals.destroy(a.id);
    for (const a of list) if (!terminals.has(a.id)) terminals.create(a.id);
    auxList = list;
    for (const [p, v] of viewOf) if (isAux(v) && !ids.has(v)) viewOf.delete(p);
    // A closed tab that was in front: show the project's Claude session again.
    if (activeId && terminals.has(shownView())) {
      const t = terminals.get(shownView());
      if (t.el.hidden) terminals.show(shownView());
    }
    renderTabs();
  }
  widget.aux.onList(applyAux);
  widget.aux.onSelect(async ({ id, projectId }) => {
    if (projectId !== activeId) await activate(projectId);
    if (!terminals.has(id)) applyAux(await widget.aux.get());
    showView(id);
  });

  // Everything that shows the active session: title, progress strip, workers, footer.
  function renderActive() {
    const p = projects.find((x) => x.id === activeId);
    $('title-text').textContent = p ? p.name : 'Claude Code';
    $('title').title = p ? p.path : '';
    filesPane.setProject(activeId);
    renderTabs();
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
  const sysEl = $('sysmon');
  const updateSide = () => { sideEl.hidden = workerCount === 0 && footerEl.hidden && sysEl.hidden; };

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

  // --- System monitor strip (src/sysmon.js samples in the main process) ---
  let showSysmon = cfg.showSysmon;
  const pctOf = (used, total) => (total ? Math.round((used / total) * 100) : 0);
  const gb = (bytes) => `${(bytes / 1073741824).toFixed(1)}G`;
  widget.sys.onSample((smp) => {
    sysEl.hidden = !showSysmon;
    if (!showSysmon) return updateSide();
    const meter = (id, pct) => { const m = $(id); m.style.width = `${pct}%`; setLevel(m, pct); };
    meter('s-cpu', smp.cpu.pct);
    $('s-cpu-t').textContent = `${smp.cpu.pct}%${smp.cpuTemp !== null ? ` · ${Math.round(smp.cpuTemp)}°C` : ''}`;
    const memPct = pctOf(smp.mem.used, smp.mem.total);
    meter('s-mem', memPct);
    $('s-mem-t').textContent = `${gb(smp.mem.used)}/${gb(smp.mem.total)}`;
    const g = smp.gpus[0];
    $('s-gpu-row').hidden = !g;
    if (g) {
      meter('s-gpu', g.util || 0);
      $('s-gpu-t').textContent = `${g.util ?? '–'}%${g.temp !== null ? ` · ${g.temp}°C` : ''}`;
      $('s-gpu-row').title = g.name;
    }
    sysEl.title = `${smp.cpu.model} (${smp.cpu.count} threads)${smp.cpuTemp === null ? '\nCPU temperature: not available (on Windows it needs LibreHardwareMonitor running)' : ''}\nClick for the full monitor`;
    updateSide();
  });
  sysEl.onclick = () => widget.workbench.open('system');

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
    } else if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'f') {
      handled();
      filesPane.focusSearch();
    } else if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'g') {
      handled();
      widget.workbench.open();
    } else if (e.ctrlKey && !e.altKey && (e.key === 'PageDown' || e.key === 'PageUp') && activeId) {
      handled();
      const ids = [activeId, ...auxList.filter((a) => a.projectId === activeId).map((a) => a.id)];
      if (ids.length < 2) return;
      const i = ids.indexOf(shownView());
      showView(ids[(i + (e.key === 'PageDown' ? 1 : -1) + ids.length) % ids.length]);
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
  widget.onConfigChanged(({ alwaysOnTop, showSysmon: sm }) => {
    pinBtn.classList.toggle('on', alwaysOnTop);
    if (sm !== undefined) { showSysmon = sm; sysEl.hidden = !sm; updateSide(); }
  });

  // --- Small prompt (worktree branch name) -------------------------------------
  const modal = $('modal');
  function ask({ title, text, value = '', ok = 'OK', submit }) {
    $('modal-title').textContent = title;
    $('modal-text').textContent = text || '';
    $('modal-error').textContent = '';
    $('modal-ok').textContent = ok;
    const input = $('modal-input');
    input.value = value;
    modal.hidden = false;
    input.focus();
    input.select();
    const close = () => { modal.hidden = true; terminals.focus(); };
    $('modal-cancel').onclick = close;
    modal.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    $('modal-form').onsubmit = async (e) => {
      e.preventDefault();
      $('modal-ok').disabled = true;
      $('modal-error').textContent = '';
      try {
        const err = await submit(input.value);
        if (err) $('modal-error').textContent = err;
        else close();
      } finally {
        $('modal-ok').disabled = false;
      }
    };
  }
  widget.projects.onWorktreeAsk(({ id, name }) => ask({
    title: `New worktree session for ${name}`,
    text: 'A second checkout on its own branch, in its own folder, with its own Claude session. An existing branch is checked out; a new name makes a new branch.',
    value: 'feature/',
    ok: 'Create',
    submit: async (branch) => {
      const r = await widget.projects.createWorktree(id, branch);
      if (r && r.error) return r.error;
      toast(`Worktree ready: ${r.dir}`, 3000);
      return null;
    }
  }));
  $('btn-min').onclick = () => widget.win.hide();
  $('btn-close').onclick = () => widget.win.close();
  // Double-clicking the bar maximizes natively (it is an OS drag region).
  const maxBtn = $('btn-max');
  maxBtn.onclick = () => widget.win.toggleMaximize();
  widget.win.onZoom(({ maximized, fullScreen }) => {
    maxBtn.textContent = maximized || fullScreen ? '❐' : '□';
    maxBtn.title = fullScreen ? 'Exit full screen (F11)' : maximized ? 'Restore' : 'Maximize (F11 for full screen)';
  });

  window.addEventListener('focus', () => {
    if (!modal.hidden || document.activeElement === $('files-q')) return filesPane.refresh();
    terminals.focus();
    filesPane.refresh();
  });

  // --- Launch: open the last active project; every other one stays idle until clicked ---
  const initial = await widget.projects.get();
  projects = initial.list;
  openIds = new Set(initial.open);
  renderRail();
  applyAux(await widget.aux.get());
  if (initial.active) activate(initial.active);
  else showPlaceholder('No projects yet. Add a folder with + in the project list.');
})();

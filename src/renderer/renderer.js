/* global WidgetZones, WidgetWorkers, WidgetFooter, WidgetSessionState, WidgetTerminals, WidgetRail, WidgetFilesPane */
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
    onFocus: (id) => focusTab(id),
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

  // The gremlin peeking up over the ledge at the bottom of the project list. It ducks when the mouse comes
  // near and peeks back up a moment later.
  const mascot = $('mascot');
  let duckTimer;
  document.body.classList.toggle('no-mascot', cfg.showMascot === false);
  mascot.addEventListener('mouseenter', () => {
    mascot.classList.add('ducking');
    clearTimeout(duckTimer);
    duckTimer = setTimeout(() => mascot.classList.remove('ducking'), 1600);
  });

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
    renderTitle(); // the active project may have been renamed
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
    terminals.focus();
  }

  // --- Terminal tabs: the project's Claude session plus Run-menu tasks, terminals and admin shells ---
  // Split view (src/zones.js) stacks two zones, each with its own tab strip; tabs move between them by
  // dragging, Ctrl+Shift+M or the split button. Ctrl+Shift+\ splits and unsplits.
  const Z = WidgetZones;
  const hosts = [$('terminal'), $('terminal-b')];
  const strips = [$('tabs'), $('tabs-b')];
  const zoneEls = [$('zone-a'), $('zone-b')];
  const splitterEl = $('splitter');
  const dropEl = $('split-drop');
  let auxList = [];
  const zoneState = new Map(); // project id -> zones state
  const zst = () => zoneState.get(activeId) || Z.initial();
  const setZst = (st) => { if (activeId) zoneState.set(activeId, st); };
  const tabIds = () => (activeId ? [activeId, ...auxList.filter((a) => a.projectId === activeId).map((a) => a.id)].filter((id) => terminals.has(id)) : []);
  const currentLayout = () => Z.layout(zst(), tabIds());
  const shownView = () => currentLayout().focused || activeId;
  let splitRatio = 0.6;
  try { splitRatio = Math.min(0.85, Math.max(0.15, Number(localStorage.getItem('splitRatio')) || 0.6)); } catch { /* storage off */ }

  function showView(id) {
    if (!terminals.has(id)) return;
    setZst(Z.show(zst(), tabIds(), id));
    renderTabs(true);
  }

  // A click into a terminal: its zone becomes the focused one.
  function focusTab(id) {
    if (!tabIds().includes(id)) return;
    const L = currentLayout();
    if (L.focused === id) return;
    setZst(Z.show(zst(), tabIds(), id));
    renderStrips(currentLayout());
  }

  function moveTab(id, zone) {
    setZst(Z.moveTo(zst(), tabIds(), id, zone));
    renderTabs(true);
  }

  function toggleSplit() {
    const ids = tabIds();
    if (currentLayout().split) {
      setZst(Z.unsplit(zst(), ids));
      return renderTabs(true);
    }
    const pick = Z.splitCandidate(zst(), ids);
    if (pick) return moveTab(pick, 1);
    widget.aux.newShell(activeId); // arrives through aux:select with zone 1
  }

  const tabInfo = (id) => (id === activeId ? { id, title: 'Claude', kind: 'claude', running: true } : auxList.find((a) => a.id === id));

  function makeTab(t, on) {
    const el = document.createElement('div');
    el.className = `tab k-${t.kind}${on ? ' on' : ''}${t.running ? '' : ' exited'}`;
    el.title = t.kind === 'admin' ? 'Administrator terminal' : t.kind === 'admin-claude' ? 'Claude running as administrator' : `${t.title} (drag to the other zone to split)`;
    el.draggable = true;
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
    el.onclick = () => showView(t.id);
    el.onauxclick = (e) => { if (e.button === 1 && t.kind !== 'claude') widget.aux.close(t.id); };
    el.ondragstart = (e) => {
      e.dataTransfer.setData('application/x-widget-tab', t.id);
      e.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('dragging-tab');
      dropEl.hidden = currentLayout().split;
    };
    el.ondragend = () => { document.body.classList.remove('dragging-tab'); dropEl.hidden = true; };
    return el;
  }

  function splitButton(split) {
    const b = document.createElement('button');
    b.className = 'tsplit';
    b.textContent = split ? '▭' : '⬓';
    b.title = split ? 'Back to one zone (Ctrl+Shift+\\)' : 'Split into two zones (Ctrl+Shift+\\)';
    b.onclick = () => toggleSplit();
    return b;
  }

  function renderStrips(L) {
    const multi = tabIds().length > 1;
    strips.forEach((strip, z) => {
      const ids = L.zones[z];
      strip.hidden = z === 1 ? !L.split : !multi && !L.split;
      strip.classList.toggle('focused', L.split && L.focus === z);
      if (strip.hidden) { strip.replaceChildren(); return; }
      strip.replaceChildren(...ids.map((id) => makeTab(tabInfo(id), id === L.front[z])));
      if (z === 0) strip.appendChild(splitButton(L.split));
    });
    const front = L.focused && auxList.find((a) => a.id === L.focused);
    document.body.classList.toggle('admin-view', !!front && front.kind.startsWith('admin'));
  }

  // Lays out the active project's tabs: each terminal into its zone, the front one of each zone shown.
  function renderTabs(focus = false) {
    const L = currentLayout();
    zoneEls[1].hidden = !L.split;
    splitterEl.hidden = !L.split;
    zoneEls[0].style.flex = L.split ? `${splitRatio} 1 0` : '';
    zoneEls[1].style.flex = L.split ? `${1 - splitRatio} 1 0` : '';
    L.zones.forEach((ids, z) => ids.forEach((id) => terminals.place(id, hosts[z])));
    if (activeId && terminals.has(activeId)) {
      terminals.showOnly(L.front.filter(Boolean), L.focused);
      if (focus) terminals.focus();
    }
    renderStrips(L);
  }

  // Dropping a tab on a zone (its strip or terminal) moves it there; on the drop area below, splits.
  const dropTargets = [[zoneEls[0], 0], [zoneEls[1], 1], [dropEl, 1]];
  for (const [el, zone] of dropTargets) {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-widget-tab')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-over');
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-over'); });
    el.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-widget-tab');
      el.classList.remove('drop-over');
      document.body.classList.remove('dragging-tab');
      dropEl.hidden = true;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      // Dropped on the top zone while unsplit: nothing to do.
      if (zone === 0 && !currentLayout().split) return;
      moveTab(id, zone);
    });
  }

  // Dragging the bar between the zones sets their heights.
  splitterEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitterEl.setPointerCapture(e.pointerId);
    const box = $('center').getBoundingClientRect();
    const onMove = (ev) => {
      splitRatio = Math.min(0.85, Math.max(0.15, (ev.clientY - box.top) / box.height));
      zoneEls[0].style.flex = `${splitRatio} 1 0`;
      zoneEls[1].style.flex = `${1 - splitRatio} 1 0`;
    };
    const onUp = () => {
      splitterEl.removeEventListener('pointermove', onMove);
      splitterEl.removeEventListener('pointerup', onUp);
      try { localStorage.setItem('splitRatio', String(splitRatio)); } catch { /* storage off */ }
      terminals.fitActive();
    };
    splitterEl.addEventListener('pointermove', onMove);
    splitterEl.addEventListener('pointerup', onUp);
  });

  function applyAux(list) {
    const ids = new Set(list.map((a) => a.id));
    for (const a of auxList) if (!ids.has(a.id)) terminals.destroy(a.id);
    for (const a of list) if (!terminals.has(a.id)) terminals.create(a.id);
    auxList = list;
    renderJobs();
    // A closed tab leaves its zone; a zone left empty merges back into one.
    for (const [p, st] of zoneState) {
      const pids = [p, ...list.filter((a) => a.projectId === p).map((a) => a.id)];
      zoneState.set(p, Z.normalize(st, pids));
    }
    renderTabs();
  }
  widget.aux.onList(applyAux);
  widget.aux.onSelect(async ({ id, projectId, zone }) => {
    if (projectId !== activeId) await activate(projectId);
    if (!terminals.has(id)) applyAux(await widget.aux.get());
    if (zone === 1 && id !== activeId) return moveTab(id, 1);
    showView(id);
  });

  // Title bar and window title (taskbar, Alt+Tab): "Gremlin - <project>".
  function renderTitle() {
    const p = projects.find((x) => x.id === activeId);
    document.title = $('title-text').textContent = p ? `Gremlin - ${p.name}` : 'Gremlin';
    $('title').title = p ? p.path : '';
  }

  // Everything that shows the active session: title, progress strip, workers, footer.
  function renderActive() {
    renderTitle();
    filesPane.setProject(activeId);
    renderTabs();
    const t = activeId && terminals.get(activeId);
    document.body.classList.toggle('exited', !t || t.exited);
    rowEls.forEach((el) => el.remove());
    rowEls.clear();
    renderProgress();
    renderWorkers();
    renderJobs();
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
  const jobsEl = $('jobs');
  const updateSide = () => { sideEl.hidden = workerCount === 0 && footerEl.hidden && sysEl.hidden && jobsEl.hidden; };

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

  const meterTo = (el, pct) => { el.style.width = `${Math.min(100, Math.max(0, pct))}%`; setLevel(el, pct); };
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
    // Rate limits, plus how far through the 5-hour window we are: usage running ahead of time hits the limit early.
    const limit = (key, pct, resetsAt) => {
      $(`f-${key}-row`).hidden = pct === null;
      if (pct === null) return;
      meterTo($(`f-${key}-m`), pct);
      setLevel($(`f-${key}`), pct);
      const resets = WidgetFooter.fmtResets(resetsAt, now);
      $(`f-${key}`).textContent = `${Math.round(pct)}%${key === '7d' && resets ? ` · ${resets}` : ''}`;
    };
    limit('5h', s ? s.fiveHour : null, s && s.fiveHourResets);
    limit('7d', s ? s.sevenDay : null, s && s.sevenDayResets);
    const blk = s && s.fiveHour !== null ? WidgetFooter.windowPct(s.fiveHourResets, now, WidgetFooter.WINDOWS.fiveHour) : null;
    $('f-blk-row').hidden = blk === null;
    if (blk !== null) {
      $('f-blk-m').style.width = `${blk}%`;
      $('f-blk').textContent = `${WidgetFooter.fmtResets(s.fiveHourResets, now)} left`;
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

  // --- Progress rows: Claude's task list, the benchmark, Run-menu tasks of the active project ---
  let bench = null; // { label, step, of } while a benchmark runs, { done: true, at } just after
  widget.bench.onProgress((m) => {
    bench = m.done ? { ...bench, done: true, failed: !!m.failed, at: Date.now() } : m;
    renderJobs();
  });
  const runEls = new Map();
  function renderJobs() {
    const now = Date.now();
    const t = activeId ? WidgetWorkers.tasks(sess(activeId).workerEvents, now) : null;
    $('j-tasks').hidden = !t;
    if (t) {
      meterTo($('j-tasks-m'), (t.done / t.total) * 100);
      $('j-tasks-m').classList.remove('warm', 'hot');
      $('j-tasks-t').textContent = `${t.done}/${t.total}`;
      $('j-tasks-now').textContent = t.current ? `▸ ${t.current}` : '';
      $('j-tasks').title = t.all.map((x) => `${x.status === 'completed' ? '✓' : x.status === 'in_progress' ? '▸' : '·'} ${x.subject}`).join('\n');
    }
    if (bench && bench.done && now - bench.at > 4000) bench = null;
    $('j-bench').hidden = !bench;
    if (bench) {
      const pct = bench.done ? 100 : ((bench.step - 1) / bench.of) * 100;
      $('j-bench-m').style.width = `${pct}%`;
      $('j-bench-t').textContent = bench.done ? (bench.failed ? 'stopped' : 'done') : `${bench.label} ${bench.step}/${bench.of}`;
    }
    const runs = auxList.filter((a) => a.projectId === activeId && a.kind === 'task');
    const keep = new Set(runs.map((a) => a.id));
    for (const [id, el] of runEls) if (!keep.has(id)) { el.remove(); runEls.delete(id); }
    for (const a of runs) {
      let el = runEls.get(a.id);
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<span class="s-label"></span><span class="meter"><i></i></span><span class="right"></span>';
        el.onclick = () => { showView(a.id); terminals.focus(); };
        runEls.set(a.id, el);
        $('j-runs').appendChild(el);
      }
      const state = a.running ? 'running' : a.exitCode === 0 ? 'ok' : 'failed';
      el.className = `f-row j-run ${state}`;
      el.querySelector('.s-label').textContent = a.title;
      const took = a.startedAt ? fmtElapsed((a.endedAt || now) - a.startedAt) : '';
      el.querySelector('.right').textContent = state === 'running' ? took : state === 'ok' ? `✓ ${took}` : `exit ${a.exitCode ?? '?'}`;
      el.title = `${a.title}: ${state === 'running' ? 'running' : state === 'ok' ? 'finished' : 'failed'}. Click to show its tab`;
    }
    jobsEl.hidden = !t && !bench && !runs.length;
    updateSide();
  }

  // --- System monitor strip (src/sysmon.js samples in the main process) ---
  let showSysmon = cfg.showSysmon;
  const pctOf = (used, total) => (total ? Math.round((used / total) * 100) : 0);
  const gb = (bytes) => `${(bytes / 1073741824).toFixed(1)}G`;
  widget.sys.onSample((smp) => {
    sysEl.hidden = !showSysmon;
    if (!showSysmon) return updateSide();
    const meter = (id, pct) => meterTo($(id), pct);
    meter('s-cpu', smp.cpu.pct);
    $('s-cpu-t').textContent = `${smp.cpu.pct}%`;
    // CPU temperature on a 30-100 °C scale, so warm (60%) is 72 °C and hot (85%) about 90 °C.
    $('s-temp-row').hidden = smp.cpuTemp === null;
    if (smp.cpuTemp !== null) {
      meter('s-temp', Math.round(((smp.cpuTemp - 30) / 70) * 100));
      $('s-temp-t').textContent = `${Math.round(smp.cpuTemp)}°C`;
    }
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
    const vram = g && g.memTotal ? g : null;
    $('s-vram-row').hidden = !vram;
    if (vram) {
      meter('s-vram', pctOf(vram.memUsed || 0, vram.memTotal));
      $('s-vram-t').textContent = `${((vram.memUsed || 0) / 1024).toFixed(1)}/${(vram.memTotal / 1024).toFixed(1)}G`;
    }
    $('s-disk-row').hidden = !smp.disk;
    if (smp.disk) {
      meter('s-disk', pctOf(smp.disk.used, smp.disk.total));
      $('s-disk-t').textContent = `${WidgetFooter.fmtBytes(smp.disk.used)}/${WidgetFooter.fmtBytes(smp.disk.total)}`;
      $('s-disk-row').title = `Disk space used on ${smp.disk.path}`;
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
    if (id === activeId) { renderWorkers(); renderJobs(); }
  });

  // Elapsed times in the worker rows and the turn timer tick once a second.
  setInterval(() => {
    if (!activeId) return;
    const s = sess(activeId);
    if (s.workerEvents.length) renderWorkers();
    if (s.turnStart !== null) renderFooter();
    if (!jobsEl.hidden) renderJobs();
  }, 1000);
  // The 5-hour window bar and reset times move even while the session is idle.
  setInterval(() => { if (activeId) renderFooter(); }, 30000);

  // Debounced so a burst of size changes (window drag, rail or worker panel opening) resizes the PTY once.
  let fitTimer;
  const fitObserver = new ResizeObserver(() => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => terminals.fitActive(), 60);
  });
  fitObserver.observe($('terminal'));
  fitObserver.observe($('terminal-b'));

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
      // Cycles the tabs of the focused zone.
      const L = currentLayout();
      const ids = L.zones[L.focus];
      if (ids.length < 2) return;
      const i = ids.indexOf(L.focused);
      showView(ids[(i + (e.key === 'PageDown' ? 1 : -1) + ids.length) % ids.length]);
    } else if (e.ctrlKey && !e.altKey && e.shiftKey && e.code === 'Backslash' && activeId) {
      handled();
      toggleSplit();
    } else if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'm' && activeId) {
      handled();
      const L = currentLayout();
      if (L.focused) moveTab(L.focused, L.split ? 1 - L.focus : 1);
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
  widget.onConfigChanged(({ alwaysOnTop, showSysmon: sm, showMascot }) => {
    pinBtn.classList.toggle('on', alwaysOnTop);
    if (sm !== undefined) { showSysmon = sm; sysEl.hidden = !sm; updateSide(); }
    if (showMascot !== undefined) document.body.classList.toggle('no-mascot', !showMascot);
  });

  // --- Small prompt (worktree branch name, project name) ------------------------
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
  widget.projects.onRenameAsk(({ id, name, folder }) => ask({
    title: `Rename ${name}`,
    text: `The name shown in the project list and title bar. The folder stays "${folder}". Leave empty to use the folder name.`,
    value: name,
    ok: 'Rename',
    submit: async (value) => {
      const r = await widget.projects.rename(id, value);
      return r && r.error ? r.error : null;
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

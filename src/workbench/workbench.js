/* global require, monaco */
// Workbench window: Git, New project, Usage, System (monitor, snapshot, benchmark), Changes and Logs.
// Each tab loads when first shown and talks to src/workbench-main.js through window.wb.
(async () => {
  const wb = window.wb;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  let toastTimer;
  const toast = (msg, ms = 2500) => {
    $('toast').textContent = msg;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), ms);
  };
  const setStatus = (id, text, kind = '') => { $(id).textContent = text; $(id).className = kind; };
  const fmtN = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
  const money = (v) => (v === null || v === undefined ? '–' : `$${v.toFixed(2)}`);
  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
  };

  const ctx = await wb.context();
  const renderNavProject = () => {
    $('nav-project').replaceChildren();
    if (ctx.project) $('nav-project').append('Project ', el('b', '', ctx.project.name), el('div', '', ctx.project.path));
  };
  renderNavProject();

  // --- Tabs ----------------------------------------------------------------------------------------
  let tab = null;
  const loaders = {};
  function showTab(name) {
    if (!loaders[name]) name = 'git';
    if (tab === 'system' && name !== 'system') wb.sys.watch(false);
    tab = name;
    for (const n of document.querySelectorAll('[data-tab]')) n.classList.toggle('on', n.dataset.tab === name);
    loaders[name]();
  }
  for (const b of document.querySelectorAll('#nav button')) b.onclick = () => showTab(b.dataset.tab);
  wb.onTab((t) => showTab(t));

  // --- Monaco (Git diff) -------------------------------------------------------------------------------
  let monacoReady = null;
  const loadMonaco = () => monacoReady || (monacoReady = new Promise((resolve) => {
    require.config({ paths: { vs: '../../node_modules/monaco-editor/min/vs' } });
    require(['vs/editor/editor.main'], () => {
      monaco.editor.defineTheme('widget', {
        base: 'vs-dark', inherit: true, rules: [],
        colors: { 'editor.background': '#1f1e1d', 'diffEditor.insertedTextBackground': '#57ab5a33', 'diffEditor.removedTextBackground': '#e5534b33' }
      });
      resolve();
    });
  }));

  // --- Git -----------------------------------------------------------------------------------------
  let git = null;
  let selected = null; // { path, staged }
  let diffEditor = null;
  const CODE = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', T: 'M', U: 'U' };

  async function loadGit() {
    git = await wb.git.status(ctx.project && ctx.project.id);
    const none = !git || !git.repo;
    $('git-body').hidden = none;
    $('git-none').hidden = !none;
    document.querySelector('#git .bar').hidden = none;
    if (none) {
      $('git-none').textContent = ctx.project ? `${ctx.project.name} is not a git repository. Ask Claude to run git init, or create projects from New project with Git on.` : 'Open a project in the widget first.';
      return;
    }
    $('git-branch').textContent = git.branch || 'detached HEAD';
    $('git-sync').textContent = git.upstream ? `${git.upstream}${git.ahead ? ` · ${git.ahead} to push` : ''}${git.behind ? ` · ${git.behind} to pull` : ''}${!git.ahead && !git.behind ? ' · up to date' : ''}` : 'no upstream yet (Push sets it)';
    renderGitFiles();
    $('git-log').replaceChildren(...(git.log || []).map((c) => {
      const d = el('div', 'commit');
      d.append(el('span', 's', c.subject), el('span', 'm', `${c.short} · ${c.author} · ${ago(c.at)}`));
      return d;
    }));
    if (selected && !git.files.some((f) => f.path === selected.path && (selected.staged ? f.staged : f.unstaged))) selected = null;
    if (selected) showDiff(selected); else clearDiff();
  }

  function renderGitFiles() {
    const staged = git.files.filter((f) => f.staged);
    const changed = git.files.filter((f) => f.unstaged);
    const box = $('git-files');
    box.replaceChildren();
    const group = (title, files, isStaged) => {
      if (!files.length) return;
      const h = el('div', 'ghead');
      h.append(el('span', '', `${title} (${files.length})`), el('span', 'grow'));
      const all = el('button', '', isStaged ? '− all' : '+ all');
      all.title = isStaged ? 'Unstage everything' : 'Stage everything';
      all.onclick = () => act(isStaged ? 'unstage' : 'stage', files);
      h.appendChild(all);
      box.appendChild(h);
      for (const f of files) box.appendChild(fileRow(f, isStaged));
    };
    group('Staged', staged, true);
    group('Changes', changed, false);
    if (!staged.length && !changed.length) box.appendChild(el('div', 'empty', 'No changes. Working tree clean.'));
  }

  function fileRow(f, isStaged) {
    const code = f.untracked ? '?' : f.conflict ? 'U' : CODE[isStaged ? f.x : f.y] || 'M';
    const r = el('div', 'gfile');
    if (selected && selected.path === f.path && selected.staged === isStaged) r.classList.add('sel');
    const slash = f.path.lastIndexOf('/');
    const name = el('span', 'gname', slash >= 0 ? f.path.slice(slash + 1) : f.path);
    const dir = el('span', 'gdir', slash >= 0 ? f.path.slice(0, slash) : '');
    r.title = f.orig ? `${f.orig} → ${f.path}` : f.path;
    r.append(el('span', `gcode c-${code === '?' ? 'new' : code}`, code === '?' ? 'N' : code), name, dir);
    const acts = el('span', 'acts');
    const btn = (label, title, fn) => { const b = el('button', '', label); b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; acts.appendChild(b); };
    btn('↗', 'Open in the editor', () => wb.git.openFile({ top: git.top, file: f.path }));
    if (isStaged) btn('−', 'Unstage', () => act('unstage', [f]));
    else {
      btn('↺', f.untracked ? 'Delete this new file' : 'Discard changes', () => act('discard', [f]));
      btn('+', 'Stage', () => act('stage', [f]));
    }
    r.appendChild(acts);
    r.onclick = () => { selected = { path: f.path, staged: isStaged }; renderGitFiles(); showDiff(selected); };
    return r;
  }

  async function act(kind, files) {
    let r;
    if (kind === 'stage') r = await wb.git.stage({ top: git.top, paths: files.map((f) => f.path) });
    if (kind === 'unstage') r = await wb.git.unstage({ top: git.top, paths: files.map((f) => f.path) });
    if (kind === 'discard') r = await wb.git.discard({ top: git.top, files });
    if (r && !r.ok && !r.cancelled) toast(r.err || 'Git failed', 5000);
    loadGit();
  }

  function clearDiff() {
    if (diffEditor) { diffEditor.dispose(); diffEditor = null; }
    $('diff').replaceChildren();
    $('diff-path').textContent = 'Select a file to see its changes';
    $('diff-open').hidden = true;
  }

  async function showDiff(sel) {
    const file = git.files.find((f) => f.path === sel.path);
    if (!file) return clearDiff();
    $('diff-path').textContent = `${file.path}${sel.staged ? ' (staged)' : ''}`;
    $('diff-open').hidden = false;
    $('diff-open').onclick = () => wb.git.openFile({ top: git.top, file: file.path });
    const sides = await wb.git.diff({ top: git.top, file, staged: sel.staged });
    if (!selected || selected.path !== sel.path) return;
    if (sides.binary) { clearDiff(); $('diff').appendChild(el('div', 'note', 'Binary file')); return; }
    await loadMonaco();
    const lang = (monaco.languages.getLanguages().find((l) => (l.extensions || []).some((e) => file.path.toLowerCase().endsWith(e))) || {}).id || 'plaintext';
    if (!diffEditor) {
      $('diff').replaceChildren();
      diffEditor = monaco.editor.createDiffEditor($('diff'), {
        theme: 'widget', automaticLayout: true, readOnly: true, originalEditable: false,
        renderSideBySide: !$('diff-inline').checked, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12
      });
    }
    const old = diffEditor.getModel();
    diffEditor.setModel({ original: monaco.editor.createModel(sides.original, lang), modified: monaco.editor.createModel(sides.modified, lang) });
    if (old) { old.original.dispose(); old.modified.dispose(); }
  }
  $('diff-inline').onchange = () => { if (diffEditor) diffEditor.updateOptions({ renderSideBySide: !$('diff-inline').checked }); };

  async function commit() {
    const message = $('git-msg').value.trim();
    if (!message) return toast('Write a commit message first');
    const anyStaged = git.files.some((f) => f.staged);
    const r = await wb.git.commit({ top: git.top, message, amend: $('git-amend').checked, all: !anyStaged });
    if (!r.ok) {
      const noIdentity = /Please tell me who you are|Author identity unknown/.test(r.err || '');
      return toast(noIdentity ? 'Git needs your name and email first: Settings → Setup → Git identity.' : r.err || 'Commit failed', 8000);
    }
    $('git-msg').value = '';
    $('git-amend').checked = false;
    toast(anyStaged ? 'Committed' : 'Committed all changes');
    loadGit();
  }
  $('git-commit-btn').onclick = commit;
  $('git-msg').addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); commit(); } });
  $('git-suggest').onclick = async () => {
    $('git-suggest').disabled = true;
    $('git-suggest').textContent = '✨ Asking Claude…';
    try {
      const r = await wb.git.suggest({ top: git.top });
      if (r.error) toast(r.error, 6000);
      else $('git-msg').value = r.message;
    } finally {
      $('git-suggest').disabled = false;
      $('git-suggest').textContent = '✨ Suggest';
    }
  };
  const remote = async (kind) => {
    const b = $(`git-${kind}`);
    b.disabled = true;
    try {
      const r = await wb.git[kind]({ top: git.top });
      toast(r.ok ? (kind === 'push' ? 'Pushed' : 'Pulled') : r.err || `${kind} failed`, r.ok ? 2500 : 8000);
    } finally {
      b.disabled = false;
      loadGit();
    }
  };
  $('git-push').onclick = () => remote('push');
  $('git-pull').onclick = () => remote('pull');
  $('git-refresh').onclick = loadGit;
  loaders.git = loadGit;

  // --- New project ------------------------------------------------------------------------------------
  let tplInfo = null;
  let tplChoice = 'empty';
  loaders.new = async () => {
    if (!tplInfo) {
      tplInfo = await wb.templates();
      $('new-root').textContent = tplInfo.root;
      $('new-gh-row').hidden = !tplInfo.gh;
      $('new-templates').replaceChildren(...tplInfo.templates.map((t) => {
        const c = el('div', `tpl${t.id === tplChoice ? ' on' : ''}`);
        c.append(el('b', '', t.label), el('span', '', t.description));
        c.onclick = () => { tplChoice = t.id; for (const x of document.querySelectorAll('.tpl')) x.classList.toggle('on', x === c); };
        return c;
      }));
    }
    $('new-name').focus();
  };
  $('new-create').onclick = async () => {
    $('new-create').disabled = true;
    setStatus('new-status', 'Creating…');
    try {
      const r = await wb.createProject({ name: $('new-name').value, template: tplChoice, git: $('new-git').checked, install: $('new-install').checked, github: $('new-gh').checked });
      if (r.error) return setStatus('new-status', r.error, 'error');
      setStatus('new-status', `Created ${r.dir}. It is open in the widget.${r.notes.length ? ` ${r.notes.join(' ')}` : ''}`, 'ok');
      $('new-name').value = '';
    } finally {
      $('new-create').disabled = false;
    }
  };

  // --- Usage -------------------------------------------------------------------------------------------
  async function loadUsage() {
    $('usage-note').textContent = 'Loading usage (the first run of ccusage can take a minute)…';
    const u = await wb.usage.get({ includeDefault: $('usage-default').checked });
    $('usage-note').textContent = u.note || (u.source === 'ccusage' ? 'Costs from ccusage, at API prices (what the tokens would cost without a subscription).' : '');
    const today = new Date().toISOString().slice(0, 10);
    const daily = u.daily || [];
    const t = daily.find((d) => d.key === today);
    const last30 = daily.slice(-30);
    const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const cards = [
      ['Today', money(t ? t.cost : 0), t ? `${fmtN(t.total)} tokens` : 'no use yet'],
      ['Last 30 days', u.source === 'ccusage' ? money(sum(last30, 'cost')) : fmtN(sum(last30, 'total')), `${fmtN(sum(last30, 'total'))} tokens`],
      ['All time', u.totals && u.totals.cost !== null ? money(u.totals.cost) : fmtN((u.totals || {}).total || 0), `${fmtN((u.totals || {}).total || 0)} tokens`],
      ['Sessions', String((u.sessions || []).length), 'with recorded usage']
    ];
    $('usage-cards').replaceChildren(...cards.map(([k, v, sub]) => { const c = el('div', 'card'); c.append(el('div', 'k', k), el('div', 'v', v), el('div', 'sub', sub)); return c; }));
    const metric = u.source === 'ccusage' ? 'cost' : 'total';
    const max = Math.max(1e-9, ...last30.map((d) => d[metric] || 0));
    $('usage-chart').replaceChildren(...last30.map((d) => {
      const b = el('div', `day${d.key === today ? ' today' : ''}`);
      b.style.height = `${Math.max(2, ((d[metric] || 0) / max) * 100)}%`;
      b.title = `${d.key}: ${metric === 'cost' ? money(d.cost) : ''} ${fmtN(d.total)} tokens\n${d.models.join(', ')}`;
      return b;
    }));
    if (!last30.length) $('usage-chart').appendChild(el('div', 'muted', 'No usage recorded yet.'));
    const sessions = [...(u.sessions || [])].sort((a, b) => String(b.last || '').localeCompare(String(a.last || ''))).slice(0, 100);
    $('usage-sessions').tBodies[0].replaceChildren(...sessions.map((s) => {
      const tr = el('tr');
      const proj = el('td', '', s.project || s.key.slice(0, 8));
      proj.title = s.cwd || s.key;
      tr.append(proj, el('td', '', s.last ? new Date(s.last).toLocaleString() : ''), el('td', 'muted', s.models.map((m) => m.replace(/^claude-/, '')).join(', ')), el('td', 'num', fmtN(s.total)), el('td', 'num', money(s.cost)));
      return tr;
    }));
  }
  let usageLoaded = false;
  loaders.usage = () => { if (!usageLoaded) { usageLoaded = true; loadUsage(); } };
  $('usage-refresh').onclick = loadUsage;
  $('usage-default').onchange = loadUsage;

  // --- System: monitor ------------------------------------------------------------------------------------
  const hist = { cpu: [], mem: [], gpu: [] };
  const HIST = 90;
  function spark(canvas, values, color) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    if (values.length < 2) return;
    const step = w / (HIST - 1);
    const x0 = w - (values.length - 1) * step;
    g.beginPath();
    values.forEach((v, i) => { const x = x0 + i * step; const y = h - (Math.min(100, v) / 100) * (h - 2) - 1; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.stroke();
    g.lineTo(w, h);
    g.lineTo(x0, h);
    g.closePath();
    g.fillStyle = `${color}22`;
    g.fill();
  }
  const level = (pct) => (pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : '');
  const gib = (b) => `${(b / 1073741824).toFixed(1)} GB`;
  wb.sys.onSample((s) => {
    const push = (k, v) => { hist[k].push(v); if (hist[k].length > HIST) hist[k].shift(); };
    push('cpu', s.cpu.pct);
    const memPct = Math.round((s.mem.used / s.mem.total) * 100);
    push('mem', memPct);
    const g = s.gpus[0];
    push('gpu', g ? g.util || 0 : 0);
    if (tab !== 'system') return;
    $('m-cpu').textContent = `${s.cpu.pct}%${s.cpuTemp !== null ? ` · ${Math.round(s.cpuTemp)}°C` : ''}`;
    $('m-cpu').className = `v ${level(s.cpu.pct)}`;
    $('m-cpu-sub').textContent = `${s.cpu.model} · ${s.cpu.count} threads${s.load ? ` · load ${s.load.map((x) => x.toFixed(2)).join(' ')}` : ''}`;
    $('m-cores').replaceChildren(...s.cpu.cores.map((c) => { const i = el('i'); i.style.height = `${Math.max(4, c)}%`; i.title = `${c}%`; return i; }));
    $('m-mem').textContent = `${memPct}%`;
    $('m-mem').className = `v ${level(memPct)}`;
    $('m-mem-sub').textContent = `${gib(s.mem.used)} of ${gib(s.mem.total)}`;
    $('m-gpu').textContent = g ? `${g.util ?? '–'}%${g.temp !== null ? ` · ${g.temp}°C` : ''}` : 'none found';
    $('m-gpu-sub').textContent = g ? `${g.name}${g.memTotal ? ` · VRAM ${(g.memUsed / 1024).toFixed(1)}/${(g.memTotal / 1024).toFixed(1)} GB` : ''}${g.power !== null ? ` · ${g.power.toFixed(0)}${g.powerLimit ? `/${g.powerLimit.toFixed(0)}` : ''} W` : ''}${g.clock ? ` · ${g.clock} MHz` : ''}` : 'nvidia-smi or an AMD GPU needed';
    if (s.disk) {
      const dp = Math.round((s.disk.used / s.disk.total) * 100);
      $('m-disk').textContent = `${dp}%`;
      $('m-disk-bar').style.width = `${dp}%`;
      $('m-disk-bar').style.background = dp >= 90 ? 'var(--red)' : dp >= 75 ? 'var(--amber)' : 'var(--green)';
      $('m-disk-sub').textContent = `${s.disk.path} · ${gib(s.disk.total - s.disk.used)} free of ${gib(s.disk.total)}`;
    }
    $('m-temp-note').textContent = s.cpuTemp === null
      ? (ctx.isWin ? 'CPU temperature: Windows only shares it with administrators or through LibreHardwareMonitor. Run LibreHardwareMonitor (with its WMI provider) and the widget picks it up.' : 'CPU temperature: no hwmon sensor found (k10temp, coretemp, zenpower).')
      : '';
    spark($('c-cpu'), hist.cpu, '#d97757');
    spark($('c-mem'), hist.mem, '#57ab5a');
    spark($('c-gpu'), hist.gpu, '#6cb6ff');
  });

  // --- System: snapshot ---------------------------------------------------------------------------------
  let snapTools = null;
  async function loadSnapshot() {
    snapTools = snapTools || await wb.snapshot.tools();
    $('snap-text').textContent = snapTools.isWin
      ? 'A Windows restore point: registry, drivers, system files and installed programs, restorable from System Restore (or the recovery screen if Windows won\'t start). Asks for administrator approval. Take one before a round of tuning.'
      : snapTools.timeshift ? 'A Timeshift snapshot of the system (asks for your sudo password in a terminal). Restore it from Timeshift, or from a live USB if the system won\'t boot.'
        : snapTools.snapper ? 'A Snapper snapshot (asks for your sudo password in a terminal). Roll back with snapper rollback or from the boot menu if set up.'
          : 'No snapshot tool found. On Arch: sudo pacman -S timeshift (ext4 with rsync, or btrfs). The Changes view still records how to undo each change.';
    $('snap-create').disabled = !snapTools.isWin && !snapTools.timeshift && !snapTools.snapper;
    $('snap-restore').hidden = !snapTools.isWin && !snapTools.timeshift;
    $('snap-restore').textContent = snapTools.isWin ? 'Open System Restore' : 'Open Timeshift';
  }
  $('snap-create').onclick = async () => {
    const r = await wb.snapshot.create();
    if (r.error) setStatus('snap-status', r.error, 'error');
    else setStatus('snap-status', snapTools.isWin ? 'Approve the prompt; the window shows when the restore point is made.' : 'Follow the terminal window.', 'ok');
  };
  $('snap-restore').onclick = () => wb.snapshot.openRestore();

  // --- System: benchmark -----------------------------------------------------------------------------------
  let benchData = null;
  const runLabel = (r) => `${r.label} (${new Date(r.at).toLocaleString()})`;
  async function renderBench() {
    const runs = benchData.runs;
    $('bench-pick').hidden = !runs.length;
    $('bench-table').hidden = !runs.length;
    if (!runs.length) return;
    const opts = (sel, value) => {
      sel.replaceChildren(...[...runs].reverse().map((r) => { const o = el('option', '', runLabel(r)); o.value = r.id; return o; }));
      sel.value = value;
    };
    const a = $('bench-a').value && runs.some((r) => r.id === $('bench-a').value) ? $('bench-a').value : runs[runs.length - 1].id;
    opts($('bench-a'), a);
    opts($('bench-b'), benchData.baseline || runs[0].id);
    const rows = await wb.bench.compare({ runId: $('bench-a').value, baseId: $('bench-b').value });
    $('bench-table').tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = el('tr');
      const v = r.delta === null ? 'same' : Math.abs(r.delta) < 3 ? 'same' : r.delta > 0 ? 'better' : 'worse';
      tr.append(el('td', '', `${r.label}`), el('td', 'num', r.value === null ? '–' : `${fmtN(r.value)} ${r.unit}`), el('td', 'num', r.base === null ? '–' : `${fmtN(r.base)}`),
        el('td', `num ${v}`, r.delta === null || $('bench-a').value === $('bench-b').value ? '' : `${r.delta > 0 ? '+' : ''}${r.delta}%`));
      return tr;
    }));
  }
  $('bench-a').onchange = renderBench;
  $('bench-b').onchange = async () => { benchData = await wb.bench.baseline($('bench-b').value); renderBench(); };
  $('bench-del').onclick = async () => { benchData = await wb.bench.remove($('bench-a').value); $('bench-a').value = ''; renderBench(); };
  wb.bench.onProgress((p) => setStatus('bench-status', `Running: ${p.label}…`));
  $('bench-run').onclick = async () => {
    $('bench-run').disabled = true;
    try {
      const r = await wb.bench.run($('bench-label').value);
      if (r.error) return setStatus('bench-status', r.error, 'error');
      benchData = r.data;
      $('bench-a').value = r.run.id;
      $('bench-label').value = '';
      setStatus('bench-status', 'Done', 'ok');
      renderBench();
    } finally {
      $('bench-run').disabled = false;
    }
  };

  loaders.system = async () => {
    wb.sys.watch(true);
    loadSnapshot();
    if (!benchData) { benchData = await wb.bench.list(); renderBench(); }
  };

  // --- Changes ---------------------------------------------------------------------------------------
  async function loadChanges() {
    const { changes, mode } = await wb.changes.list();
    $('guard-mode').value = mode;
    const list = $('changes-list');
    if (!changes.length) {
      list.replaceChildren(el('div', 'empty', mode === 'off' ? 'The guard is off, so nothing is recorded.' : 'No system changes yet. When Claude changes the registry, services, boot settings, packages and the like, they show up here with a way back.'));
      return;
    }
    list.replaceChildren(...changes.map((c) => {
      const box = el('div', 'change');
      const top = el('div', 'top');
      const stText = c.status === 'applied' ? 'Applied' : c.status === 'undone' ? 'Undo run' : 'Not run (declined or waiting)';
      top.append(el('span', `st ${c.status}`, stText), el('span', 'reasons', c.reasons.join(', ')), el('span', '', `· ${new Date(c.at).toLocaleString()}`),
        el('span', '', c.cwd ? `· ${c.cwd.split(/[\\/]/).filter(Boolean).pop()}` : ''));
      box.appendChild(top);
      box.appendChild(el('pre', '', c.command));
      if (c.undo && c.undo.length) {
        const ul = el('ul');
        for (const s of c.undo) {
          const li = el('li', '', `${s.label} `);
          if (s.admin && c.isWin !== false) li.appendChild(el('span', 'admin', 'admin'));
          li.appendChild(el('br'));
          li.appendChild(el('code', '', s.command));
          ul.appendChild(li);
        }
        box.appendChild(ul);
        const row = el('div', 'row');
        const undo = el('button', c.status === 'undone' ? '' : 'danger', c.status === 'undone' ? 'Run undo again' : 'Undo');
        undo.onclick = async () => {
          const r = await wb.changes.undo(c.id);
          if (r && r.error) toast(r.error, 5000);
          else if (r && r.ok) { toast('Undo is running in a terminal window'); loadChanges(); }
        };
        const copy = el('button', '', 'Copy undo script');
        copy.onclick = () => { wb.changes.copy(c.id); toast('Copied'); };
        row.append(undo, copy);
        box.appendChild(row);
      } else {
        box.appendChild(el('div', 'muted small', 'No automatic undo for this command. A snapshot (System tab) is the way back.'));
      }
      return box;
    }));
  }
  $('guard-mode').onchange = async () => { await wb.changes.setMode($('guard-mode').value); toast('Saved. New and restarted sessions use it.'); loadChanges(); };
  $('changes-refresh').onclick = loadChanges;
  $('changes-dir').onclick = () => wb.changes.openDir();
  loaders.changes = loadChanges;

  // --- Logs ---------------------------------------------------------------------------------------------
  let logEntries = [];
  let followTimer = null;
  async function loadLogs() {
    $('log-count').textContent = 'Loading…';
    const r = await wb.logs.get({ level: $('log-level').value, hours: Number($('log-hours').value) });
    logEntries = r.entries || [];
    renderLogs(r.error);
  }
  function renderLogs(error) {
    const q = $('log-filter').value.trim().toLowerCase();
    const shown = q ? logEntries.filter((e) => `${e.source} ${e.message} ${e.id}`.toLowerCase().includes(q)) : logEntries;
    $('log-count').textContent = error ? error : `${shown.length} entries`;
    $('log-list').replaceChildren(...shown.slice(0, 500).map((e) => {
      const row = el('div', 'log');
      const src = el('div');
      src.append(el('div', 'src', e.source), el('div', 'muted', `${e.log}${e.id !== '' ? ` · ${e.id}` : ''}`));
      const ask = el('button', 'small', 'Ask Claude');
      ask.title = 'Paste this entry into the active Claude session (you press Enter)';
      ask.onclick = async (ev) => {
        ev.stopPropagation();
        const r = await wb.logs.ask(e);
        toast(r && r.error ? r.error : 'Pasted into the Claude session. Review it and press Enter.', 4000);
      };
      const body = el('div');
      body.append(src, el('div', 'msg', e.message));
      row.append(el('div', 't', new Date(e.time).toLocaleString()), el('div', `lv ${e.level}`, e.level), body, ask);
      row.onclick = () => row.classList.toggle('open');
      return row;
    }));
    if (!shown.length && !error) $('log-list').appendChild(el('div', 'empty', 'Nothing in this period. 🎉'));
  }
  $('log-refresh').onclick = loadLogs;
  $('log-level').onchange = loadLogs;
  $('log-hours').onchange = loadLogs;
  $('log-filter').oninput = () => renderLogs();
  $('log-follow').onchange = () => {
    clearInterval(followTimer);
    if ($('log-follow').checked) followTimer = setInterval(() => { if (tab === 'logs') loadLogs(); }, 10000);
  };
  let logsLoaded = false;
  loaders.logs = () => { if (!logsLoaded) { logsLoaded = true; loadLogs(); } };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5') { e.preventDefault(); if (loaders[tab]) (tab === 'usage' ? loadUsage : tab === 'logs' ? loadLogs : tab === 'changes' ? loadChanges : loaders[tab])(); }
  });
  // Coming back to the window: follow the widget's active project, refresh what may have changed.
  window.addEventListener('focus', async () => {
    const c = await wb.context();
    const changed = (c.project && c.project.id) !== (ctx.project && ctx.project.id);
    ctx.project = c.project;
    if (changed) { renderNavProject(); selected = null; }
    if (tab === 'git') loadGit();
    if (tab === 'changes') loadChanges();
  });

  showTab(ctx.tab || 'git');
})();

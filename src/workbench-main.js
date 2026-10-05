// Workbench window (src/workbench): Git, Changes (system change log with undo), System (monitor,
// snapshots, benchmark), Logs, Usage and New project. This file owns the window and its IPC; main.js
// passes in what it needs from the rest of the widget.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { BrowserWindow, dialog, shell, clipboard } = require('electron');
const gitOps = require('./git-ops');
const guard = require('./system-guard');
const bench = require('./bench');
const syslogs = require('./syslogs');
const usage = require('./usage');
const templates = require('./templates');

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

function setupWorkbench(d) {
  const { ipcMain, isWin, userDir, icon, background } = d;
  let win = null;
  // The tab to show first; the page asks for it once it has loaded (wb:context).
  let pendingTab = null;
  const changesDir = d.changesDir;
  const benchPath = path.join(userDir, 'bench.json');

  function open(tab) {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (tab) win.webContents.send('wb:tab', tab);
      return;
    }
    win = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 760,
      minHeight: 480,
      title: 'Workbench',
      backgroundColor: background(),
      autoHideMenuBar: true,
      icon,
      webPreferences: { preload: path.join(__dirname, 'workbench', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    pendingTab = tab || null;
    win.on('closed', () => { win = null; d.sampler.want('workbench', false); });
    win.loadFile(path.join(__dirname, 'workbench', 'workbench.html'));
  }

  const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
  const fromWb = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
  const handle = (ch, fn) => ipcMain.handle(ch, (e, arg) => (fromWb(e) ? fn(arg) : null));
  const on = (ch, fn) => ipcMain.on(ch, (e, arg) => { if (fromWb(e)) fn(arg); });

  // A PowerShell window running script, elevated (UAC) when admin. Encoded, so quoting can't break it.
  function psWindow(script, { admin = false } = {}) {
    const args = ['-NoExit', '-NoProfile', '-EncodedCommand', encode(script)];
    if (!admin) return d.spawnDetached('powershell.exe', args);
    const list = args.map((a) => psq(a)).join(',');
    return d.spawnDetached('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList ${list}`]);
  }

  // --- Context -----------------------------------------------------------------------------------
  handle('wb:context', () => {
    const id = d.activeProject();
    const p = id ? d.projectInfo(id) : null;
    const tab = pendingTab;
    pendingTab = null;
    return { isWin, tab, project: p ? { id, name: p.name, path: p.path } : null, projectsRoot: d.projectsRoot() };
  });

  // --- Git ---------------------------------------------------------------------------------------
  const projectDir = (id) => d.projectPath(id || d.activeProject());
  handle('wb:git:status', async (id) => {
    const dir = projectDir(id);
    if (!dir) return { repo: false, error: 'No project open' };
    const s = await gitOps.status(dir);
    if (s.repo) s.log = await gitOps.log(s.top, 30);
    return s;
  });
  handle('wb:git:diff', ({ top, file, staged }) => gitOps.diffSides(top, file, staged));
  handle('wb:git:stage', ({ top, paths }) => gitOps.stage(top, paths));
  handle('wb:git:unstage', ({ top, paths }) => gitOps.unstage(top, paths));
  handle('wb:git:discard', async ({ top, files }) => {
    const names = files.map((f) => f.path);
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Discard', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Discard changes to ${names.length === 1 ? names[0] : `${names.length} files`}?`,
      detail: files.some((f) => f.untracked) ? 'New (untracked) files are deleted. This can\'t be undone.' : 'This can\'t be undone.'
    });
    if (choice !== 0) return { ok: false, cancelled: true };
    return gitOps.discard(top, files);
  });
  handle('wb:git:commit', ({ top, message, amend, all }) => gitOps.commit(top, message, { amend, all }));
  handle('wb:git:push', async ({ top }) => gitOps.push(top, await gitOps.status(top)));
  handle('wb:git:pull', ({ top }) => gitOps.pull(top));
  handle('wb:git:openFile', ({ top, file }) => d.openEditor(path.join(top, file)));
  // Suggests a commit message by asking Claude (claude -p) about the diff.
  handle('wb:git:suggest', async ({ top }) => {
    const diff = (await gitOps.diffForMessage(top)).slice(0, 60000);
    if (!diff.trim()) return { error: 'Nothing to describe: no changes' };
    const claude = d.findClaude();
    if (!claude) return { error: 'Claude Code is not installed' };
    return new Promise((resolve) => {
      const prompt = 'Write a git commit message for this diff: a short imperative subject line (under 72 characters), then a blank line and a brief body only if it adds something. Output only the message, no code fences.';
      let out = '';
      let err = '';
      // An npm-installed claude is a .cmd file, which only cmd.exe runs; the prompt has no characters cmd treats specially.
      const viaCmd = /\.(cmd|bat)$/i.test(claude);
      const opts = { cwd: top, env: { ...process.env, ...d.claudeEnv() }, windowsHide: true, windowsVerbatimArguments: viaCmd };
      const child = viaCmd
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${claude}" -p "${prompt}""`], opts)
        : spawn(claude, ['-p', prompt], opts);
      const timer = setTimeout(() => child.kill(), 120000);
      child.stdout.on('data', (x) => { out += x; });
      child.stderr.on('data', (x) => { err += x; });
      child.on('error', (e) => { clearTimeout(timer); resolve({ error: e.message }); });
      child.on('close', (code) => {
        clearTimeout(timer);
        const msg = out.trim().replace(/^```\w*\n?|\n?```$/g, '').trim();
        resolve(code === 0 && msg ? { message: msg } : { error: (err.trim().split('\n').pop()) || `claude exited with ${code}` });
      });
      child.stdin.end(diff);
    });
  });

  // --- Changes (system change log) ------------------------------------------------------------------
  const changesFile = () => path.join(changesDir, 'changes.jsonl');
  const readChanges = () => {
    let text = '';
    try { text = fs.readFileSync(changesFile(), 'utf8'); } catch { /* none yet */ }
    return guard.reduceChanges(text.split('\n').filter(Boolean));
  };
  handle('wb:changes:list', () => ({ changes: readChanges(), mode: d.config().guardMode || 'ask', dir: changesDir }));
  handle('wb:changes:undo', async (id) => {
    const c = readChanges().find((x) => x.id === id);
    if (!c || !c.undo || !c.undo.length) return { error: 'Nothing to undo for this change' };
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Run undo', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'Undo this system change?',
      detail: `${c.command}\n\nRuns in a ${c.undo.some((s) => s.admin) && isWin ? 'administrator ' : ''}terminal window:\n${c.undo.map((s) => `• ${s.command}`).join('\n')}`
    });
    if (choice !== 0) return { cancelled: true };
    const script = guard.undoScript(c.undo, isWin);
    const ok = isWin ? await psWindow(script, { admin: c.undo.some((s) => s.admin) }) : await d.runInTerminal(script);
    if (!ok) return { error: 'Could not open a terminal window' };
    fs.appendFileSync(changesFile(), JSON.stringify({ t: 'undo', id, at: Date.now() }) + '\n');
    return { ok: true };
  });
  on('wb:changes:copy', (id) => {
    const c = readChanges().find((x) => x.id === id);
    if (c) clipboard.writeText(guard.undoScript(c.undo || [], isWin));
  });
  on('wb:changes:openDir', () => { fs.mkdirSync(changesDir, { recursive: true }); shell.openPath(changesDir); });
  handle('wb:changes:setMode', (mode) => d.setConfig({ guardMode: mode }));

  // --- System: monitor, snapshots, benchmark ---------------------------------------------------------
  on('wb:sys:watch', (onOff) => d.sampler.want('workbench', !!onOff));
  d.onSample((s) => send('sys:sample', s));

  handle('wb:snapshot:create', async () => {
    const stamp = new Date().toLocaleString();
    if (isWin) {
      // Windows makes one restore point per 24 h unless the frequency limit is lifted, so lift it for this one.
      const script = [
        `$desc = ${psq(`Claude Widget ${stamp}`)}`,
        "$key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore'",
        "$old = (Get-ItemProperty -Path $key -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency",
        "Set-ItemProperty -Path $key -Name SystemRestorePointCreationFrequency -Value 0 -Type DWord",
        "try { Write-Host 'Creating a restore point (this can take a minute)...' -ForegroundColor Cyan; Checkpoint-Computer -Description $desc -RestorePointType MODIFY_SETTINGS -ErrorAction Stop; Write-Host \"Restore point created: $desc\" -ForegroundColor Green }",
        "catch { Write-Host \"Could not create a restore point: $($_.Exception.Message)\" -ForegroundColor Red; Write-Host \"If System Protection is off, turn it on with: Enable-ComputerRestore -Drive 'C:\\'\" }",
        "finally { if ($null -eq $old) { Remove-ItemProperty -Path $key -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $key -Name SystemRestorePointCreationFrequency -Value $old -Type DWord } }"
      ].join('\n');
      return (await psWindow(script, { admin: true })) ? { ok: true, how: 'restore point' } : { error: 'Could not start PowerShell' };
    }
    const tool = d.which('timeshift') ? 'timeshift' : d.which('snapper') ? 'snapper' : null;
    if (!tool) return { error: 'Install Timeshift or Snapper for snapshots (on Arch: sudo pacman -S timeshift)' };
    const cmd = tool === 'timeshift'
      ? `sudo timeshift --create --comments ${sq(`Claude Widget ${stamp}`)} --tags D`
      : `sudo snapper create --description ${sq(`Claude Widget ${stamp}`)}`;
    return (await d.runInTerminal(cmd)) ? { ok: true, how: tool } : { error: 'No terminal found' };
  });
  on('wb:snapshot:openRestore', () => {
    if (isWin) d.spawnDetached('rstrui.exe', []);
    else if (d.which('timeshift-launcher')) d.spawnDetached('timeshift-launcher', []);
    else if (d.which('timeshift-gtk')) d.spawnDetached('timeshift-gtk', []);
  });
  handle('wb:snapshot:tools', () => ({ isWin, timeshift: !isWin && !!d.which('timeshift'), snapper: !isWin && !!d.which('snapper') }));

  const readBench = () => { try { return JSON.parse(fs.readFileSync(benchPath, 'utf8')); } catch { return { runs: [], baseline: null }; } };
  const writeBench = (data) => fs.writeFileSync(benchPath, JSON.stringify(data, null, 2));
  let benchChild = null;
  handle('wb:bench:list', () => readBench());
  handle('wb:bench:run', (label) => new Promise((resolve) => {
    if (benchChild) return resolve({ error: 'A benchmark is already running' });
    const child = spawn(process.execPath, [path.join(__dirname, 'bench-runner.js'), d.benchDir()], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
    benchChild = child;
    let buf = '';
    let result = null;
    let error = null;
    child.stdout.on('data', (x) => {
      buf += x;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.stage) { send('bench:progress', m); d.onBenchProgress(m); }
        if (m.result) result = m.result;
        if (m.error) error = m.error;
      }
    });
    child.on('close', () => {
      benchChild = null;
      d.onBenchProgress({ done: true, failed: !result || !!error });
      if (!result || error) return resolve({ error: error || 'The benchmark stopped early' });
      const data = readBench();
      const run = { id: Date.now().toString(36), at: Date.now(), label: String(label || '').slice(0, 80) || `Run ${data.runs.length + 1}`, results: result };
      data.runs.push(run);
      if (!data.baseline) data.baseline = run.id;
      writeBench(data);
      resolve({ ok: true, run, data });
    });
  }));
  handle('wb:bench:baseline', (id) => { const data = readBench(); data.baseline = id; writeBench(data); return data; });
  handle('wb:bench:delete', (id) => {
    const data = readBench();
    data.runs = data.runs.filter((r) => r.id !== id);
    if (data.baseline === id) data.baseline = data.runs[0] ? data.runs[0].id : null;
    writeBench(data);
    return data;
  });
  handle('wb:bench:compare', ({ runId, baseId }) => {
    const data = readBench();
    return bench.compare(data.runs.find((r) => r.id === runId), data.runs.find((r) => r.id === baseId));
  });

  // --- Logs ---------------------------------------------------------------------------------------
  handle('wb:logs:get', (opts) => syslogs.read({ isWin, ...(opts || {}) }));
  handle('wb:logs:ask', (entry) => d.sendToSession(syslogs.prompt(entry, isWin)));

  // --- Usage --------------------------------------------------------------------------------------
  handle('wb:usage:get', async ({ includeDefault } = {}) => {
    const dirs = [d.claudeDir()];
    const def = path.join(d.home, '.claude');
    if (includeDefault && path.resolve(def) !== path.resolve(dirs[0]) && fs.existsSync(def)) dirs.push(def);
    return usage.load({ dirs, ccusage: d.ccusageCommand(), isWin });
  });

  // --- New project ----------------------------------------------------------------------------------
  handle('wb:templates', () => ({ templates: templates.list(), root: d.projectsRoot(), gh: !!d.which(isWin ? 'gh.exe' : 'gh') }));
  handle('wb:project:create', async ({ name, template, git, install, github }) => {
    if (!templates.validName(name)) return { error: 'Use letters, numbers, spaces, dots, dashes or underscores for the name' };
    const dir = path.join(d.projectsRoot(), name);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) return { error: `${dir} already exists and is not empty` };
    const r = templates.render(template, name);
    if (!r) return { error: 'Unknown template' };
    try {
      for (const [rel, text] of Object.entries(r.files)) {
        const file = path.join(dir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
      }
    } catch (err) {
      return { error: err.message };
    }
    const notes = [];
    if (git) {
      const init = await gitOps.git(dir, ['init', '-b', 'main']);
      if (!init.ok) notes.push(`git init failed: ${init.err}`);
      else {
        await gitOps.git(dir, ['add', '-A']);
        const c = await gitOps.git(dir, ['commit', '-m', 'Initial commit']);
        if (!c.ok) notes.push('Made the repository but not the first commit (set your Git name and email in Settings → Setup).');
      }
    }
    const id = d.addProject(dir);
    const steps = [];
    if (install && r.install) {
      const useUv = r.install === 'uv sync' ? !!d.which(isWin ? 'uv.exe' : 'uv') : true;
      steps.push(useUv ? r.install : r.installFallback[isWin ? 'win' : 'linux']);
    }
    if (git && github) steps.push(`gh repo create ${name.replace(/\s+/g, '-')} --private --source . --push`); // validName allows no shell characters
    if (steps.length) d.startTask(id, { label: install ? 'setup' : 'GitHub', command: steps.join(isWin ? '; ' : ' && ') });
    return { ok: true, dir, notes };
  });

  return { open, close: () => { if (win && !win.isDestroyed()) win.destroy(); } };
}

module.exports = { setupWorkbench };

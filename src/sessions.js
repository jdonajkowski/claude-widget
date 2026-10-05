// One live Claude Code session per opened project: its PTY, worker log tail and statusLine file.
// The only code that touches node-pty; the pty module is passed in so tests can inject a fake.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogTail } = require('./log-tail');
const { isClaudeCommand } = require('./claude-launch');

// Claude Code keeps a folder's history in <config dir>/projects/<cwd with every non-alphanumeric char as '-'>.
function encodeHistoryDir(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

function hasHistory(cwd, claudeDir) {
  try {
    return fs.readdirSync(path.join(claudeDir, 'projects', encodeHistoryDir(cwd))).some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

// The command is config.claudeCommand, else the last shellArgs element (older configs put `claude.cmd`
// there), else `claude`. It replaces the last shellArgs element so the shell prefix stays the user's.
// settingsFile (the widget's hooks and status line, see claude-launch.js) is passed when it is Claude Code.
function buildLaunch({ shell, shellArgs, claudeCommand }, { cont, isWin, settingsFile }) {
  const args = Array.isArray(shellArgs) && shellArgs.length ? shellArgs.slice() : null;
  let command = (typeof claudeCommand === 'string' && claudeCommand.trim()) || (args ? String(args[args.length - 1]) : 'claude');
  if (settingsFile && isClaudeCommand(command)) {
    // Single quotes work in PowerShell and POSIX shells; each escapes a quote its own way.
    const q = isWin ? `'${settingsFile.replace(/'/g, "''")}'` : `'${settingsFile.replace(/'/g, "'\\''")}'`;
    command += ` --settings ${q}`;
  }
  if (cont) command += ' --continue';
  if (args) {
    args[args.length - 1] = command;
    return { file: shell, args };
  }
  return { file: shell, args: isWin ? ['-NoLogo', '-NoExit', '-Command', command] : ['-lc', `${command}; exec $SHELL`] };
}

function sessionDir(userDir, id) {
  return path.join(userDir, 'sessions', crypto.createHash('sha1').update(id).digest('hex').slice(0, 12));
}

// claudeDir: Claude Code's config folder for these sessions; extraEnv: variables added to each session (CLAUDE_CONFIG_DIR).
function createSessions({ pty, config, userDir, home, isWin, send, onStatus = () => {}, settingsFile = () => null,
  claudeDir = () => path.join(home, '.claude'), extraEnv = () => ({}), baseEnv = process.env, tailIntervalMs = 300 }) {
  const sessions = new Map();

  function resetFiles(s) {
    s.tail.reset();
    try { fs.rmSync(s.statusPath, { force: true }); } catch { /* stays stale until the next update */ }
    s.statusMtime = 0;
    s.status = null;
  }

  function spawn(s, cols, rows, cont) {
    const { file, args } = buildLaunch(config, { cont, isWin, settingsFile: settingsFile() });
    try {
      s.term = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: cols || 100,
        rows: rows || 30,
        cwd: s.cwd,
        env: { ...baseEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...extraEnv(), ...config.env, GREMLIN_WORKERS: s.workersPath, GREMLIN_STATUS: s.statusPath },
        useConpty: isWin ? true : undefined
      });
    } catch (err) {
      s.term = null;
      send('pty:data', { id: s.id, data: `\r\n\x1b[31mFailed to start ${file}: ${err.message}\x1b[0m\r\n` });
      send('pty:exit', { id: s.id, code: -1 });
      return;
    }
    const current = s.term;
    current.onData((data) => send('pty:data', { id: s.id, data }));
    current.onExit(({ exitCode }) => {
      if (s.term !== current) return; // replaced by a restart or closed
      s.term = null;
      send('pty:exit', { id: s.id, code: exitCode });
    });
  }

  function kill(s) {
    if (!s.term) return;
    const old = s.term;
    s.term = null;
    try { old.kill(); } catch { /* already gone */ }
  }

  // Starts the project's session the first time it is opened. Returns false if it was already open.
  function open(id, cwd, cols, rows) {
    if (sessions.has(id)) return false;
    const dir = sessionDir(userDir, id);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* spawn still works; workers/footer stay empty */ }
    const s = {
      id,
      cwd,
      term: null,
      workersPath: path.join(dir, 'workers.jsonl'),
      statusPath: path.join(dir, 'status.json'),
      statusMtime: 0,
      status: null
    };
    s.tail = createLogTail(s.workersPath, (events) => send('workers:events', { id, events }), { intervalMs: tailIntervalMs });
    sessions.set(id, s);
    resetFiles(s);
    spawn(s, cols, rows, hasHistory(cwd, claudeDir()));
    return true;
  }

  // Restart (↻ / Enter after exit) starts a fresh conversation: never --continue.
  function restart(id, cols, rows) {
    const s = sessions.get(id);
    if (!s) return false;
    kill(s);
    resetFiles(s);
    spawn(s, cols, rows, false);
    return true;
  }

  function close(id) {
    const s = sessions.get(id);
    if (!s) return false;
    sessions.delete(id);
    kill(s);
    s.tail.close();
    return true;
  }

  function pollStatus() {
    for (const s of sessions.values()) {
      let mtime;
      try { mtime = fs.statSync(s.statusPath).mtimeMs; } catch { continue; }
      if (mtime === s.statusMtime) continue;
      let status;
      try { status = JSON.parse(fs.readFileSync(s.statusPath, 'utf8')); } catch { continue; } // mid-write: next poll
      s.statusMtime = mtime;
      s.status = status;
      send('status:update', { id: s.id, status });
      onStatus(s.id, status);
    }
  }

  return {
    open,
    restart,
    close,
    closeAll: () => { for (const id of [...sessions.keys()]) close(id); },
    write: (id, data) => { const s = sessions.get(id); if (s && s.term) s.term.write(data); },
    resize: (id, cols, rows) => {
      const s = sessions.get(id);
      if (s && s.term && cols > 0 && rows > 0) {
        try { s.term.resize(cols, rows); } catch { /* pty exited */ }
      }
    },
    pollStatus,
    pollWorkers: () => { for (const s of sessions.values()) s.tail.poll(); },
    has: (id) => sessions.has(id),
    cwd: (id) => (sessions.get(id) || {}).cwd,
    status: (id) => (sessions.get(id) || {}).status || null,
    ids: () => [...sessions.keys()]
  };
}

module.exports = { encodeHistoryDir, hasHistory, buildLaunch, sessionDir, createSessions };

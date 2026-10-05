// What each widget session passes to Claude Code with --settings: the widget's hooks (worker rows,
// "needs you" dot) and a statusLine wrapper (footer), so nothing has to be added to ~/.claude/settings.json.
// The hook scripts run on Node when it is on PATH, else on the widget's own runtime (ELECTRON_RUN_AS_NODE),
// so a machine without Node works too.
const fs = require('fs');
const path = require('path');

const HOOK_EVENTS = [
  ['SubagentStart'],
  ['SubagentStop'],
  ['Stop'],
  ['Notification'],
  ['PostToolUse', 'Bash|PowerShell'],
  ['PostToolUse', 'TodoWrite|TaskCreate|TaskUpdate']
];

// First match of any of names in the PATH directories, or null.
function findOnPath(names, { env = process.env, isWin = process.platform === 'win32', exists = fs.existsSync } = {}) {
  const dirs = String(env.PATH || env.Path || '').split(isWin ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    for (const n of names) {
      const p = path.join(dir.replace(/^"|"$/g, ''), n);
      if (exists(p)) return p;
    }
  }
  return null;
}

// Git Bash, which Claude Code uses for hooks and the status line on Windows when it is installed.
function findGitBash({ env = process.env, exists = fs.existsSync } = {}) {
  if (env.CLAUDE_CODE_GIT_BASH_PATH && exists(env.CLAUDE_CODE_GIT_BASH_PATH)) return env.CLAUDE_CODE_GIT_BASH_PATH;
  const git = findOnPath(['git.exe'], { env, isWin: true, exists });
  const candidates = [
    git && path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe')
  ].filter(Boolean);
  return candidates.find((p) => exists(p)) || null;
}

const fwd = (p) => String(p).replace(/\\/g, '/');
const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`; // POSIX single quotes
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`; // PowerShell single quotes

// The user's own status line command, without our wrapper if it is already wrapped.
function unwrapStatus(command) {
  if (typeof command !== 'string' || !command.trim()) return '';
  const m = /statusline-tee\.js["']?\s*(.*)$/s.exec(command);
  return m ? m[1].trim() : command.trim();
}

// One hook entry and the statusLine command for the chosen runtime.
//   node: Node is on PATH; `node "<script>"` reads the same in bash, PowerShell and cmd
//   else: the widget's executable as Node, through bash (Linux, Windows with Git Bash) or PowerShell.
function runtime({ node, execPath, isWin, gitBash }) {
  if (node) {
    return {
      kind: 'node',
      hook: (script) => ({ type: 'command', command: `node "${fwd(script)}"` }),
      status: (tee, user) => `node "${fwd(tee)}"${user ? ` ${user}` : ''}`
    };
  }
  if (!isWin || gitBash) {
    const run = (script, rest = '') => `ELECTRON_RUN_AS_NODE=1 ${sq(fwd(execPath))} ${sq(fwd(script))}${rest}`;
    return {
      kind: 'built-in',
      hook: (script) => ({ type: 'command', command: run(script), ...(isWin ? { shell: 'bash' } : {}) }),
      status: (tee, user) => run(tee, user ? ` ${user}` : '')
    };
  }
  // Windows without Git Bash: PowerShell. It starts slowly, so hooks run in the background (async).
  const ps = (script, rest = '') => `$env:ELECTRON_RUN_AS_NODE='1'; & ${psq(execPath)} ${psq(script)}${rest}`;
  return {
    kind: 'built-in',
    // The guard hook (sync) must finish first: its answer decides whether Claude asks before a command.
    hook: (script, { sync = false } = {}) => ({ type: 'command', shell: 'powershell', ...(sync ? {} : { async: true }), command: ps(script) }),
    // Encoded, so it reaches PowerShell intact whichever shell (cmd, PowerShell, bash) runs the status line.
    // Piping the output makes PowerShell wait for the (GUI-type) widget executable and pass its output on.
    status: (tee, user) => {
      const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${ps(tee, user ? ` ${user}` : '')} | ForEach-Object { $_ }`;
      return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
    }
  };
}

const mentions = (obj, needle) => JSON.stringify(obj || {}).includes(needle);
// Whether global settings already run script for this event and matcher (setups that predate a matcher get it added).
const wired = (global, event, matcher, script) => ((global.hooks || {})[event] || [])
  .some((e) => (e.matcher || '') === (matcher || '') && mentions(e.hooks, script));

// Settings for --settings, or null when ~/.claude/settings.json already wires up all of it (older setup).
// guard: also add hooks/guard-hook.js (system change safety net) before and after Bash/PowerShell commands.
function sessionSettings({ hooksDir, execPath, node, isWin, gitBash, global = {}, guard = true }) {
  const rt = runtime({ node, execPath, isWin, gitBash });
  const out = {};
  const add = (event, matcher, hook) => {
    out.hooks = out.hooks || {};
    const list = out.hooks[event] = out.hooks[event] || [];
    const entry = list.find((e) => e.matcher === matcher);
    if (entry) entry.hooks.push(hook);
    else list.push({ ...(matcher ? { matcher } : {}), hooks: [hook] });
  };
  const hook = rt.hook(path.join(hooksDir, 'workers-hook.js'));
  for (const [event, matcher] of HOOK_EVENTS) if (!wired(global, event, matcher, 'workers-hook.js')) add(event, matcher, hook);
  if (guard && !mentions(global.hooks, 'guard-hook.js')) {
    const script = path.join(hooksDir, 'guard-hook.js');
    add('PreToolUse', 'Bash|PowerShell', rt.hook(script, { sync: true }));
    add('PostToolUse', 'Bash|PowerShell', rt.hook(script));
  }
  const userStatus = global.statusLine && global.statusLine.command;
  if (!mentions(global.statusLine, 'statusline-tee.js')) {
    out.statusLine = { type: 'command', command: rt.status(path.join(hooksDir, 'statusline-tee.js'), unwrapStatus(userStatus)) };
    if (global.statusLine && typeof global.statusLine.padding === 'number') out.statusLine.padding = global.statusLine.padding;
  }
  return Object.keys(out).length ? { settings: out, runtime: rt.kind } : { settings: null, runtime: rt.kind };
}

// Only add --settings when the session command is Claude Code itself.
const isClaudeCommand = (command) => /^\s*(&\s*)?["']?([^"'\s]*[\\/])?claude(\.cmd|\.exe|\.ps1)?["']?(\s|$)/i.test(String(command || ''));

module.exports = { findOnPath, findGitBash, unwrapStatus, runtime, sessionSettings, isClaudeCommand };

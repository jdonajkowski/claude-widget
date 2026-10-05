// Claude Code hook: the widget's safety net for system changes (src/system-guard.js).
// PreToolUse (Bash|PowerShell): when a command changes the system, read the old state (registry values,
// service startup types, sysctl values, files under /etc, ...), write the change and its undo steps to
// CLAUDE_WIDGET_CHANGES/changes.jsonl, and, in "ask" mode, make Claude Code ask before running it.
// PostToolUse: mark the change as run. Outside the widget (no CLAUDE_WIDGET_CHANGES) it does nothing.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const guard = require('../src/system-guard');

const isWin = process.platform === 'win32';

function runCapture(capture, ctx) {
  const opts = { encoding: 'utf8', timeout: 8000, windowsHide: true };
  if (capture.run) {
    const [file, ...args] = capture.run;
    const r = spawnSync(file, args, opts);
    return { ok: r.status === 0, out: String(r.stdout || '') };
  }
  if (capture.ps) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', capture.ps], opts);
    return { ok: r.status === 0, out: String(r.stdout || '') };
  }
  if (capture.backup) {
    if (!fs.existsSync(capture.backup)) return { missing: true };
    const dest = path.join(ctx.backups, `${ctx.id}-${ctx.n++}-${path.basename(capture.backup)}`);
    try {
      fs.copyFileSync(capture.backup, dest);
      return { ok: true, path: dest };
    } catch {
      return { ok: false };
    }
  }
  if (capture.export) {
    const dest = path.join(ctx.backups, `${ctx.id}-${ctx.n++}.reg`);
    const r = spawnSync('reg', ['export', capture.export, dest, '/y'], opts);
    return { ok: r.status === 0, path: dest };
  }
  return null;
}

function handle(p, dir, mode) {
  const cmd = p && p.tool_input && p.tool_input.command;
  if (typeof cmd !== 'string' || !/^(Bash|PowerShell)$/.test(p.tool_name)) return null;
  const { risky, reasons } = guard.classify(cmd, isWin);
  if (!risky) return null;
  const file = path.join(dir, 'changes.jsonl');
  const id = String(p.tool_use_id || crypto.randomBytes(8).toString('hex'));

  if (p.hook_event_name === 'PostToolUse') {
    fs.appendFileSync(file, JSON.stringify({ t: 'ran', id, at: Date.now() }) + '\n');
    return null;
  }
  if (p.hook_event_name !== 'PreToolUse') return null;

  const backups = path.join(dir, 'backups');
  fs.mkdirSync(backups, { recursive: true });
  const ctx = { id: id.replace(/[^\w-]/g, '').slice(-16) || 'x', n: 1, backups };
  const undo = guard.resolveUndo(guard.planUndo(cmd, isWin), (c) => runCapture(c, ctx));
  fs.appendFileSync(file, JSON.stringify({
    t: 'change', id, at: Date.now(), command: cmd, reasons, undo, isWin,
    cwd: p.cwd || process.cwd(), sid: p.session_id || null, project: process.env.CLAUDE_WIDGET_PROJECT || null
  }) + '\n');

  if (mode !== 'ask') return null;
  const n = undo.length;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `System change (${reasons.join(', ')}). ` + (n
        ? `The widget recorded ${n} undo step${n > 1 ? 's' : ''}: Workbench → Changes.`
        : 'No automatic undo for this one; take a snapshot first (Workbench → System) if unsure.')
    }
  };
}

function main() {
  const dir = process.env.CLAUDE_WIDGET_CHANGES;
  const mode = process.env.CLAUDE_WIDGET_GUARD || 'ask';
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    if (!dir || mode === 'off') return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const out = handle(JSON.parse(raw), dir, mode);
      if (out) process.stdout.write(JSON.stringify(out));
    } catch { /* never disturb the session */ }
  });
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  main();
}

module.exports = { handle, runCapture };

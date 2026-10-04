// Claude Code hook that feeds the Claude Widget's worker rows.
// Registered for SubagentStart, SubagentStop, Stop and PostToolUse (Bash|PowerShell).
// Appends JSON lines to the file named by CLAUDE_WIDGET_WORKERS, which only the widget sets.
// Must never block Claude or print into the session: always exits 0, writes nothing to stdout/stderr.
const fs = require('fs');

const LABEL_MAX = 40;
// Where PostToolUse puts a background shell's task id (checked against Claude Code 2.1.289).
const TASK_ID_PATHS = [['tool_response', 'backgroundTaskId']];

const get = (obj, keys) => keys.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

function clip(text) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > LABEL_MAX ? oneLine.slice(0, LABEL_MAX - 1) + '…' : oneLine;
}

function snapshot(p, ts) {
  const tasks = Array.isArray(p.background_tasks) ? p.background_tasks : [];
  return { t: 'snapshot', ids: tasks.map((x) => x && x.id).filter((id) => typeof id === 'string'), ts };
}

function toEvents(p, ts) {
  if (!p || typeof p !== 'object') return [];
  switch (p.hook_event_name) {
    case 'SubagentStart':
      return p.agent_id ? [{ t: 'start', id: p.agent_id, kind: 'agent', label: clip(p.agent_type || 'agent'), ts }] : [];
    case 'SubagentStop':
      return [...(p.agent_id ? [{ t: 'stop', id: p.agent_id, ts }] : []), snapshot(p, ts)];
    case 'Stop':
      return [snapshot(p, ts)];
    case 'PostToolUse': {
      if (!get(p, ['tool_input', 'run_in_background'])) return [];
      const id = TASK_ID_PATHS.map((k) => get(p, k)).find((v) => typeof v === 'string' && v);
      return id ? [{ t: 'start', id, kind: 'shell', label: clip(get(p, ['tool_input', 'command']) || p.tool_name), ts }] : [];
    }
    default:
      return [];
  }
}

function main() {
  const file = process.env.CLAUDE_WIDGET_WORKERS;
  if (!file) return;
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      const events = toEvents(JSON.parse(raw), Date.now());
      if (events.length) fs.appendFileSync(file, events.map((e) => JSON.stringify(e) + '\n').join(''));
    } catch { /* never disturb the session */ }
  });
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  main();
}

module.exports = { toEvents, clip };

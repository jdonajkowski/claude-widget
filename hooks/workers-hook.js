// Claude Code hook that feeds the Claude Widget's worker rows.
// Registered for SubagentStart, SubagentStop, Stop, Notification and PostToolUse (Bash|PowerShell, and
// TodoWrite|TaskCreate|TaskUpdate for the task list progress bar).
// Appends JSON lines to the file named by CLAUDE_WIDGET_WORKERS, which only the widget sets.
// Must never block Claude or print into the session: always exits 0, writes nothing to stdout/stderr.
const fs = require('fs');

const LABEL_MAX = 40;
// Where PostToolUse puts a background shell's task id (checked against Claude Code 2.1.289).
const TASK_ID_PATHS = [['tool_response', 'backgroundTaskId']];
// Notifications that mean Claude is waiting on the user (rail dot: needs you). Claude Code 2.1.289 sends
// notification_type: permission_prompt | elicitation_dialog | idle_prompt | auth_success. idle_prompt follows
// every turn and is covered by the Finished dot, so only these count. Without a type, the message text decides.
const ATTENTION_TYPES = ['permission_prompt', 'elicitation_dialog'];
const ATTENTION_MESSAGE = /permission|needs your (approval|answer)|has a question/i;

const get = (obj, keys) => keys.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

function clip(text) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > LABEL_MAX ? oneLine.slice(0, LABEL_MAX - 1) + '…' : oneLine;
}

function snapshot(p, ts) {
  const tasks = Array.isArray(p.background_tasks) ? p.background_tasks : [];
  return { t: 'snapshot', ids: tasks.map((x) => x && x.id).filter((id) => typeof id === 'string'), ts, src: p.hook_event_name };
}

// Every claude started inside the widget inherits CLAUDE_WIDGET_WORKERS (e.g. a `claude -p` run from Bash),
// so events carry the session id and the reducer only lets a session's snapshots finish its own workers.
function toEvents(p, ts) {
  if (!p || typeof p !== 'object') return [];
  const events = eventsFor(p, ts);
  return typeof p.session_id === 'string' ? events.map((e) => ({ ...e, sid: p.session_id })) : events;
}

// Claude's task list (checked against Claude Code 2.1.289): TaskCreate answers { task: { id, subject } },
// TaskUpdate takes { taskId, status, subject? }, TodoWrite sends the whole list as { todos: [{ content, status }] }.
function taskEvent(p, ts) {
  const input = p.tool_input || {};
  if (p.tool_name === 'TaskCreate') {
    const id = get(p, ['tool_response', 'task', 'id']);
    if (id === undefined || id === null) return null;
    return { t: 'task', id: String(id), subject: clip(get(p, ['tool_response', 'task', 'subject']) || input.subject || ''), status: 'pending', ts };
  }
  if (p.tool_name === 'TaskUpdate') {
    const id = input.taskId ?? get(p, ['tool_response', 'taskId']);
    if (id === undefined || id === null) return null;
    const status = input.status || get(p, ['tool_response', 'statusChange', 'to']);
    return { t: 'task', id: String(id), ...(status ? { status } : {}), ...(input.subject ? { subject: clip(input.subject) } : {}), ts };
  }
  if (p.tool_name === 'TodoWrite' && Array.isArray(input.todos)) {
    const items = input.todos.filter((x) => x && typeof x === 'object')
      .map((x) => ({ subject: clip(x.status === 'in_progress' && x.activeForm ? x.activeForm : x.content || ''), status: String(x.status || 'pending') }));
    return { t: 'todos', items, ts };
  }
  return null;
}

function eventsFor(p, ts) {
  switch (p.hook_event_name) {
    case 'SubagentStart':
      return p.agent_id ? [{ t: 'start', id: p.agent_id, kind: 'agent', label: clip(p.agent_type || 'agent'), ts }] : [];
    case 'SubagentStop':
      return [...(p.agent_id ? [{ t: 'stop', id: p.agent_id, ts }] : []), snapshot(p, ts)];
    case 'Stop':
      return [snapshot(p, ts)];
    case 'Notification': {
      const type = p.notification_type;
      const counted = typeof type === 'string' ? ATTENTION_TYPES.includes(type) : ATTENTION_MESSAGE.test(String(p.message || ''));
      return counted ? [{ t: 'attention', reason: clip(type || p.message), ts }] : [];
    }
    case 'PostToolUse': {
      const task = taskEvent(p, ts);
      if (task) return [task];
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
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    // Outside the widget, stdin is still read to the end so Claude never writes into a closed pipe.
    if (!file) return;
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

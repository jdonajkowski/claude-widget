// Turns the hook event log into the list of worker rows to draw.
// Loaded by the renderer as a plain <script> (window.WidgetWorkers) and by tests via require.
(function (root) {
  const DONE_TTL_MS = 5000;
  // Worker kinds a snapshot may finish. Both are listed in background_tasks under their own id
  // (shell: backgroundTaskId, subagent: agent_id), checked against real payloads in Claude Code 2.1.289.
  // Agents only on Stop snapshots: during a SubagentStop, a parallel foreground agent may not be listed.
  const SNAPSHOT_KINDS = ['shell', 'agent'];
  const SUBAGENT_STOP_KINDS = ['shell'];

  function reduce(events, now) {
    const byId = new Map();
    for (const e of events) {
      if (!e || typeof e !== 'object' || typeof e.ts !== 'number') continue;
      if (e.t === 'start' && typeof e.id === 'string' && !byId.has(e.id)) {
        byId.set(e.id, { id: e.id, kind: e.kind, label: String(e.label ?? e.id), startedAt: e.ts, doneAt: null, sid: e.sid });
      } else if (e.t === 'stop' && byId.has(e.id)) {
        const w = byId.get(e.id);
        if (w.doneAt === null) w.doneAt = e.ts;
      } else if (e.t === 'snapshot' && Array.isArray(e.ids)) {
        const live = new Set(e.ids);
        const kinds = e.src === 'SubagentStop' ? SUBAGENT_STOP_KINDS : SNAPSHOT_KINDS;
        for (const w of byId.values()) {
          if (w.doneAt === null && w.sid === e.sid && kinds.includes(w.kind) && w.startedAt < e.ts && !live.has(w.id)) {
            w.doneAt = e.ts;
          }
        }
      }
    }
    return [...byId.values()]
      .filter((w) => w.doneAt === null || now - w.doneAt <= DONE_TTL_MS)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  // Claude's task list (TaskCreate/TaskUpdate or TodoWrite events) -> { done, total, current, all } or null.
  // Only the newest session's list counts (ids restart in a new session, e.g. after /clear). A finished
  // list stays up for TASKS_DONE_TTL_MS after its last change.
  const TASKS_DONE_TTL_MS = 60000;
  function tasks(events, now) {
    let sid;
    let byId = new Map();
    let todos = null;
    let last = 0;
    for (const e of events) {
      if (!e || typeof e !== 'object' || typeof e.ts !== 'number' || (e.t !== 'task' && e.t !== 'todos')) continue;
      if (e.sid !== sid) { sid = e.sid; byId = new Map(); todos = null; }
      last = e.ts;
      if (e.t === 'todos' && Array.isArray(e.items)) {
        todos = e.items;
      } else if (e.t === 'task' && typeof e.id === 'string') {
        if (e.status === 'deleted') { byId.delete(e.id); continue; }
        const cur = byId.get(e.id) || { subject: '', status: 'pending' };
        byId.set(e.id, { subject: e.subject || cur.subject, status: e.status || cur.status });
      }
    }
    const all = todos || [...byId.values()];
    if (!all.length) return null;
    const done = all.filter((x) => x.status === 'completed').length;
    if (done === all.length && now - last > TASKS_DONE_TTL_MS) return null;
    const active = all.find((x) => x.status === 'in_progress');
    return { done, total: all.length, current: active ? active.subject : null, all };
  }

  const api = { reduce, tasks, DONE_TTL_MS, TASKS_DONE_TTL_MS, SNAPSHOT_KINDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetWorkers = api;
})(this);

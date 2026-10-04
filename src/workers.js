// Turns the hook event log into the list of worker rows to draw.
// Loaded by the renderer as a plain <script> (window.WidgetWorkers) and by tests via require.
(function (root) {
  const DONE_TTL_MS = 5000;
  // Worker kinds a snapshot may finish. Both are listed in background_tasks under their own id
  // (shell: backgroundTaskId, subagent: agent_id), checked against real payloads in Claude Code 2.1.289.
  const SNAPSHOT_KINDS = ['shell', 'agent'];

  function reduce(events, now) {
    const byId = new Map();
    for (const e of events) {
      if (!e || typeof e !== 'object' || typeof e.ts !== 'number') continue;
      if (e.t === 'start' && typeof e.id === 'string' && !byId.has(e.id)) {
        byId.set(e.id, { id: e.id, kind: e.kind, label: String(e.label ?? e.id), startedAt: e.ts, doneAt: null });
      } else if (e.t === 'stop' && byId.has(e.id)) {
        const w = byId.get(e.id);
        if (w.doneAt === null) w.doneAt = e.ts;
      } else if (e.t === 'snapshot' && Array.isArray(e.ids)) {
        const live = new Set(e.ids);
        for (const w of byId.values()) {
          if (w.doneAt === null && SNAPSHOT_KINDS.includes(w.kind) && w.startedAt < e.ts && !live.has(w.id)) {
            w.doneAt = e.ts;
          }
        }
      }
    }
    return [...byId.values()]
      .filter((w) => w.doneAt === null || now - w.doneAt <= DONE_TTL_MS)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  const api = { reduce, DONE_TTL_MS, SNAPSHOT_KINDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetWorkers = api;
})(this);

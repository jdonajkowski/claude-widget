// "Jump to the session that needs me" (Ctrl+Shift+J): sessions waiting on an answer come first, then the ones that
// finished while you were away. Loaded by the renderer as a plain <script> (window.WidgetAttention) and by tests via require.
(function (root) {
  const WEIGHT = { attention: 0, finished: 1 };

  // projects: [{id}] in sidebar order, dotOf(id) -> 'attention' | 'working' | 'finished' | 'idle'.
  // Returns the ids waiting for you, most urgent first (sidebar order within the same kind).
  function waiting(projects, dotOf) {
    return projects
      .map((p, i) => ({ id: p.id, i, w: WEIGHT[dotOf(p.id)] }))
      .filter((x) => x.w !== undefined)
      .sort((a, b) => a.w - b.w || a.i - b.i)
      .map((x) => x.id);
  }

  // The next one to go to: the first waiting session that is not the current one, or null.
  function next(projects, dotOf, activeId) {
    return waiting(projects, dotOf).find((id) => id !== activeId) || null;
  }

  const api = { waiting, next };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetAttention = api;
})(this);

// Saved prompts: reusable text for the Claude prompt, global or tied to one project.
// Stored by main.js as prompts.json: [{id, title, text, project}], project = a project id or null (everywhere).
// Loaded by the renderer as a plain <script> (window.WidgetPrompts) and by main and tests via require.
(function (root) {
  const clean = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').slice(0, max);

  // Drops anything malformed, so a hand-edited file cannot break the palette.
  function normalize(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      const text = clean(p.text, 20000);
      if (!text.trim()) continue;
      let id = clean(p.id, 60) || `p${out.length + 1}-${Date.now().toString(36)}`;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      const title = clean(p.title, 80).trim() || text.trim().split('\n')[0].slice(0, 60);
      out.push({ id, title, text, project: typeof p.project === 'string' && p.project ? p.project : null });
    }
    return out;
  }

  // The prompts to offer in a project: this project's first, then the global ones.
  function visible(list, projectId) {
    return [...list.filter((p) => p.project && p.project === projectId), ...list.filter((p) => !p.project)];
  }

  function add(list, { title, text, project }) {
    const id = `p-${Date.now().toString(36)}-${list.length}`;
    return normalize([...list, { id, title, text, project }]);
  }

  const remove = (list, id) => list.filter((p) => p.id !== id);

  const api = { normalize, visible, add, remove };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetPrompts = api;
})(this);

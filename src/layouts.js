// Saved layouts: a project with other projects' sessions as tabs, some of them in the lower zone
// ("G-Icons above, Gremlin-Desk below"). One entry: { id, name, host, links: [projectId], bottom: [projectId], ratio }.
// Loaded by the renderer as a plain <script> (window.WidgetLayouts) and by tests via require.
(function (root) {
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x))] : []);

  function normalize(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const l of list) {
      if (!l || typeof l !== 'object' || typeof l.host !== 'string' || !l.host) continue;
      const links = ids(l.links).filter((x) => x !== l.host);
      if (!links.length) continue;
      let id = str(l.id, 60) || `l${out.length + 1}`;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      const ratio = Number(l.ratio);
      out.push({
        id,
        name: str(l.name, 60) || 'Layout',
        host: l.host,
        links,
        bottom: ids(l.bottom).filter((x) => links.includes(x)),
        ratio: Number.isFinite(ratio) ? Math.min(0.85, Math.max(0.15, ratio)) : 0.6
      });
    }
    return out;
  }

  // Saves a layout; one with the same name is replaced.
  function add(list, layout) {
    const name = str(layout.name, 60).toLowerCase();
    const rest = list.filter((l) => l.name.toLowerCase() !== name);
    return normalize([...rest, { ...layout, id: `l-${Date.now().toString(36)}-${rest.length}` }]);
  }

  const remove = (list, id) => list.filter((l) => l.id !== id);

  // "G-Icons + Gremlin-Desk (below)" for the palette row. nameOf(projectId) -> display name or undefined.
  function describe(layout, nameOf) {
    const name = (id) => nameOf(id) || id;
    const parts = [name(layout.host), ...layout.links.map((id) => name(id) + (layout.bottom.includes(id) ? ' (below)' : ''))];
    return parts.join(' + ');
  }

  // Splits a layout into what can still be opened (projects that exist) and what has gone.
  function usable(layout, exists) {
    if (!exists(layout.host)) return null;
    const links = layout.links.filter(exists);
    return links.length ? { ...layout, links, bottom: layout.bottom.filter((x) => links.includes(x)) } : null;
  }

  const api = { normalize, add, remove, describe, usable };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetLayouts = api;
})(this);

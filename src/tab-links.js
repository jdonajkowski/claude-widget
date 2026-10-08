// "Open in tab": another project's Claude session shown as a tab of a project. Pure helpers over a plain
// object { [hostProjectId]: [linkedProjectId, ...] }; the renderer owns the terminals and the DOM.
// Loaded by the renderer as a plain <script> (window.WidgetTabLinks) and by tests via require.
(function (root) {
  const empty = () => ({});

  const of = (links, host) => (links && Array.isArray(links[host]) ? links[host] : []);

  // A project cannot be linked to itself; linking twice keeps one tab.
  function add(links, host, id) {
    if (!host || !id || host === id || of(links, host).includes(id)) return links;
    return { ...links, [host]: [...of(links, host), id] };
  }

  function remove(links, host, id) {
    if (!of(links, host).includes(id)) return links;
    const rest = of(links, host).filter((x) => x !== id);
    const next = { ...links };
    if (rest.length) next[host] = rest;
    else delete next[host];
    return next;
  }

  // Drops hosts and links whose project is gone (a deleted or renamed folder).
  function prune(links, projectIds) {
    const known = new Set(projectIds);
    const next = {};
    for (const host of Object.keys(links || {})) {
      if (!known.has(host)) continue;
      const kept = of(links, host).filter((id) => known.has(id) && id !== host);
      if (kept.length) next[host] = kept;
    }
    return next;
  }

  // Saved form: { links, bottom } where bottom lists the linked tabs that sat in the lower zone, per host.
  // Anything malformed (a hand-edited or old value) reads as nothing saved.
  function parse(text) {
    let raw;
    try { raw = JSON.parse(text); } catch { return { links: empty(), bottom: empty() }; }
    const clean = (obj) => {
      const out = {};
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
      for (const [host, ids] of Object.entries(obj)) {
        if (Array.isArray(ids)) {
          const list = [...new Set(ids.filter((x) => typeof x === 'string' && x && x !== host))];
          if (list.length) out[host] = list;
        }
      }
      return out;
    };
    const links = clean(raw && raw.links);
    const bottom = clean(raw && raw.bottom);
    for (const host of Object.keys(bottom)) {
      bottom[host] = bottom[host].filter((id) => of(links, host).includes(id));
      if (!bottom[host].length) delete bottom[host];
    }
    return { links, bottom };
  }

  const stringify = (links, bottom) => JSON.stringify({ links, bottom });

  const api = { empty, of, add, remove, prune, parse, stringify };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetTabLinks = api;
})(this);

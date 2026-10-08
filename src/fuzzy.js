// Fuzzy matching for the project switcher (Ctrl+Shift+P): every typed letter has to appear in order, and
// matches at the start of a word or right after the previous letter score higher.
// Loaded by the renderer as a plain <script> (window.WidgetFuzzy) and by tests via require.
(function (root) {
  const WORD_START = /[\s\-_./\\]/;

  // How well query matches text: -1 when it does not, otherwise higher is better. An empty query matches with 0.
  function score(query, text) {
    const q = String(query || '').toLowerCase().replace(/\s+/g, '');
    const t = String(text || '').toLowerCase();
    if (!q) return 0;
    let from = 0;
    let prev = -2;
    let first = -1;
    let s = 100; // a baseline, so the penalties below never push a real match under 0 (that is "no match")
    for (const ch of q) {
      const at = t.indexOf(ch, from);
      if (at < 0) return -1;
      if (first < 0) first = at;
      s += 1;
      if (at === prev + 1) s += 5; // right after the previous letter
      if (at === 0 || WORD_START.test(t[at - 1])) s += 4; // start of a word
      prev = at;
      from = at + 1;
    }
    if (t.startsWith(q)) s += 10;
    return s - first * 0.5 - (t.length - q.length) * 0.05; // a late start and a long text count against it
  }

  // items sorted best match first; an item matches on its name, or (at half weight) its path. Empty query: unchanged.
  function rank(query, items, name = (x) => x.name, path = (x) => x.path) {
    if (!String(query || '').trim()) return items.slice();
    const scored = [];
    items.forEach((item, i) => {
      const a = score(query, name(item));
      const b = score(query, path(item));
      const best = Math.max(a, b >= 0 ? b * 0.5 : -1);
      if (a >= 0 || b >= 0) scored.push({ item, i, s: best });
    });
    scored.sort((x, y) => y.s - x.s || x.i - y.i);
    return scored.map((x) => x.item);
  }

  const api = { score, rank };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetFuzzy = api;
})(this);

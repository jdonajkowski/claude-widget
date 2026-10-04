// Finds Markdown file paths in a line of terminal text. Paths can contain spaces ("C:\...\Claude Widget\README.md"),
// so each match lists several possible start points, longest first; the main process keeps the first that exists.
// Loaded by the renderer as a plain <script> (window.WidgetMdLinks) and by tests via require.
(function (root) {
  const MAX_CANDIDATES = 8;
  // A path ends at .md/.markdown, optionally followed by :line or :line:col, before a non-word character.
  // A trailing period ends a sentence ("see README.md."); a period plus a letter (foo.md.bak) does not.
  const END = /\.(?:md|markdown)(?::\d+(?::\d+)?)?(?![\w\\/-]|\.\w)/gi;
  // Characters that can never be part of a path we link.
  const STOP = /["'`<>|*?\u2018\u2019\u201c\u201d\[\](){}]/;

  function find(text) {
    const out = [];
    END.lastIndex = 0;
    let m;
    while ((m = END.exec(text))) {
      const suffix = /(?::\d+)+$/.exec(m[0]);
      const end = m.index + m[0].length - (suffix ? suffix[0].length : 0);
      // Walk left to the nearest stop character, the start of the line, or the previous match.
      let left = end;
      const floor = out.length ? out[out.length - 1].end : 0;
      while (left > floor && !STOP.test(text[left - 1])) left--;
      // Every word start (after a space) between there and the file name is a possible path start.
      const starts = [];
      for (let i = left; i < end; i++) {
        if ((i === left || text[i - 1] === ' ') && text[i] !== ' ') starts.push(i);
      }
      const nameStart = Math.max(text.lastIndexOf(' ', m.index) + 1, left);
      const candidates = starts
        .filter((s) => s <= nameStart)
        .slice(-MAX_CANDIDATES)
        .map((s) => ({ start: s, end, path: text.slice(s, end) }))
        .filter((c) => /[\w~]/.test(c.path));
      if (candidates.length) out.push({ end, candidates });
    }
    return out;
  }

  const api = { find };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetMdLinks = api;
})(this);

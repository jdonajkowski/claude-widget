// How a project's git state is shown in the sidebar and the switcher. info: the object from git-status.js
// ({branch, ahead, behind, upstream, changed}) or null (not a repo). Loaded as a plain <script> (window.WidgetGitBadge) and by tests via require.
(function (root) {
  // short: "● ↑2 ↓1" for the narrow sidebar; long: "main  ● 3 changed  ↑2 ↓1" for tooltips and the switcher; dirty: has changes.
  function badge(info) {
    if (!info || !info.branch) return { short: '', long: '', dirty: false };
    const parts = [];
    const sync = [info.ahead ? `↑${info.ahead}` : '', info.behind ? `↓${info.behind}` : ''].filter(Boolean).join(' ');
    const short = [info.changed ? '●' : '', sync].filter(Boolean).join(' ');
    if (info.changed) parts.push(`● ${info.changed} changed`);
    if (sync) parts.push(sync);
    return { short, long: [info.branch, ...parts].join('  '), dirty: info.changed > 0 };
  }

  // Compact comparison key, so only real changes are sent to the window.
  const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

  const api = { badge, same };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetGitBadge = api;
})(this);

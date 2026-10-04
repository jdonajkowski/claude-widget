// Builds the ordered project list for the rail from the folder scan and the saved pinned/hidden lists.
// Pure: main.js does the file I/O and passes the results in.
const path = require('path');

function normId(p, isWin = process.platform === 'win32') {
  const pp = isWin ? path.win32 : path.posix;
  let id = pp.resolve(String(p));
  if (id.length > 1 && /[\\/]$/.test(id) && !/^[a-z]:\\$/i.test(id)) id = id.slice(0, -1);
  return isWin ? id.toLowerCase() : id;
}

// First letters of the first two words. Words split on spaces, - _ . and camelCase.
function initials(name) {
  const words = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function buildList({ scanned, pinned, hidden, exists, isWin = process.platform === 'win32' }) {
  const pp = isWin ? path.win32 : path.posix;
  const strs = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string' && s) : []);
  const hiddenSet = new Set(strs(hidden).map((h) => normId(h, isWin)));
  const byId = new Map();
  const add = (p, isPinned) => {
    const id = normId(p, isWin);
    if (byId.has(id)) return;
    const full = pp.resolve(p);
    byId.set(id, {
      id,
      path: full,
      name: pp.basename(full) || full,
      initials: initials(pp.basename(full) || full),
      pinned: isPinned,
      missing: isPinned && !exists(full)
    });
  };
  for (const p of strs(scanned)) if (!hiddenSet.has(normId(p, isWin))) add(p, false);
  for (const p of strs(pinned)) add(p, true);
  return [...byId.values()].sort((a, b) => {
    const n = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return n || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  });
}

module.exports = { normId, initials, buildList };

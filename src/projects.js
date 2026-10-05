// Builds the ordered project list for the rail from the folder scan and the saved pinned/hidden lists and names.
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

// The name to show for a project: its saved name (Rename… in the row menu), else the folder name.
function displayName(names, id, folder) {
  const n = names && typeof names === 'object' ? names[id] : null;
  return typeof n === 'string' && n.trim() ? n.trim() : folder;
}

// A copy of names with id renamed to name; an empty name goes back to the folder name.
function setName(names, id, name) {
  const next = { ...names };
  const n = String(name || '').trim().slice(0, 80);
  if (n) next[id] = n;
  else delete next[id];
  return next;
}

function buildList({ scanned, pinned, hidden, names, exists, isWin = process.platform === 'win32' }) {
  const pp = isWin ? path.win32 : path.posix;
  const strs = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string' && s) : []);
  const hiddenSet = new Set(strs(hidden).map((h) => normId(h, isWin)));
  const byId = new Map();
  const add = (p, isPinned) => {
    const id = normId(p, isWin);
    if (byId.has(id)) return;
    const full = pp.resolve(p);
    const folder = pp.basename(full) || full;
    const name = displayName(names, id, folder);
    byId.set(id, {
      id,
      path: full,
      name,
      folder,
      initials: initials(name),
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

module.exports = { normId, initials, displayName, setName, buildList };

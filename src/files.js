// Files pane helpers: list one folder of a project, decide how a clicked file opens, and find a
// Markdown file by the tail of its path. Pure apart from the fs calls, so tests can use a temp folder.
const fs = require('fs');
const path = require('path');

// Folders that are never worth browsing (and are often huge).
const IGNORED = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.nuxt', '.cache', 'coverage', '__pycache__', '.venv', 'venv', '.turbo', '.parcel-cache']);

// Double-clicking these in Explorer runs them (a .js file runs under Windows Script Host),
// so the pane shows them in Explorer instead of opening them.
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|mjs|cjs|wsf|wsh|msi|msp|lnk|scr|hta|reg|cpl|jar|pif|application|appref-ms|url|scf|ws)$/i;
const MD = /\.(md|markdown)$/i;

// Resolves rel inside root; null if it would escape the root.
function safeJoin(root, rel = '') {
  const base = path.resolve(root);
  const full = path.resolve(base, String(rel || ''));
  const r = path.relative(base, full);
  if (r === '') return full;
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return full;
}

// Folders first, then files, each alphabetical; ignored folders are left out.
function listDir(root, rel = '') {
  const dir = safeJoin(root, rel);
  if (!dir) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const out = [];
  for (const e of entries) {
    const isDir = e.isDirectory();
    if (!isDir && !e.isFile()) continue;
    if (isDir && IGNORED.has(e.name)) continue;
    out.push({ name: e.name, rel: rel ? `${rel}/${e.name}` : e.name, dir: isDir });
  }
  const cmp = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  return [...out.filter((e) => e.dir).sort(cmp), ...out.filter((e) => !e.dir).sort(cmp)];
}

// 'md' opens in the Markdown viewer, 'reveal' shows it in Explorer, 'open' uses the default app.
function openAction(name) {
  if (MD.test(name)) return 'md';
  if (RUNNABLE.test(name)) return 'reveal';
  return 'open';
}

// Every Markdown file under root (skipping ignored folders), as forward-slash relative paths.
function mdFiles(root, limit = 5000) {
  const out = [];
  const walk = (rel, depth) => {
    if (out.length >= limit || depth > 12) return;
    const list = listDir(root, rel);
    if (!list) return;
    for (const e of list) {
      if (out.length >= limit) return;
      if (e.dir) walk(e.rel, depth + 1);
      else if (MD.test(e.name)) out.push(e.rel);
    }
  };
  walk('', 0);
  return out;
}

// The file whose relative path ends with tail (a bare name or a partial path), shallowest first.
function findByTail(files, tail, caseInsensitive) {
  let t = String(tail).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!t || t.startsWith('/') || /^[A-Za-z]:/.test(t) || t.startsWith('..') || t.startsWith('~')) return null;
  const norm = (s) => (caseInsensitive ? s.toLowerCase() : s);
  t = norm(t);
  const hits = files.filter((f) => { const n = norm(f); return n === t || n.endsWith(`/${t}`); });
  if (!hits.length) return null;
  return hits.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0];
}

module.exports = { IGNORED, safeJoin, listDir, openAction, mdFiles, findByTail };

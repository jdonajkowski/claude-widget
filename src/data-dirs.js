// Where Gremlin keeps its data: everything lives under ~/Projects/.claude (Windows: %USERPROFILE%\Projects).
//   ~/Projects/.claude           Claude Code's config folder for Gremlin sessions (CLAUDE_CONFIG_DIR)
//   ~/Projects/.claude/gremlin   Gremlin's own files (config.json, window state, change log, session files)
// The first run copies what already exists: the folder of the app's old name, Claude Widget
// (~/Projects/.claude/widget, or before 0.3.0 %APPDATA%\Claude Widget), and ~/.claude.
const fs = require('fs');
const path = require('path');

const WIDGET_FILES = ['config.json', 'window-state.json', 'projects.json', 'bench.json'];
// Folders carried over too: the system change log with its undo backups.
const WIDGET_DIRS = ['changes'];
// Not copied from ~/.claude: per-machine scratch, and the sign-in token. Two copies of one OAuth login
// refresh independently and can sign each other out, so widget sessions sign in once on their own.
const SKIP_CLAUDE = new Set(['.credentials.json', 'shell-snapshots', 'session-env', 'telemetry', 'statsig', 'cache', 'ide']);
const MARKER = '.widget-migrated.json';

function layout(home) {
  const root = path.join(home, 'Projects', '.claude');
  return { root, widget: path.join(root, 'gremlin'), legacy: path.join(root, 'widget') };
}

const expandHome = (p, home) => (typeof p === 'string' && /^~(?=$|[\\/])/.test(p) ? path.join(home, p.slice(1)) : p);

// Copies the app's settings files (and change log) once, if the new folder has none yet. Copies, not
// moves, so the old app keeps working until it is uninstalled. Returns the names copied.
function migrateWidgetData(fromDir, toDir) {
  if (!fromDir || path.resolve(fromDir) === path.resolve(toDir)) return [];
  if (fs.existsSync(path.join(toDir, 'config.json'))) return [];
  const copied = [];
  for (const name of WIDGET_FILES) {
    const src = path.join(fromDir, name);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(toDir, { recursive: true });
    fs.copyFileSync(src, path.join(toDir, name));
    copied.push(name);
  }
  if (!copied.length) return copied;
  for (const name of WIDGET_DIRS) {
    const src = path.join(fromDir, name);
    if (!fs.existsSync(src) || fs.existsSync(path.join(toDir, name))) continue;
    fs.cpSync(src, path.join(toDir, name), { recursive: true });
    copied.push(name);
  }
  return copied;
}

// JSON files that store absolute paths into the config folder (plugin install locations).
const PATH_FILES = [path.join('plugins', 'installed_plugins.json'), path.join('plugins', 'known_marketplaces.json')];

function rewritePaths(text, from, to, caseInsensitive) {
  const variants = new Set([from, from.replace(/\\/g, '/')]);
  let out = text;
  for (const v of variants) {
    const target = v.includes('/') && !v.includes('\\') ? to.replace(/\\/g, '/') : to;
    // In JSON a backslash is written twice.
    const pairs = [[v, target], [JSON.stringify(v).slice(1, -1), JSON.stringify(target).slice(1, -1)]];
    for (const [a, b] of pairs) {
      const re = new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseInsensitive ? 'gi' : 'g');
      out = out.replace(re, b.replace(/\$/g, '$$$$'));
    }
  }
  return out;
}

// Copies ~/.claude (and ~/.claude.json) into the widget's Claude folder once. Skipped when that folder
// already has settings or was migrated before. Returns a summary, or null when nothing was done.
function migrateClaudeConfig({ home, to, isWin }) {
  const from = path.join(home, '.claude');
  if (path.resolve(from) === path.resolve(to)) return null;
  if (fs.existsSync(path.join(to, MARKER)) || fs.existsSync(path.join(to, 'settings.json'))) return null;
  if (!fs.existsSync(from)) {
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, MARKER), JSON.stringify({ from: null, at: new Date().toISOString() }, null, 2));
    return null;
  }
  fs.mkdirSync(to, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(from)) {
    if (SKIP_CLAUDE.has(name)) continue;
    const dest = path.join(to, name);
    if (fs.existsSync(dest)) continue; // never overwrite (e.g. the widget folder itself)
    fs.cpSync(path.join(from, name), dest, { recursive: true, errorOnExist: false, force: false });
    copied.push(name);
  }
  // Claude Code keeps account state in ~/.claude.json, or in $CLAUDE_CONFIG_DIR/.claude.json when that is set.
  const state = path.join(home, '.claude.json');
  if (fs.existsSync(state) && !fs.existsSync(path.join(to, '.claude.json'))) {
    fs.copyFileSync(state, path.join(to, '.claude.json'));
    copied.push('.claude.json');
  }
  for (const rel of PATH_FILES) {
    const file = path.join(to, rel);
    try {
      const text = fs.readFileSync(file, 'utf8');
      const next = rewritePaths(text, from, to, isWin);
      if (next !== text) fs.writeFileSync(file, next);
    } catch { /* not there */ }
  }
  fs.writeFileSync(path.join(to, MARKER), JSON.stringify({ from, at: new Date().toISOString(), copied }, null, 2));
  return { from, to, copied };
}

module.exports = { layout, expandHome, migrateWidgetData, migrateClaudeConfig, rewritePaths, MARKER };

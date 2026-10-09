// Usage dashboard: token use and cost per day and per session from ccusage (which prices every model),
// with each session matched to its project folder from Claude Code's transcripts. Without ccusage
// (no Node/npx), tokens are counted from the transcripts directly, without cost.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// One ccusage row (daily or session) in the widget's shape.
function normalizeRow(r) {
  const input = n(r.inputTokens);
  const output = n(r.outputTokens);
  const cacheCreate = n(r.cacheCreationTokens);
  const cacheRead = n(r.cacheReadTokens);
  return {
    key: String(r.period ?? r.date ?? r.sessionId ?? ''),
    input, output, cacheCreate, cacheRead,
    total: n(r.totalTokens) || input + output + cacheCreate + cacheRead,
    cost: typeof r.totalCost === 'number' ? r.totalCost : typeof r.costUSD === 'number' ? r.costUSD : null,
    models: Array.isArray(r.modelsUsed) ? r.modelsUsed : [],
    last: (r.metadata && r.metadata.lastActivity) || r.lastActivity || null
  };
}

// ccusage --json output: { daily: [...] } or { session: [...] } (older versions: { sessions: [...] }).
function normalize(json, kind) {
  const rows = (json && (json[kind] || json[`${kind}s`])) || [];
  return Array.isArray(rows) ? rows.map(normalizeRow) : [];
}

// Session id -> { cwd, name } from <config>/projects/<folder>/<session id>.jsonl, reading each file's
// first lines for the "cwd" Claude Code records.
function sessionProjects(dirs, fsx = fs) {
  const map = new Map();
  for (const dir of dirs) {
    const projects = path.join(dir, 'projects');
    let folders = [];
    try { folders = fsx.readdirSync(projects); } catch { continue; }
    for (const folder of folders) {
      let files = [];
      try { files = fsx.readdirSync(path.join(projects, folder)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of files) {
        const sid = f.slice(0, -6);
        if (map.has(sid)) continue;
        let cwd = null;
        try {
          const fd = fsx.openSync(path.join(projects, folder, f), 'r');
          const buf = Buffer.alloc(16384);
          const len = fsx.readSync(fd, buf, 0, buf.length, 0);
          fsx.closeSync(fd);
          const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString('utf8', 0, len));
          if (m) cwd = JSON.parse(`"${m[1]}"`);
        } catch { /* unreadable: name from the folder */ }
        const name = cwd ? path.basename(cwd) : folder.replace(/^.*?-(?=[^-]+$)/, '');
        map.set(sid, { cwd, name });
      }
    }
  }
  return map;
}

// Fallback without ccusage: tokens per day and per session from the transcripts' usage records,
// counting each API message once (Claude Code can log the same message on several lines).
function scanTranscripts(dirs, fsx = fs) {
  const days = new Map();
  const sessions = new Map();
  const seen = new Set();
  const bump = (map, key, u, ts) => {
    const row = map.get(key) || { key, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0, cost: null, models: [], last: null };
    row.input += n(u.input_tokens);
    row.output += n(u.output_tokens);
    row.cacheCreate += n(u.cache_creation_input_tokens);
    row.cacheRead += n(u.cache_read_input_tokens);
    row.total = row.input + row.output + row.cacheCreate + row.cacheRead;
    if (!row.last || ts > row.last) row.last = ts;
    map.set(key, row);
    return row;
  };
  for (const dir of dirs) {
    const projects = path.join(dir, 'projects');
    let folders = [];
    try { folders = fsx.readdirSync(projects); } catch { continue; }
    for (const folder of folders) {
      let files = [];
      try { files = fsx.readdirSync(path.join(projects, folder)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of files) {
        let text;
        try { text = fsx.readFileSync(path.join(projects, folder, f), 'utf8'); } catch { continue; }
        for (const line of text.split('\n')) {
          if (!line.includes('"usage"')) continue;
          let e;
          try { e = JSON.parse(line); } catch { continue; }
          const msg = e.message;
          if (!msg || !msg.usage || !e.timestamp) continue;
          const id = `${msg.id || ''}:${e.requestId || ''}`;
          if (id !== ':' && seen.has(id)) continue;
          seen.add(id);
          const day = String(e.timestamp).slice(0, 10);
          for (const row of [bump(days, day, msg.usage, e.timestamp), bump(sessions, f.slice(0, -6), msg.usage, e.timestamp)]) {
            if (msg.model && !row.models.includes(msg.model) && !/^<synthetic>$/.test(msg.model)) row.models.push(msg.model);
          }
        }
      }
    }
  }
  const sum = (rows) => rows.reduce((a, r) => ({ input: a.input + r.input, output: a.output + r.output, cacheCreate: a.cacheCreate + r.cacheCreate, cacheRead: a.cacheRead + r.cacheRead, total: a.total + r.total, cost: null }), { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0 });
  const daily = [...days.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  return { daily, sessions: [...sessions.values()], totals: sum(daily) };
}

function runJson(command, args, { env, isWin, timeout = 180000 }) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      // npx is a .cmd file on Windows, which needs a shell; the arguments are fixed strings.
      child = isWin ? spawn([command, ...args].join(' '), { env, windowsHide: true, shell: true }) : spawn(command, args, { env });
    } catch (e) {
      resolve({ error: e.message });
      return;
    }
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try { resolve({ json: JSON.parse(out) }); } catch { resolve({ error: (err || `exit ${code}`).trim().split('\n').pop() }); }
    });
  });
}

// { daily, sessions, totals, source: 'ccusage' | 'transcripts', note }. dirs: Claude config folders.
// ccusage: { file, args } for an installed ccusage, else npx.
async function load({ dirs: all, ccusage, isWin = process.platform === 'win32', env = process.env, fsx = fs }) {
  // ccusage refuses folders without projects/ (no session has run there yet).
  const dirs = all.filter((d) => fsx.existsSync(path.join(d, 'projects')));
  if (!dirs.length) return { source: 'none', note: 'No Claude sessions recorded yet.', daily: [], sessions: [], totals: null };
  const projects = sessionProjects(dirs);
  const withProject = (rows) => rows.map((r) => ({ ...r, project: (projects.get(r.key) || {}).name || null, cwd: (projects.get(r.key) || {}).cwd || null }));
  if (ccusage) {
    const e = { ...env, CLAUDE_CONFIG_DIR: dirs.join(',') };
    const [d, s] = await Promise.all([
      runJson(ccusage.file, [...ccusage.args, 'daily', '--json'], { env: e, isWin }),
      runJson(ccusage.file, [...ccusage.args, 'session', '--json'], { env: e, isWin })
    ]);
    if (d.json) {
      const daily = normalize(d.json, 'daily');
      const totals = d.json.totals ? normalizeRow(d.json.totals) : null;
      return { source: 'ccusage', daily, sessions: withProject(s.json ? normalize(s.json, 'session') : []), totals };
    }
    const local = scanTranscripts(dirs);
    return { source: 'transcripts', note: `ccusage did not run (${d.error}). Showing tokens only.`, ...local, sessions: withProject(local.sessions) };
  }
  const local = scanTranscripts(dirs);
  return { source: 'transcripts', note: 'Install Node.js for costs (ccusage). Showing tokens only.', ...local, sessions: withProject(local.sessions) };
}

// Spend per project: sessions (rows with a cwd) summed by project folder. projects: [{id, path}].
// cost stays null when no session has one (the tokens-only fallback). Folder names compare case-insensitively with / or \.
function byProject(sessions, projects) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const ids = new Map(projects.map((p) => [norm(p.path), p.id]));
  const out = {};
  for (const row of sessions || []) {
    const id = ids.get(norm(row.cwd));
    if (!id) continue;
    const cur = out[id] || { cost: null, tokens: 0, last: null };
    if (typeof row.cost === 'number') cur.cost = (cur.cost || 0) + row.cost;
    cur.tokens += n(row.total);
    if (row.last && (!cur.last || row.last > cur.last)) cur.last = row.last;
    out[id] = cur;
  }
  return out;
}

// "$12.40", "$0.03", or "1.2M tok" when there is no cost.
function formatSpend(x) {
  if (!x) return '';
  if (typeof x.cost === 'number') return "$" + (x.cost >= 100 ? Math.round(x.cost) : x.cost.toFixed(2));
  if (!x.tokens) return '';
  return x.tokens >= 1e6 ? `${(x.tokens / 1e6).toFixed(1)}M tok` : `${Math.round(x.tokens / 1e3)}k tok`;
}

module.exports = { normalizeRow, normalize, sessionProjects, scanTranscripts, load, byProject, formatSpend };

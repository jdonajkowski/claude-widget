// Git panel and worktree sessions: status with staged/unstaged files, the two sides of a diff,
// stage/unstage/discard, commit, push/pull, history, and git worktrees. Parsers are pure; the rest
// runs git with execFile (never a shell), so paths and messages need no quoting.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(cwd, args, { input, timeout = 15000, env } = {}) {
  return new Promise((resolve) => {
    const child = execFile('git', args, {
      cwd, timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...env }
    }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout), err: String(stderr || (err && err.message) || '').trim() }));
    if (input !== undefined) { child.stdin.end(input); }
  });
}

// `git status --porcelain=v2 --branch -z`: branch info and one entry per path.
// Each file: { path, orig, x, y, staged, unstaged, untracked, conflict }. x/y are the index/worktree codes.
function parseStatusV2(out) {
  const info = { branch: null, upstream: null, ahead: 0, behind: 0, oid: null, files: [] };
  const recs = String(out).split('\0');
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r) continue;
    if (r.startsWith('# branch.head ')) { const h = r.slice(14); info.branch = h === '(detached)' ? null : h; continue; }
    if (r.startsWith('# branch.oid ')) { const o = r.slice(13); info.oid = o === '(initial)' ? null : o; continue; }
    if (r.startsWith('# branch.upstream ')) { info.upstream = r.slice(18); continue; }
    if (r.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(r);
      if (m) { info.ahead = Number(m[1]); info.behind = Number(m[2]); }
      continue;
    }
    const kind = r[0];
    if (kind === '?') { info.files.push({ path: r.slice(2), orig: null, x: '?', y: '?', staged: false, unstaged: true, untracked: true, conflict: false }); continue; }
    if (kind === '1' || kind === 'u') {
      const parts = r.split(' ');
      const xy = parts[1];
      const p = parts.slice(kind === '1' ? 8 : 10).join(' ');
      info.files.push(entry(p, null, xy, kind === 'u'));
      continue;
    }
    if (kind === '2') {
      const parts = r.split(' ');
      const p = parts.slice(9).join(' ');
      const orig = recs[++i];
      info.files.push(entry(p, orig, parts[1], false));
    }
  }
  return info;
}

function entry(p, orig, xy, conflict) {
  const x = xy[0];
  const y = xy[1];
  return { path: p, orig, x, y, staged: !conflict && x !== '.', unstaged: conflict || y !== '.', untracked: false, conflict };
}

// One letter for the files pane badge: what changed in the working copy (or index if that is all).
function badge(f) {
  if (f.conflict) return 'U';
  if (f.untracked) return '?';
  const c = f.y !== '.' ? f.y : f.x;
  return { M: 'M', A: 'A', D: 'D', R: 'R', C: 'A', T: 'M' }[c] || 'M';
}

// Badges by path relative to the project folder (the repo may start above it), plus folders that
// contain changes, marked with '•'.
function badgeMap(files, prefix = '') {
  const map = {};
  const pre = prefix.replace(/\\/g, '/');
  for (const f of files) {
    if (pre && !f.path.startsWith(pre)) continue;
    const rel = f.path.slice(pre.length).replace(/\/$/, '');
    if (!rel) continue;
    map[rel] = badge(f);
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!map[dir]) map[dir] = '•';
    }
  }
  return map;
}

// `git log --pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e`
function parseLog(out) {
  return String(out).split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [hash, short, author, at, subject] = r.split('\x1f');
    return { hash, short, author, at: Number(at) * 1000, subject };
  });
}

const LOG_FORMAT = '--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e';
const looksBinary = (s) => s.slice(0, 8000).includes('\0');

async function status(root) {
  const r = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  if (!r.ok) return { repo: false, error: r.err };
  const top = await git(root, ['rev-parse', '--show-toplevel', '--show-prefix']);
  const [toplevel, prefix = ''] = top.out.split('\n');
  return { repo: true, top: toplevel.trim(), prefix: prefix.trim(), ...parseStatusV2(r.out) };
}

// The two sides to show for one file. staged: index vs HEAD; else working copy vs index.
async function diffSides(top, file, staged) {
  const show = async (rev) => { const r = await git(top, ['show', `${rev}:${file.path}`]); return r.ok ? r.out : ''; };
  const working = () => { try { return fs.readFileSync(path.join(top, file.path), 'utf8'); } catch { return ''; } };
  let original;
  let modified;
  if (staged) {
    original = file.x === 'A' ? '' : await show('HEAD');
    modified = file.x === 'D' ? '' : await show('');
  } else {
    original = file.untracked ? '' : await show('');
    if (!original && !file.untracked && file.orig) original = await show('HEAD');
    modified = file.y === 'D' ? '' : working();
  }
  if (looksBinary(original) || looksBinary(modified)) return { binary: true };
  return { original, modified };
}

const stage = (top, paths) => git(top, ['add', '--', ...paths]);
const unstage = (top, paths) => git(top, ['restore', '--staged', '--', ...paths]);
// Tracked files go back to the index version; untracked ones are deleted.
async function discard(top, files) {
  const tracked = files.filter((f) => !f.untracked).map((f) => f.path);
  const untracked = files.filter((f) => f.untracked).map((f) => f.path);
  if (tracked.length) { const r = await git(top, ['restore', '--', ...tracked]); if (!r.ok) return r; }
  if (untracked.length) return git(top, ['clean', '-f', '--', ...untracked]);
  return { ok: true, out: '', err: '' };
}
const commit = (top, message, { amend = false, all = false } = {}) =>
  git(top, ['commit', ...(all ? ['-a'] : []), ...(amend ? ['--amend'] : []), '-F', '-'], { input: message });
async function push(top, info) {
  if (!info.upstream) return git(top, ['push', '-u', 'origin', 'HEAD'], { timeout: 120000 });
  return git(top, ['push'], { timeout: 120000 });
}
const pull = (top) => git(top, ['pull', '--ff-only'], { timeout: 120000 });
const log = async (top, n = 40) => { const r = await git(top, ['log', `-n${n}`, LOG_FORMAT]); return r.ok ? parseLog(r.out) : []; };
// Everything a commit message should describe: staged changes if any, else all changes.
async function diffForMessage(top) {
  const staged = await git(top, ['diff', '--cached', '--stat', '--patch', '--no-color']);
  if (staged.ok && staged.out.trim()) return staged.out;
  const all = await git(top, ['diff', 'HEAD', '--stat', '--patch', '--no-color']);
  return all.ok ? all.out : '';
}

// --- Worktrees ---------------------------------------------------------------------------------------

// A branch name as a folder name: "feature/login" -> "feature-login".
const slug = (s) => String(s).trim().replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);

// The folder for a worktree session: next to the project, so it shows up in the rail as its own project.
const worktreeDir = (projectsRoot, mainName, branch) => path.join(projectsRoot, `${mainName}--${slug(branch)}`);

// Branch names git accepts (a practical subset of check-ref-format).
const validBranch = (b) => /^[\w][\w./-]*$/.test(b) && !/\.\.|\/\/|\.lock$|\/$|\.$|@\{/.test(b);

async function addWorktree(top, dir, branch) {
  const exists = (await git(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok;
  return git(top, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir], { timeout: 60000 });
}
const removeWorktree = (top, dir, force) => git(top, ['worktree', 'remove', ...(force ? ['--force'] : []), dir], { timeout: 60000 });

// For a folder that is a linked worktree (its .git is a file "gitdir: <main>/.git/worktrees/<name>"),
// the main checkout's folder; else null.
function worktreeMain(dir, fsx = fs) {
  let text;
  try { text = fsx.readFileSync(path.join(dir, '.git'), 'utf8'); } catch { return null; }
  const m = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\r\n]+\s*$/m.exec(text);
  return m ? path.resolve(dir, m[1]) : null;
}

module.exports = {
  git, parseStatusV2, badge, badgeMap, parseLog, status, diffSides, stage, unstage, discard, commit, push, pull, log,
  diffForMessage, slug, worktreeDir, validBranch, addWorktree, removeWorktree, worktreeMain, LOG_FORMAT
};

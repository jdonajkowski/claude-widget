const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const g = require('../src/git-ops');

test('parseStatusV2 reads branch, staged, unstaged, renamed, untracked and conflicted files', () => {
  const out = [
    '# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 h1 h2 src/a b.js',
    '1 .M N... 100644 100644 100644 h1 h2 README.md',
    '2 R. N... 100644 100644 100644 h1 h2 R100 new.js', 'old.js',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt',
    '? notes/todo.md', ''
  ].join('\0');
  const s = g.parseStatusV2(out);
  assert.equal(s.branch, 'main');
  assert.equal(s.upstream, 'origin/main');
  assert.deepEqual([s.ahead, s.behind], [2, 1]);
  assert.deepEqual(s.files.map((f) => [f.path, f.orig, f.staged, f.unstaged, g.badge(f)]), [
    ['src/a b.js', null, true, false, 'M'],
    ['README.md', null, false, true, 'M'],
    ['new.js', 'old.js', true, false, 'R'],
    ['conflict.txt', null, false, true, 'U'],
    ['notes/todo.md', null, false, true, '?']
  ]);
});

test('badgeMap is relative to the project and marks parent folders', () => {
  const files = g.parseStatusV2(['1 .M N... 1 1 1 a b app/src/x.js', '? app/new.txt', '1 .M N... 1 1 1 a b other/y.js', ''].join('\0')).files;
  assert.deepEqual(g.badgeMap(files, 'app/'), { 'src/x.js': 'M', src: '•', 'new.txt': '?' });
});

test('parseLog splits the record and unit separators', () => {
  const out = 'h1\x1fa1\x1fAda\x1f1700000000\x1ffirst\x1e\nh2\x1fa2\x1fBob\x1f1700000100\x1fsecond: x\x1e';
  assert.deepEqual(g.parseLog(out), [
    { hash: 'h1', short: 'a1', author: 'Ada', at: 1700000000000, subject: 'first' },
    { hash: 'h2', short: 'a2', author: 'Bob', at: 1700000100000, subject: 'second: x' }
  ]);
});

test('worktree names and folders', () => {
  assert.equal(g.slug('feature/login page'), 'feature-login-page');
  assert.equal(g.worktreeDir('/P', 'app', 'fix/x'), path.join('/P', 'app--fix-x'));
  for (const b of ['main', 'feature/x', 'v1.2-fix']) assert.equal(g.validBranch(b), true, b);
  for (const b of ['', '-x', 'a..b', 'a/', 'x.lock', 'a b', 'a@{1}']) assert.equal(g.validBranch(b), false, b);
});

test('worktreeMain reads a linked worktree\'s .git file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  assert.equal(g.worktreeMain(dir), null);
  const main = path.join(dir, 'main');
  fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${main}/.git/worktrees/feature\n`);
  assert.equal(g.worktreeMain(dir), path.resolve(main));
});

test('status, stage, commit and diffSides against a real repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  const env = ['-c', 'user.name=T', '-c', 'user.email=t@x'];
  await g.git(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  await g.git(dir, ['add', '.']);
  await g.git(dir, [...env, 'commit', '-qm', 'init']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'new\n');
  let s = await g.status(dir);
  assert.equal(s.repo, true);
  assert.deepEqual(s.files.map((f) => [f.path, g.badge(f)]), [['a.txt', 'M'], ['b.txt', '?']]);
  assert.deepEqual(await g.diffSides(s.top, s.files[0], false), { original: 'one\n', modified: 'two\n' });
  await g.stage(s.top, ['a.txt']);
  s = await g.status(dir);
  assert.equal(s.files[0].staged, true);
  assert.deepEqual(await g.diffSides(s.top, s.files[0], true), { original: 'one\n', modified: 'two\n' });
  const c = await g.git(dir, [...env, 'commit', '-F', '-'], { input: 'second\n\nbody' });
  assert.equal(c.ok, true, c.err);
  assert.equal((await g.log(dir))[0].subject, 'second');
  await g.discard(dir, [{ path: 'b.txt', untracked: true }]);
  assert.equal(fs.existsSync(path.join(dir, 'b.txt')), false);
  assert.equal((await g.status(os.tmpdir())).repo, false);
});

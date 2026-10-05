const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nameError, renameWithRetry, moveHistory } = require('../src/project-rename');
const { encodeHistoryDir } = require('../src/sessions');

test('nameError accepts ordinary names and explains bad ones', () => {
  for (const n of ['Gremlin', 'gremlin-desk', 'My Project 2', 'a.b']) assert.equal(nameError(n, true), null, n);
  assert.match(nameError('', true), /Enter/);
  assert.match(nameError('a/b', true), /can't contain/);
  assert.match(nameError('what?', true), /can't contain/);
  assert.match(nameError('name.', true), /dot/);
  assert.match(nameError('CON', true), /Windows/);
  assert.match(nameError('nul.txt', true), /Windows/);
  assert.equal(nameError('what?', false), null);
  assert.match(nameError('a/b', false), /can't contain/);
  assert.match(nameError('..', false), /valid/);
});

test('renameWithRetry retries while the folder is busy, and gives up on other errors', async () => {
  let calls = 0;
  const busyTwice = async () => { calls++; if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
  assert.equal(await renameWithRetry('a', 'b', { rename: busyTwice, delayMs: 1 }), null);
  assert.equal(calls, 3);

  calls = 0;
  const missing = async () => { calls++; throw Object.assign(new Error('gone'), { code: 'ENOENT' }); };
  assert.equal((await renameWithRetry('a', 'b', { rename: missing, delayMs: 1 })).code, 'ENOENT');
  assert.equal(calls, 1);

  const alwaysBusy = async () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }); };
  assert.equal((await renameWithRetry('a', 'b', { rename: alwaysBusy, tries: 3, delayMs: 1 })).code, 'EPERM');
});

test('moveHistory moves the history folder, or merges into an existing one', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-'));
  const from = path.join(cfg, 'work', 'Old Name');
  const to = path.join(cfg, 'work', 'New Name');
  const h = (p) => path.join(cfg, 'projects', encodeHistoryDir(p));
  fs.mkdirSync(path.join(h(from), 'memory'), { recursive: true });
  fs.writeFileSync(path.join(h(from), 'a.jsonl'), 'old');
  fs.writeFileSync(path.join(h(from), 'memory', 'm.md'), 'note');

  moveHistory(cfg, from, to, { isWin: false });
  assert.equal(fs.existsSync(h(from)), false);
  assert.equal(fs.readFileSync(path.join(h(to), 'a.jsonl'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(h(to), 'memory', 'm.md'), 'utf8'), 'note');

  // Back again into a folder that already has some history: only what is missing moves.
  fs.mkdirSync(path.join(h(from), 'memory'), { recursive: true });
  fs.writeFileSync(path.join(h(from), 'a.jsonl'), 'kept');
  fs.writeFileSync(path.join(h(from), 'memory', 'other.md'), 'x');
  moveHistory(cfg, to, from, { isWin: false });
  assert.equal(fs.readFileSync(path.join(h(from), 'a.jsonl'), 'utf8'), 'kept');
  assert.deepEqual(fs.readdirSync(path.join(h(from), 'memory')).sort(), ['m.md', 'other.md']);

  // No history: nothing to do.
  moveHistory(cfg, path.join(cfg, 'none'), to, { isWin: false });
  fs.rmSync(cfg, { recursive: true, force: true });
});

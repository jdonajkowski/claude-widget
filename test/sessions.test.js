const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encodeHistoryDir, hasHistory, buildLaunch, sessionDir, createSessions } = require('../src/sessions');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sess-'));

function fakePty() {
  const spawned = [];
  return {
    spawned,
    spawn(file, args, opts) {
      const t = { file, args, opts, written: [], killed: false, resized: null, dataCb: null, exitCb: null };
      t.onData = (cb) => { t.dataCb = cb; };
      t.onExit = (cb) => { t.exitCb = cb; };
      t.write = (d) => t.written.push(d);
      t.resize = (c, r) => { t.resized = [c, r]; };
      t.kill = () => { t.killed = true; };
      spawned.push(t);
      return t;
    }
  };
}

function setup(configOver = {}) {
  const home = tmp();
  const userDir = tmp();
  const sent = [];
  const pty = fakePty();
  const config = { shell: 'powershell.exe', shellArgs: ['-NoLogo', '-NoExit', '-Command', 'claude.cmd'], env: { A: '1' }, ...configOver };
  const m = createSessions({ pty, config, userDir, home, isWin: true, send: (c, p) => sent.push([c, p]), baseEnv: {}, tailIntervalMs: 0 });
  return { home, userDir, sent, pty, m };
}

test('encodeHistoryDir replaces every non-alphanumeric char', () => {
  assert.equal(encodeHistoryDir('C:\\Users\\jacob\\Projects'), 'C--Users-jacob-Projects');
  assert.equal(encodeHistoryDir('C:\\a b\\café.x'), 'C--a-b-caf--x');
});

test('hasHistory needs a *.jsonl in the encoded dir', () => {
  const home = tmp();
  const dir = path.join(home, '.claude', 'projects', 'C--p-foo');
  assert.equal(hasHistory('C:\\p\\foo', home), false);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory.md'), '');
  assert.equal(hasHistory('C:\\p\\foo', home), false);
  fs.writeFileSync(path.join(dir, 'abc.jsonl'), '');
  assert.equal(hasHistory('C:\\p\\foo', home), true);
});

test('buildLaunch: claudeCommand wins, else last shellArgs element, else claude', () => {
  const sa = ['-NoLogo', '-NoExit', '-Command', 'claude.cmd'];
  assert.deepEqual(buildLaunch({ shell: 'pwsh', shellArgs: sa }, { cont: true, isWin: true }),
    { file: 'pwsh', args: ['-NoLogo', '-NoExit', '-Command', 'claude.cmd --continue'] });
  assert.deepEqual(buildLaunch({ shell: 'pwsh', shellArgs: sa, claudeCommand: 'claude --model x' }, { cont: false, isWin: true }).args[3], 'claude --model x');
  assert.deepEqual(buildLaunch({ shell: 'powershell.exe' }, { cont: false, isWin: true }).args, ['-NoLogo', '-NoExit', '-Command', 'claude']);
  assert.deepEqual(buildLaunch({ shell: 'bash' }, { cont: true, isWin: false }).args, ['-lc', 'claude --continue; exec $SHELL']);
  assert.deepEqual(sa[3], 'claude.cmd', 'config array is not mutated');
});

test('sessionDir is stable and per id', () => {
  const a = sessionDir('U', 'c:\\p\\a');
  assert.equal(a, sessionDir('U', 'c:\\p\\a'));
  assert.notEqual(a, sessionDir('U', 'c:\\p\\b'));
  assert.match(path.basename(a), /^[0-9a-f]{12}$/);
});

test('open spawns once with per-session env and cwd; --continue only with history', () => {
  const { home, pty, m } = setup();
  const cwd = 'C:\\p\\with history';
  fs.mkdirSync(path.join(home, '.claude', 'projects', encodeHistoryDir(cwd)), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', encodeHistoryDir(cwd), 's.jsonl'), '');
  assert.equal(m.open('a', cwd, 80, 24), true);
  assert.equal(m.open('a', cwd, 80, 24), false);
  assert.equal(m.open('b', 'C:\\p\\fresh', 80, 24), true);
  assert.equal(pty.spawned.length, 2);
  const [a, b] = pty.spawned;
  assert.equal(a.args[3], 'claude.cmd --continue');
  assert.equal(b.args[3], 'claude.cmd');
  assert.equal(a.opts.cwd, cwd);
  assert.equal(a.opts.env.A, '1');
  assert.notEqual(a.opts.env.CLAUDE_WIDGET_WORKERS, b.opts.env.CLAUDE_WIDGET_WORKERS);
  assert.notEqual(a.opts.env.CLAUDE_WIDGET_STATUS, b.opts.env.CLAUDE_WIDGET_STATUS);
  assert.deepEqual(m.ids(), ['a', 'b']);
});

test('data, exit, write and resize are routed by id', () => {
  const { sent, pty, m } = setup();
  m.open('a', 'C:\\a', 80, 24);
  m.open('b', 'C:\\b', 80, 24);
  const [a, b] = pty.spawned;
  b.dataCb('hi');
  m.write('a', 'x');
  m.resize('b', 100, 40);
  m.resize('b', 0, 40);
  assert.deepEqual(a.written, ['x']);
  assert.deepEqual(b.resized, [100, 40]);
  a.exitCb({ exitCode: 3 });
  assert.deepEqual(sent.filter(([c]) => c.startsWith('pty:')), [['pty:data', { id: 'b', data: 'hi' }], ['pty:exit', { id: 'a', code: 3 }]]);
  assert.equal(m.has('a'), true, 'an exited session stays open until closed');
});

test('restart kills, never continues, and ignores the old pty exit', () => {
  const { home, sent, pty, m } = setup();
  const cwd = 'C:\\h';
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'C--h'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'C--h', 's.jsonl'), '');
  m.open('a', cwd, 80, 24);
  m.restart('a', 90, 30);
  const [first, second] = pty.spawned;
  assert.equal(first.killed, true);
  assert.equal(second.args[3], 'claude.cmd');
  assert.equal(second.opts.cols, 90);
  first.exitCb({ exitCode: 0 });
  assert.equal(sent.filter(([c]) => c === 'pty:exit').length, 0);
  assert.equal(m.restart('nope'), false);
});

test('close kills and forgets; closeAll closes everything', () => {
  const { pty, m } = setup();
  m.open('a', 'C:\\a');
  m.open('b', 'C:\\b');
  assert.equal(m.close('a'), true);
  assert.equal(pty.spawned[0].killed, true);
  assert.equal(m.has('a'), false);
  assert.equal(m.close('a'), false);
  m.closeAll();
  assert.equal(pty.spawned[1].killed, true);
  assert.deepEqual(m.ids(), []);
});

test('workers log and status file are per session', () => {
  const { sent, pty, m } = setup();
  m.open('a', 'C:\\a');
  m.open('b', 'C:\\b');
  const env = pty.spawned[1].opts.env;
  fs.appendFileSync(env.CLAUDE_WIDGET_WORKERS, JSON.stringify({ t: 'attention', ts: 1 }) + '\n');
  fs.writeFileSync(env.CLAUDE_WIDGET_STATUS, JSON.stringify({ model: { id: 'm' } }));
  m.pollWorkers();
  m.pollStatus();
  m.pollStatus();
  assert.deepEqual(sent.filter(([c]) => c === 'workers:events'), [['workers:events', { id: 'b', events: [{ t: 'attention', ts: 1 }] }]]);
  assert.deepEqual(sent.filter(([c]) => c === 'status:update'), [['status:update', { id: 'b', status: { model: { id: 'm' } } }]]);
  assert.deepEqual(m.status('b'), { model: { id: 'm' } });
});

test('a spawn failure reports an exit for that session', () => {
  const { sent, m } = setup();
  const bad = createSessions({ pty: { spawn() { throw new Error('nope'); } }, config: { shell: 'x' }, userDir: tmp(), home: tmp(), isWin: true, send: (c, p) => sent.push([c, p]), baseEnv: {}, tailIntervalMs: 0 });
  bad.open('a', 'C:\\a');
  assert.deepEqual(sent.map(([c]) => c), ['pty:data', 'pty:exit']);
  bad.write('a', 'x');
  assert.ok(m);
});

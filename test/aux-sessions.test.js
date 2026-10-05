const test = require('node:test');
const assert = require('node:assert/strict');
const { createAux } = require('../src/aux-sessions');
const { elevateCommand } = require('../src/admin-shell');

function fakePty() {
  const spawned = [];
  return {
    spawned,
    spawn(file, args, opts) {
      const t = { file, args, opts, written: [], killed: false, data: [], exit: [] };
      t.write = (d) => t.written.push(d);
      t.resize = () => {};
      t.kill = () => { t.killed = true; };
      t.onData = (cb) => t.data.push(cb);
      t.onExit = (cb) => t.exit.push(cb);
      spawned.push(t);
      return t;
    }
  };
}

test('a task tab relays output, finds the dev server URL once, and reports its exit', () => {
  const pty = fakePty();
  const sent = [];
  const urls = [];
  const aux = createAux({ pty, isWin: true, send: (ch, p) => sent.push([ch, p]), onUrl: (a, url) => urls.push([a.id, url]) });
  const id = aux.open({ projectId: 'p', cwd: 'C:\p', title: 'npm run dev', kind: 'task', launch: { file: 'powershell.exe', args: ['-Command', 'npm run dev'] }, env: {} }, 80, 24);
  assert.equal(id, 'aux:1');
  const t = pty.spawned[0];
  t.data.forEach((cb) => cb('  Local:   http://localhost:'));
  t.data.forEach((cb) => cb('5173/\r\n'));
  t.data.forEach((cb) => cb('http://localhost:9999/'));
  assert.deepEqual(urls, [['aux:1', 'http://localhost:5173/']]);
  const { startedAt, ...listed } = aux.list()[0];
  assert.deepEqual(listed, { id: 'aux:1', projectId: 'p', title: 'npm run dev', kind: 'task', running: true, exitCode: null, endedAt: null });
  assert.equal(typeof startedAt, 'number');
  t.exit.forEach((cb) => cb({ exitCode: 0 }));
  assert.deepEqual(sent.at(-1), ['pty:exit', { id: 'aux:1', code: 0 }]);
  assert.equal(aux.list()[0].running, false);
  assert.equal(aux.list()[0].exitCode, 0);
  assert.equal(typeof aux.list()[0].endedAt, 'number');
});

test('restart replaces the PTY; closing a project closes its tabs', () => {
  const pty = fakePty();
  const aux = createAux({ pty, isWin: false, send: () => {} });
  const a = aux.open({ projectId: 'p', cwd: '/p', title: 'sh', kind: 'shell', launch: { file: 'bash', args: [] }, env: {} });
  aux.open({ projectId: 'q', cwd: '/q', title: 'sh', kind: 'shell', launch: { file: 'bash', args: [] }, env: {} });
  aux.restart(a, 80, 24);
  assert.equal(pty.spawned[0].killed, true);
  assert.equal(pty.spawned.length, 3);
  aux.closeProject('p');
  assert.deepEqual(aux.list().map((x) => x.projectId), ['q']);
});

test('elevated tabs go through startElevated', () => {
  const calls = [];
  const aux = createAux({ pty: fakePty(), isWin: true, send: () => {}, startElevated: (o) => { calls.push(o); return { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }; } });
  aux.open({ projectId: 'p', cwd: 'C:\\p', title: 'Admin', kind: 'admin', launch: { file: 'powershell.exe', args: [] }, env: { A: '1' }, elevated: true }, 90, 30);
  assert.deepEqual(calls, [{ launch: { file: 'powershell.exe', args: [] }, cwd: 'C:\\p', env: { A: '1' }, cols: 90, rows: 30 }]);
});

test('elevateCommand asks UAC for a hidden PowerShell that starts the helper', () => {
  const cmd = elevateCommand({ execPath: "C:\\App\\Claude Widget's.exe", helper: 'C:\\App\\src\\admin-helper.js', pipe: '\\\\.\\pipe\\x', token: 't0k' });
  assert.match(cmd, /^Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden /);
  const b64 = /'-EncodedCommand','([^']+)'/.exec(cmd)[1];
  assert.equal(Buffer.from(b64, 'base64').toString('utf16le'),
    "$env:ELECTRON_RUN_AS_NODE='1'; & 'C:\\App\\Claude Widget''s.exe' 'C:\\App\\src\\admin-helper.js' '\\\\.\\pipe\\x' 't0k'");
});

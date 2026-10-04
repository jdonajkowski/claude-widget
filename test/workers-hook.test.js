const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { toEvents } = require('../hooks/workers-hook');

const HOOK = path.join(__dirname, '..', 'hooks', 'workers-hook.js');
const tmpLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-')), 'workers.jsonl');
const run = (payload, env) => spawnSync(process.execPath, [HOOK], { input: payload, env: { ...process.env, ...env }, encoding: 'utf8' });
const readLines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('SubagentStart -> start agent', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' }, 5),
    [{ t: 'start', id: 'ag1', kind: 'agent', label: 'Explore', ts: 5 }]);
});

test('SubagentStop -> stop + snapshot', () => {
  const ev = toEvents({ hook_event_name: 'SubagentStop', agent_id: 'ag1', background_tasks: [{ id: 'b1', type: 'shell' }] }, 7);
  assert.deepEqual(ev, [{ t: 'stop', id: 'ag1', ts: 7 }, { t: 'snapshot', ids: ['b1'], ts: 7 }]);
});

test('Stop -> snapshot (empty when no background_tasks)', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'Stop' }, 9), [{ t: 'snapshot', ids: [], ts: 9 }]);
});

test('PostToolUse background Bash -> start shell with clipped one-line label', () => {
  const cmd = 'cat <<EOF > x\nhello\nEOF && npm run build -- --watch --verbose --extra-long-flag';
  const ev = toEvents({
    hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: cmd, run_in_background: true },
    tool_response: { backgroundTaskId: 'bt1' }
  }, 11);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].t, 'start');
  assert.equal(ev[0].id, 'bt1');
  assert.equal(ev[0].kind, 'shell');
  assert.ok(ev[0].label.length <= 40, `label too long: ${ev[0].label.length}`);
  assert.ok(!/\n/.test(ev[0].label));
  assert.ok(ev[0].label.startsWith('cat <<EOF > x hello EOF'));
});

test('PostToolUse foreground or without task id -> nothing', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} }, 1), []);
  assert.deepEqual(toEvents({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls', run_in_background: true }, tool_response: {} }, 1), []);
});

test('unknown events and garbage -> nothing', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'UserPromptSubmit' }, 1), []);
  assert.deepEqual(toEvents(null, 1), []);
});

test('script appends lines when env var is set, prints nothing, exits 0', () => {
  const log = tmpLog();
  const r = run(JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' }), { CLAUDE_WIDGET_WORKERS: log });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(readLines(log)[0].id, 'ag1');
});

test('script does nothing without the env var', () => {
  const env = { ...process.env };
  delete env.CLAUDE_WIDGET_WORKERS;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop' }), env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('script survives empty and garbage stdin', () => {
  const log = tmpLog();
  for (const input of ['', 'not json', '{"hook_event_name":']) {
    const r = run(input, { CLAUDE_WIDGET_WORKERS: log });
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, '');
  }
  assert.equal(fs.existsSync(log), false);
});

test('script survives an unwritable log path', () => {
  const r = run(JSON.stringify({ hook_event_name: 'Stop' }), { CLAUDE_WIDGET_WORKERS: path.join(os.tmpdir(), 'no-such-dir-cw', 'x', 'workers.jsonl') });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
});

test('concurrent hooks write intact lines', async () => {
  const log = tmpLog();
  const N = 8;
  await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_WIDGET_WORKERS: log } });
    p.on('exit', resolve);
    p.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: `ag${i}`, agent_type: 'Explore' }));
  })));
  const ids = readLines(log).map((e) => e.id).sort();
  assert.deepEqual(ids, Array.from({ length: N }, (_, i) => `ag${i}`).sort());
});

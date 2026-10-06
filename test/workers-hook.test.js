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
  assert.deepEqual(ev, [{ t: 'stop', id: 'ag1', ts: 7 }, { t: 'snapshot', ids: ['b1'], tasks: [{ id: 'b1', kind: 'shell', status: '', label: 'shell' }], ts: 7, src: 'SubagentStop' }]);
});

test('Stop -> snapshot (empty when no background_tasks)', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'Stop' }, 9), [{ t: 'snapshot', ids: [], tasks: [], ts: 9, src: 'Stop' }]);
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
  const r = run(JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' }), { GREMLIN_WORKERS: log });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(readLines(log)[0].id, 'ag1');
});

test('script does nothing without the env var', () => {
  const env = { ...process.env };
  delete env.GREMLIN_WORKERS;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop' }), env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('script survives empty and garbage stdin', () => {
  const log = tmpLog();
  for (const input of ['', 'not json', '{"hook_event_name":']) {
    const r = run(input, { GREMLIN_WORKERS: log });
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, '');
  }
  assert.equal(fs.existsSync(log), false);
});

test('script survives an unwritable log path', () => {
  const r = run(JSON.stringify({ hook_event_name: 'Stop' }), { GREMLIN_WORKERS: path.join(os.tmpdir(), 'no-such-dir-cw', 'x', 'workers.jsonl') });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
});

test('concurrent hooks write intact lines', async () => {
  const log = tmpLog();
  const N = 8;
  await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK], { env: { ...process.env, GREMLIN_WORKERS: log } });
    p.on('exit', resolve);
    p.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: `ag${i}`, agent_type: 'Explore' }));
  })));
  const ids = readLines(log).map((e) => e.id).sort();
  assert.deepEqual(ids, Array.from({ length: N }, (_, i) => `ag${i}`).sort());
});

test('events carry the session id, and snapshots their source hook', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'SubagentStart', session_id: 'S1', agent_id: 'ag1', agent_type: 'Explore' }, 5),
    [{ t: 'start', id: 'ag1', kind: 'agent', label: 'Explore', ts: 5, sid: 'S1' }]);
  assert.deepEqual(toEvents({ hook_event_name: 'Stop', session_id: 'S1' }, 9), [{ t: 'snapshot', ids: [], tasks: [], ts: 9, src: 'Stop', sid: 'S1' }]);
});

test('script outside the widget still consumes a large stdin cleanly', () => {
  const env = { ...process.env };
  delete env.GREMLIN_WORKERS;
  const big = JSON.stringify({ hook_event_name: 'PostToolUse', tool_response: { stdout: 'x'.repeat(4 * 1024 * 1024) } });
  const r = spawnSync(process.execPath, [HOOK], { input: big, env, encoding: 'utf8' });
  assert.equal(r.error, undefined);
  assert.equal(r.status, 0);
});

test('task tools become task events', () => {
  const base = { hook_event_name: 'PostToolUse', session_id: 's' };
  assert.deepEqual(toEvents({ ...base, tool_name: 'TaskCreate', tool_input: { subject: 'alpha' }, tool_response: { task: { id: '1', subject: 'alpha' } } }, 5),
    [{ t: 'task', id: '1', subject: 'alpha', status: 'pending', ts: 5, sid: 's' }]);
  assert.deepEqual(toEvents({ ...base, tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: { success: true } }, 6),
    [{ t: 'task', id: '1', status: 'completed', ts: 6, sid: 's' }]);
  assert.deepEqual(toEvents({ ...base, tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Fix it', activeForm: 'Fixing it', status: 'in_progress' }, { content: 'Test', status: 'pending' }] } }, 7),
    [{ t: 'todos', items: [{ subject: 'Fixing it', status: 'in_progress' }, { subject: 'Test', status: 'pending' }], ts: 7, sid: 's' }]);
});

test('every tool call logs start and end by tool_use_id, also when it fails', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: {} }, 5), [{ t: 'tool', phase: 'start', id: 'toolu_1', ts: 5 }]);
  assert.deepEqual(toEvents({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: {}, tool_response: {} }, 6), [{ t: 'tool', phase: 'end', id: 'toolu_1', ts: 6 }]);
  assert.deepEqual(toEvents({ hook_event_name: 'PostToolUseFailure', tool_name: 'Read', tool_use_id: 'toolu_2', error: 'x' }, 7), [{ t: 'tool', phase: 'end', id: 'toolu_2', ts: 7 }]);
  assert.deepEqual(toEvents({ hook_event_name: 'PreToolUse', tool_name: 'Read' }, 5), []);
});

test('PostToolUse logs the tool end before a background shell start or task change', () => {
  const shell = toEvents({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_3', tool_input: { command: 'npm run dev', run_in_background: true }, tool_response: { backgroundTaskId: 'b1' } }, 8);
  assert.deepEqual(shell.map((e) => e.t), ['tool', 'start']);
  const task = toEvents({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_use_id: 'toolu_4', tool_input: { taskId: '1', status: 'completed' } }, 9);
  assert.deepEqual(task.map((e) => e.t), ['tool', 'task']);
});

test('snapshot carries Claude task details; Ctrl+B-backgrounded commands start a row too', () => {
  const [s] = toEvents({ hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'ping -n 25 127.0.0.1', command: 'ping -n 25 127.0.0.1' }, null, { type: 'x' }] }, 4);
  assert.deepEqual(s, { t: 'snapshot', ids: ['b1'], tasks: [{ id: 'b1', kind: 'shell', status: 'running', label: 'ping -n 25 127.0.0.1' }], ts: 4, src: 'Stop' });
  const ev = toEvents({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm run dev' }, tool_response: { backgroundTaskId: 'b2' } }, 5);
  assert.deepEqual(ev, [{ t: 'start', id: 'b2', kind: 'shell', label: 'npm run dev', ts: 5 }]);
});

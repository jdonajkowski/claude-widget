const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handle } = require('../hooks/guard-hook');

const isWin = process.platform === 'win32';
// A change with an undo step that needs no capture, on either system.
const risky = isWin ? 'Disable-ScheduledTask -TaskName Foo' : 'sudo ufw enable';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
const read = (dir) => fs.readFileSync(path.join(dir, 'changes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('ordinary commands pass through without a log entry', () => {
  const dir = tmp();
  assert.equal(handle({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }, dir, 'ask'), null);
  assert.equal(fs.existsSync(path.join(dir, 'changes.jsonl')), false);
});

test('a system change is logged with its undo and asks first', () => {
  const dir = tmp();
  const out = handle({ hook_event_name: 'PreToolUse', tool_name: isWin ? 'PowerShell' : 'Bash', tool_use_id: 'toolu_1', session_id: 's1', tool_input: { command: risky } }, dir, 'ask');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /recorded 1 undo step/);
  const [entry] = read(dir);
  assert.equal(entry.t, 'change');
  assert.equal(entry.id, 'toolu_1');
  assert.equal(entry.undo.length, 1);
  handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: risky } }, dir, 'ask');
  assert.deepEqual(read(dir).map((e) => e.t), ['change', 'ran']);
});

test('log mode records without asking', () => {
  const dir = tmp();
  assert.equal(handle({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't', tool_input: { command: risky } }, dir, 'log'), null);
  assert.equal(read(dir).length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLogTail } = require('../src/log-tail');

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-tail-')), 'workers.jsonl');
  const got = [];
  const tail = createLogTail(file, (evs) => got.push(...evs), { intervalMs: 0 }); // 0 = no timer; tests call poll()
  tail.reset();
  return { file, got, tail };
}

test('emits appended complete lines once', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, '{"t":"start","id":"a"}\n{"t":"stop","id":"a"}\n');
  tail.poll();
  tail.poll();
  assert.deepEqual(got.map((e) => e.t), ['start', 'stop']);
  tail.close();
});

test('holds a partial line until it completes', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, '{"t":"start",');
  tail.poll();
  assert.equal(got.length, 0);
  fs.appendFileSync(file, '"id":"a"}\n');
  tail.poll();
  assert.deepEqual(got, [{ t: 'start', id: 'a' }]);
  tail.close();
});

test('skips lines that are not JSON', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, 'garbage\n{"t":"stop","id":"a"}\n\n');
  tail.poll();
  assert.deepEqual(got, [{ t: 'stop', id: 'a' }]);
  tail.close();
});

test('reset truncates and later appends are still read', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, '{"n":1}\n');
  tail.poll();
  tail.reset();
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  fs.appendFileSync(file, '{"n":2}\n');
  tail.poll();
  assert.deepEqual(got.map((e) => e.n), [1, 2]);
  tail.close();
});

test('external truncation is detected and the file re-read from the start', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, '{"n":1}\n{"n":2}\n');
  tail.poll();
  fs.writeFileSync(file, '{"n":3}\n');
  tail.poll();
  assert.deepEqual(got.map((e) => e.n), [1, 2, 3]);
  tail.close();
});

test('missing file is not an error', () => {
  const { file, got, tail } = setup();
  fs.rmSync(file);
  assert.doesNotThrow(() => tail.poll());
  assert.equal(got.length, 0);
  tail.close();
});

test('multibyte characters split across reads survive', () => {
  const { file, got, tail } = setup();
  const line = Buffer.from('{"label":"ünïcødé…"}\n', 'utf8');
  fs.appendFileSync(file, line.subarray(0, 12));
  tail.poll();
  fs.appendFileSync(file, line.subarray(12));
  tail.poll();
  assert.deepEqual(got, [{ label: 'ünïcødé…' }]);
  tail.close();
});

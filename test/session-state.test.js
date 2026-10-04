const test = require('node:test');
const assert = require('node:assert/strict');
const { initial, apply, dot } = require('../src/session-state');

const run = (events, isActive = false) => events.reduce((s, e) => apply(s, e, isActive), initial());

test('starts idle', () => assert.equal(dot(initial()), 'idle'));

test('OSC 9;4 states 1-4 mean working, 0 ends it', () => {
  for (const state of [1, 2, 3, 4]) assert.equal(dot(run([{ t: 'progress', state }], true)), 'working');
  assert.equal(dot(run([{ t: 'progress', state: 3 }, { t: 'progress', state: 0 }], true)), 'idle');
});

test('working -> idle while not active is Finished; switching to it clears', () => {
  const s = run([{ t: 'progress', state: 3 }, { t: 'progress', state: 0 }], false);
  assert.equal(dot(s), 'finished');
  assert.equal(dot(apply(s, { t: 'activate' }, true)), 'idle');
});

test('the active project never enters Finished', () => {
  assert.equal(dot(run([{ t: 'progress', state: 3 }, { t: 'progress', state: 0 }], true)), 'idle');
});

test('progress 0 without a turn does not mark Finished', () => {
  assert.equal(dot(run([{ t: 'progress', state: 0 }], false)), 'idle');
});

test('attention beats working; input or a new turn clears it', () => {
  const s = run([{ t: 'progress', state: 3 }, { t: 'attention' }]);
  assert.equal(dot(s), 'attention');
  assert.equal(dot(apply(s, { t: 'input' }, false)), 'working');
  const idleAttn = run([{ t: 'attention' }]);
  assert.equal(dot(apply(idleAttn, { t: 'progress', state: 3 }, false)), 'working');
});

test('attention beats finished, working beats finished', () => {
  const fin = run([{ t: 'progress', state: 3 }, { t: 'progress', state: 0 }]);
  assert.equal(dot(apply(fin, { t: 'attention' }, false)), 'attention');
  assert.equal(dot(apply(fin, { t: 'progress', state: 3 }, false)), 'working');
});

test('activate does not clear attention', () => {
  assert.equal(dot(apply(run([{ t: 'attention' }]), { t: 'activate' }, true)), 'attention');
});

test('exit clears working and attention; start resets everything', () => {
  const s = run([{ t: 'progress', state: 3 }, { t: 'attention' }, { t: 'exit' }]);
  assert.equal(dot(s), 'idle');
  assert.equal(s.exited, true);
  const r = apply(s, { t: 'start' }, true);
  assert.deepEqual(r, initial());
});

test('unknown events leave state unchanged', () => {
  const s = initial();
  assert.equal(apply(s, { t: 'bogus' }, false), s);
  assert.equal(apply(s, null, false), s);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { initial, apply, dot, isTyping } = require('../src/session-state');

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

test('isTyping: keys and pastes count; focus, mouse and query replies do not', () => {
  for (const d of ['y', '1', '\r', '\x7f', '\x1b[A', '\x1b[B', '\x1b[200~text\x1b[201~', '\x03']) assert.equal(isTyping(d), true, JSON.stringify(d));
  const automatic = [
    '\x1b[I', '\x1b[O', // focus in / out
    '\x1b[<35;10;5M', '\x1b[<0;10;5m', '\x1b[<35;10;5M\x1b[<35;11;5M', // SGR mouse motion, release, a burst
    '\x1b[M #!', // X10 mouse
    '\x1bP>|xterm.js(6.0.0)\x1b\\', // XTVERSION reply
    '\x1b]11;rgb:1f1f/1e1e/1d1d\x07', // OSC colour reply
    '\x1b[?0u', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[12;40R', '\x1b[?997;1n' // kitty flags, DA1, DA2, cursor position, colour scheme
  ];
  for (const d of automatic) assert.equal(isTyping(d), false, JSON.stringify(d));
  assert.equal(isTyping('\x1b[<35;10;5My'), true); // a key mixed in still counts
});

test('a question stays until real input or the end of the turn', () => {
  let s = apply(initial(), { t: 'progress', state: 3 }, true);
  s = apply(s, { t: 'attention' }, true);
  assert.equal(dot(s), 'attention');
  s = apply(s, { t: 'progress', state: 0 }, true);
  assert.equal(s.attention, false);
});
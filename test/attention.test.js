const test = require('node:test');
const assert = require('node:assert/strict');
const { waiting, next } = require('../src/attention');

const projects = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const dots = (map) => (id) => map[id] || 'idle';

test('waiting: needs-you sessions come before finished ones, sidebar order within each', () => {
  const d = dots({ a: 'finished', b: 'working', c: 'attention', d: 'finished' });
  assert.deepEqual(waiting(projects, d), ['c', 'a', 'd']);
});

test('waiting: nothing waits when everything is idle or working', () => {
  assert.deepEqual(waiting(projects, dots({ a: 'working' })), []);
});

test('next: skips the session you are already in', () => {
  const d = dots({ a: 'attention', c: 'attention' });
  assert.equal(next(projects, d, 'a'), 'c');
  assert.equal(next(projects, d, 'b'), 'a');
});

test('next: null when only the current session is waiting, or none are', () => {
  assert.equal(next(projects, dots({ a: 'attention' }), 'a'), null);
  assert.equal(next(projects, dots({}), 'a'), null);
});

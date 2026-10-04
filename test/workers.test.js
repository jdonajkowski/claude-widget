const test = require('node:test');
const assert = require('node:assert/strict');
const { reduce, DONE_TTL_MS } = require('../src/workers');

const start = (id, kind, ts, label = id) => ({ t: 'start', id, kind, label, ts });

test('start creates a running worker', () => {
  const w = reduce([start('a1', 'agent', 1000, 'Explore')], 2000);
  assert.deepEqual(w, [{ id: 'a1', kind: 'agent', label: 'Explore', startedAt: 1000, doneAt: null }]);
});

test('stop marks the worker done', () => {
  const w = reduce([start('a1', 'agent', 1000), { t: 'stop', id: 'a1', ts: 3000 }], 3500);
  assert.equal(w[0].doneAt, 3000);
});

test('done workers drop out after DONE_TTL_MS', () => {
  const ev = [start('a1', 'agent', 1000), { t: 'stop', id: 'a1', ts: 3000 }];
  assert.equal(reduce(ev, 3000 + DONE_TTL_MS).length, 1);
  assert.equal(reduce(ev, 3000 + DONE_TTL_MS + 1).length, 0);
});

test('snapshot finishes shells it no longer lists', () => {
  const ev = [start('s1', 'shell', 1000), start('s2', 'shell', 1100), { t: 'snapshot', ids: ['s2'], ts: 5000 }];
  const w = reduce(ev, 5000);
  assert.equal(w.find((x) => x.id === 's1').doneAt, 5000);
  assert.equal(w.find((x) => x.id === 's2').doneAt, null);
});

test('snapshot finishes agents it no longer lists (lost SubagentStop guard)', () => {
  const ev = [start('a1', 'agent', 1000), start('a2', 'agent', 1100), { t: 'snapshot', ids: ['a2'], ts: 5000 }];
  const w = reduce(ev, 5000);
  assert.equal(w.find((x) => x.id === 'a1').doneAt, 5000);
  assert.equal(w.find((x) => x.id === 'a2').doneAt, null);
});

test('snapshot older than a shell start does not finish it', () => {
  const ev = [{ t: 'snapshot', ids: [], ts: 900 }, start('s1', 'shell', 1000)];
  assert.equal(reduce(ev, 1200)[0].doneAt, null);
});

test('snapshot taken before start but logged after it does not finish it', () => {
  const ev = [start('s1', 'shell', 1000), { t: 'snapshot', ids: [], ts: 900 }];
  assert.equal(reduce(ev, 1200)[0].doneAt, null);
});

test('snapshot does not finish already-done workers again', () => {
  const ev = [start('s1', 'shell', 1000), { t: 'snapshot', ids: [], ts: 2000 }, { t: 'snapshot', ids: [], ts: 4000 }];
  assert.equal(reduce(ev, 4000)[0].doneAt, 2000);
});

test('duplicate start is ignored', () => {
  const ev = [start('a1', 'agent', 1000, 'first'), start('a1', 'agent', 2000, 'second')];
  const w = reduce(ev, 2500);
  assert.equal(w.length, 1);
  assert.equal(w[0].label, 'first');
});

test('stop for an unknown id is ignored', () => {
  assert.deepEqual(reduce([{ t: 'stop', id: 'nope', ts: 1 }], 2), []);
});

test('malformed events are skipped', () => {
  const ev = [null, 42, { t: 'start' }, { t: 'snapshot', ids: 'x', ts: 1 }, start('a1', 'agent', 1000)];
  assert.equal(reduce(ev, 1500).length, 1);
});

test('workers are ordered by start time', () => {
  const ev = [start('b', 'shell', 2000), start('a', 'agent', 1000)];
  assert.deepEqual(reduce(ev, 3000).map((w) => w.id), ['a', 'b']);
});

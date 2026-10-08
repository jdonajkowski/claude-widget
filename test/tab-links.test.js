const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/tab-links');
const rail = require('../src/rail-width');

test('add links a project once and never to itself', () => {
  let l = L.add({}, 'a', 'b');
  assert.deepEqual(l, { a: ['b'] });
  assert.equal(L.add(l, 'a', 'b'), l);
  assert.equal(L.add(l, 'a', 'a'), l);
  assert.deepEqual(L.add(l, 'a', 'c'), { a: ['b', 'c'] });
  assert.deepEqual(L.add(l, 'b', 'a'), { a: ['b'], b: ['a'] });
});

test('remove drops the link and an empty host; add and remove leave their input alone', () => {
  const l = Object.freeze({ a: Object.freeze(['b', 'c']) });
  assert.deepEqual(L.remove(l, 'a', 'b'), { a: ['c'] });
  assert.deepEqual(L.remove({ a: ['b'] }, 'a', 'b'), {});
  assert.equal(L.remove(l, 'a', 'zzz'), l);
  assert.deepEqual(l, { a: ['b', 'c'] });
});

test('prune forgets hosts and links whose project is gone', () => {
  assert.deepEqual(L.prune({ a: ['b', 'x'], y: ['a'], b: ['b'] }, ['a', 'b']), { a: ['b'] });
  assert.deepEqual(L.prune(null, ['a']), {});
});

test('parse reads what stringify saved and treats junk as nothing saved', () => {
  const text = L.stringify({ a: ['b', 'c'] }, { a: ['c'] });
  assert.deepEqual(L.parse(text), { links: { a: ['b', 'c'] }, bottom: { a: ['c'] } });
  const none = { links: {}, bottom: {} };
  for (const bad of [null, '', 'not json', '[]', '{"links":5}', '{"links":{"a":"b"}}']) assert.deepEqual(L.parse(bad), none, String(bad));
});

test('parse drops duplicates, self links and bottom tabs that are not linked', () => {
  const r = L.parse('{"links":{"a":["b","b","a",3]},"bottom":{"a":["b","q"],"z":["b"]}}');
  assert.deepEqual(r, { links: { a: ['b'] }, bottom: { a: ['b'] } });
});

test('rail width: clamped to 120-400, junk falls back to 170', () => {
  assert.equal(rail.clamp(50), 120);
  assert.equal(rail.clamp(9999), 400);
  assert.equal(rail.clamp(200.4), 200);
  for (const bad of [undefined, null, 'x', NaN]) assert.equal(rail.clamp(bad), 170, String(bad));
});

test('rail width: the terminal keeps its minimum, and the rail never goes under 120', () => {
  assert.equal(rail.cap(300, 1000, 320), 300);
  assert.equal(rail.cap(400, 600, 320), 280);
  assert.equal(rail.cap(300, 400, 320), 120);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/layouts');

test('normalize: needs a host and at least one other project; bottom must be linked; ratio is clamped', () => {
  const out = L.normalize([
    { id: 'a', name: 'Two up', host: 'h', links: ['x', 'x', 'h', 'y'], bottom: ['y', 'zzz'], ratio: 5 },
    { id: 'b', name: 'none', host: 'h', links: [] },
    { name: 'no host', links: ['x'] },
    null
  ]);
  assert.deepEqual(out, [{ id: 'a', name: 'Two up', host: 'h', links: ['x', 'y'], bottom: ['y'], ratio: 0.85 }]);
  assert.deepEqual(L.normalize('x'), []);
});

test('add replaces a layout with the same name (case-insensitive); remove', () => {
  let list = L.add([], { name: 'Work', host: 'h', links: ['x'], bottom: [], ratio: 0.5 });
  list = L.add(list, { name: 'work', host: 'h', links: ['y'], bottom: ['y'], ratio: 0.7 });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].links, ['y']);
  assert.deepEqual(L.remove(list, list[0].id), []);
});

test('describe lists the host, then the linked projects with the lower ones marked', () => {
  const l = { host: 'a', links: ['b', 'c'], bottom: ['c'] };
  assert.equal(L.describe(l, (id) => ({ a: 'G-Icons', b: 'Tune', c: 'Gremlin' })[id]), 'G-Icons + Tune + Gremlin (below)');
});

test('usable: drops projects that are gone; null when the host or every link is gone', () => {
  const l = { id: 'a', name: 'n', host: 'h', links: ['x', 'y'], bottom: ['y'], ratio: 0.6 };
  assert.deepEqual(L.usable(l, (id) => id !== 'y').links, ['x']);
  assert.deepEqual(L.usable(l, (id) => id !== 'y').bottom, []);
  assert.equal(L.usable(l, (id) => id !== 'h'), null);
  assert.equal(L.usable(l, (id) => id === 'h'), null);
});

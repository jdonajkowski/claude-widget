const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/prompts');

test('normalize: keeps good entries, drops empty or malformed ones, derives a title', () => {
  const out = P.normalize([{ id: 'a', title: 'Tests', text: 'run the tests' }, null, 5, { id: 'b', text: '   ' }, { id: 'c', text: 'first line\nsecond' }]);
  assert.deepEqual(out.map((p) => [p.id, p.title, p.project]), [['a', 'Tests', null], ['c', 'first line', null]]);
  assert.deepEqual(P.normalize('nope'), []);
});

test('normalize: duplicate ids are made unique', () => {
  const out = P.normalize([{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }]);
  assert.equal(new Set(out.map((p) => p.id)).size, 2);
});

test('visible: this project first, other projects hidden, global always', () => {
  const list = P.normalize([{ id: 'g', text: 'g' }, { id: 'p1', text: 'a', project: 'one' }, { id: 'p2', text: 'b', project: 'two' }]);
  assert.deepEqual(P.visible(list, 'one').map((p) => p.id), ['p1', 'g']);
  assert.deepEqual(P.visible(list, 'zzz').map((p) => p.id), ['g']);
});

test('add and remove', () => {
  let list = P.add([], { title: 'T', text: 'body', project: null });
  assert.equal(list.length, 1);
  list = P.remove(list, list[0].id);
  assert.deepEqual(list, []);
});

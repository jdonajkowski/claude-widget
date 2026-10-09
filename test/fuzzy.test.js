const test = require('node:test');
const assert = require('node:assert/strict');
const { score, rank } = require('../src/fuzzy');

test('score: every letter must appear in order, case does not matter', () => {
  assert.ok(score('gd', 'Gremlin-Desk') > 0);
  assert.ok(score('GREM', 'gremlin-desk') > 0);
  assert.equal(score('dg', 'Gremlin-Desk'), -1);
  assert.equal(score('xyz', 'Gremlin-Desk'), -1);
  assert.equal(score('', 'anything'), 0);
  assert.equal(score('  ', 'anything'), 0);
});

test('score: a prefix beats letters scattered through the name', () => {
  assert.ok(score('gre', 'Gremlin-Desk') > score('gre', 'big-red-engine'));
  assert.ok(score('desk', 'Gremlin-Desk') > score('desk', 'dashboard-kit-s'));
});

test('score: word starts count, so initials find a project', () => {
  assert.ok(score('gd', 'Gremlin-Desk') > score('gd', 'gadget'));
});

test('rank: best match first, ties keep their order, non-matches are dropped', () => {
  const items = [
    { name: 'System Tune up', path: 'c:/p/system-tune-up' },
    { name: 'Gremlin-Desk', path: 'c:/p/gremlin-desk' },
    { name: 'G-Icons', path: 'c:/p/g-icons' }
  ];
  assert.deepEqual(rank('g', items).map((x) => x.name), ['G-Icons', 'Gremlin-Desk']);
  assert.deepEqual(rank('e', items).map((x) => x.name), ['Gremlin-Desk', 'System Tune up']);
  assert.deepEqual(rank('grem', items).map((x) => x.name), ['Gremlin-Desk']);
  assert.deepEqual(rank('zzz', items), []);
});

test('rank: an empty query returns the items unchanged (a copy); the path can match too', () => {
  const items = [{ name: 'b', path: '/x/one' }, { name: 'a', path: '/x/two' }];
  const out = rank('', items);
  assert.deepEqual(out, items);
  assert.notEqual(out, items);
  assert.deepEqual(rank('two', items).map((x) => x.name), ['a']);
});

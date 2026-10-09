const test = require('node:test');
const assert = require('node:assert/strict');
const { badge, same } = require('../src/git-badge');

test('badge: clean repo shows only the branch in the long form', () => {
  const b = badge({ branch: 'main', ahead: 0, behind: 0, changed: 0 });
  assert.deepEqual(b, { short: '', long: 'main', dirty: false });
});

test('badge: changes and ahead/behind', () => {
  const b = badge({ branch: 'feat/x', ahead: 2, behind: 1, changed: 3 });
  assert.equal(b.short, '● ↑2 ↓1');
  assert.equal(b.long, 'feat/x  ● 3 changed  ↑2 ↓1');
  assert.equal(b.dirty, true);
});

test('badge: not a repo gives nothing', () => {
  assert.deepEqual(badge(null), { short: '', long: '', dirty: false });
});

test('same: compares by value', () => {
  assert.ok(same({ a: 1 }, { a: 1 }));
  assert.ok(same(null, undefined));
  assert.ok(!same({ a: 1 }, { a: 2 }));
});

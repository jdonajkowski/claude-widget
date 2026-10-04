const test = require('node:test');
const assert = require('node:assert/strict');
const { find } = require('../src/md-links');

const paths = (text) => find(text).map((m) => m.candidates.map((c) => c.path));

test('finds a relative path', () => {
  assert.deepEqual(paths('see docs/plan.md for details'), [['see docs/plan.md', 'docs/plan.md']]);
});

test('offers longer starts first so paths with spaces resolve', () => {
  const [m] = find('wrote C:\\Users\\me\\Claude Widget\\README.md');
  assert.deepEqual(m.candidates.map((c) => c.path), [
    'wrote C:\\Users\\me\\Claude Widget\\README.md',
    'C:\\Users\\me\\Claude Widget\\README.md',
    'Widget\\README.md'
  ]);
  assert.equal(m.end, 'wrote C:\\Users\\me\\Claude Widget\\README.md'.length);
});

test('stops at quotes and brackets and drops a :line suffix', () => {
  const [m] = find('Updated (`notes/todo.md:12`) today');
  assert.deepEqual(m.candidates.map((c) => c.path), ['notes/todo.md']);
  assert.equal(m.candidates[0].start, 'Updated (`'.length);
});

test('ignores look-alikes', () => {
  assert.deepEqual(find('the .mdx file and foo.md.bak and README.markdownish'), []);
});

test('finds several paths on one line', () => {
  assert.deepEqual(find('a.md, b/c.MARKDOWN').map((m) => m.candidates.at(-1).path), ['a.md', 'b/c.MARKDOWN']);
});

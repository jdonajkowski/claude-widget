const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { safeJoin, listDir, openAction, mdFiles, findByTail } = require('../src/files');

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'files-test-'));
  const mk = (rel, body = '') => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  mk('README.md');
  mk('b.txt');
  mk('A.js');
  mk('docs/USAGE.md');
  mk('docs/deep/notes/USAGE.md');
  mk('node_modules/pkg/README.md');
  mk('.git/HEAD');
  mk('src/main.js');
  return root;
}

test('safeJoin keeps paths inside the root', () => {
  const root = path.resolve('/proj');
  assert.equal(safeJoin(root, ''), root);
  assert.equal(safeJoin(root, 'docs/a.md'), path.join(root, 'docs', 'a.md'));
  assert.equal(safeJoin(root, '../other'), null);
  assert.equal(safeJoin(root, path.resolve('/elsewhere/x')), null);
});

test('listDir puts folders first, sorts by name and skips ignored folders', () => {
  const root = tree();
  const names = listDir(root, '').map((e) => e.name);
  assert.deepEqual(names, ['docs', 'src', 'A.js', 'b.txt', 'README.md']);
  assert.deepEqual(listDir(root, 'docs').map((e) => [e.rel, e.dir]), [['docs/deep', true], ['docs/USAGE.md', false]]);
  assert.equal(listDir(root, '..'), null);
  assert.equal(listDir(root, 'missing'), null);
});

test('openAction sends Markdown to the viewer and runnable files to Explorer', () => {
  assert.equal(openAction('notes.MD'), 'md');
  assert.equal(openAction('main.js'), 'reveal');
  assert.equal(openAction('setup.ps1'), 'reveal');
  assert.equal(openAction('photo.png'), 'open');
});

test('mdFiles lists Markdown outside ignored folders', () => {
  assert.deepEqual(mdFiles(tree()).sort(), ['README.md', 'docs/USAGE.md', 'docs/deep/notes/USAGE.md']);
});

test('findByTail matches a bare name or partial path, shallowest first', () => {
  const files = ['README.md', 'docs/USAGE.md', 'docs/deep/notes/USAGE.md'];
  assert.equal(findByTail(files, 'USAGE.md'), 'docs/USAGE.md');
  assert.equal(findByTail(files, 'notes\\USAGE.md'), 'docs/deep/notes/USAGE.md');
  assert.equal(findByTail(files, 'usage.md', true), 'docs/USAGE.md');
  assert.equal(findByTail(files, 'usage.md', false), null);
  assert.equal(findByTail(files, 'SAGE.md'), null);
  assert.equal(findByTail(files, 'C:/x/USAGE.md'), null);
});

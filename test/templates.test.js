const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/templates');

test('validName accepts ordinary folder names only', () => {
  for (const n of ['my-app', 'App 2', 'tool_x.v2']) assert.equal(t.validName(n), true, n);
  for (const n of ['', ' x', '../x', 'a/b', 'con', 'name.', 'a:b', '-x']) assert.equal(t.validName(n), false, n);
});

test('package names are normalized', () => {
  assert.equal(t.pkgName('My Cool App'), 'my-cool-app');
  assert.equal(t.pyName('9 Lives'), '_9_lives');
});

test('every template renders AGENTS.md, a CLAUDE.md import and a .gitignore', () => {
  for (const { id } of t.list()) {
    const r = t.render(id, 'Demo App');
    assert.ok(r.files['AGENTS.md'], id);
    assert.equal(r.files['CLAUDE.md'], '@AGENTS.md\n', id);
    assert.ok(r.files['.gitignore'], id);
    for (const [f, text] of Object.entries(r.files)) {
      assert.equal(typeof text, 'string', `${id}/${f}`);
      if (f.endsWith('.json')) JSON.parse(text);
    }
  }
  assert.equal(t.render('web-vite', 'x').run, 'npm run dev');
  assert.ok(t.render('python', 'Demo App').files['src/demo_app/__init__.py']);
  assert.equal(t.render('nope', 'x'), null);
});

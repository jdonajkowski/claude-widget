const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { entryPath, desktopEntry } = require('../src/autostart');

test('the entry goes under XDG_CONFIG_HOME, else ~/.config', () => {
  assert.equal(entryPath('/home/j', {}), path.join('/home/j', '.config', 'autostart', 'gremlin-desk.desktop'));
  assert.equal(entryPath('/home/j', { XDG_CONFIG_HOME: '/cfg' }), path.join('/cfg', 'autostart', 'gremlin-desk.desktop'));
});

test('the entry launches the given binary, quoted', () => {
  const text = desktopEntry('/opt/Gremlin Desk/gremlin-desk');
  assert.ok(text.startsWith('[Desktop Entry]\n'));
  assert.ok(text.includes('\nExec="/opt/Gremlin Desk/gremlin-desk"\n'));
  assert.ok(text.includes('\nType=Application\n'));
  assert.ok(text.includes('\nTerminal=false\n'));
  assert.ok(text.endsWith('\n'));
});

test('quotes, dollars and backslashes in the path are escaped', () => {
  const line = desktopEntry('/a"b$c\\d').split('\n').find((l) => l.startsWith('Exec='));
  assert.equal(line, 'Exec="/a\\"b\\$c\\\\d"');
});

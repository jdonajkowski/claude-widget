const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { layout, expandHome, migrateWidgetData, migrateClaudeConfig, rewritePaths, MARKER } = require('../src/data-dirs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'data-dirs-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('layout puts everything under Projects/.claude', () => {
  const l = layout(path.join('C:', 'Users', 'me'));
  assert.equal(l.root, path.join('C:', 'Users', 'me', 'Projects', '.claude'));
  assert.equal(l.widget, path.join(l.root, 'widget'));
  assert.equal(expandHome('~/Projects/.claude', '/home/me'), path.join('/home/me', 'Projects/.claude'));
  assert.equal(expandHome('/abs', '/home/me'), '/abs');
});

test('migrateWidgetData copies settings files once', () => {
  const from = tmp();
  const to = path.join(tmp(), 'widget');
  write(path.join(from, 'config.json'), '{"a":1}');
  write(path.join(from, 'window-state.json'), '{}');
  write(path.join(from, 'Cache', 'x'), 'no');
  assert.deepEqual(migrateWidgetData(from, to), ['config.json', 'window-state.json']);
  assert.equal(fs.existsSync(path.join(to, 'Cache')), false);
  write(path.join(from, 'config.json'), '{"a":2}');
  assert.deepEqual(migrateWidgetData(from, to), []); // already there: left alone
  assert.equal(fs.readFileSync(path.join(to, 'config.json'), 'utf8'), '{"a":1}');
});

test('rewritePaths handles JSON-escaped Windows paths, case-insensitively', () => {
  const json = JSON.stringify({ p: 'C:\\Users\\me\\.claude\\plugins\\x', q: 'c:/users/me/.claude/y' });
  const out = JSON.parse(rewritePaths(json, 'C:\\Users\\me\\.claude', 'C:\\Users\\me\\Projects\\.claude', true));
  assert.equal(out.p, 'C:\\Users\\me\\Projects\\.claude\\plugins\\x');
  assert.equal(out.q, 'C:/Users/me/Projects/.claude/y');
});

test('migrateClaudeConfig copies ~/.claude except the sign-in token and scratch folders', () => {
  const home = tmp();
  const from = path.join(home, '.claude');
  const to = layout(home).root;
  write(path.join(from, 'settings.json'), '{"theme":"auto"}');
  write(path.join(from, '.credentials.json'), 'secret');
  write(path.join(from, 'projects', 'C--x', 'a.jsonl'), '{}');
  write(path.join(from, 'shell-snapshots', 's'), 'x');
  write(path.join(from, 'plugins', 'installed_plugins.json'), JSON.stringify({ installPath: path.join(from, 'plugins', 'cache', 'p') }));
  write(path.join(home, '.claude.json'), '{"userID":"u"}');
  write(path.join(to, 'widget', 'config.json'), '{}'); // the widget folder already lives inside

  const res = migrateClaudeConfig({ home, to, isWin: process.platform === 'win32' });
  assert.ok(res.copied.includes('settings.json'));
  assert.ok(res.copied.includes('.claude.json'));
  assert.equal(fs.existsSync(path.join(to, '.credentials.json')), false);
  assert.equal(fs.existsSync(path.join(to, 'shell-snapshots')), false);
  assert.ok(fs.existsSync(path.join(to, 'projects', 'C--x', 'a.jsonl')));
  const plugins = JSON.parse(fs.readFileSync(path.join(to, 'plugins', 'installed_plugins.json'), 'utf8'));
  assert.equal(plugins.installPath, path.join(to, 'plugins', 'cache', 'p'));
  assert.ok(fs.existsSync(path.join(to, MARKER)));
  assert.equal(migrateClaudeConfig({ home, to, isWin: false }), null); // only once
});

test('migrateClaudeConfig leaves a folder that already has settings alone', () => {
  const home = tmp();
  write(path.join(home, '.claude', 'settings.json'), '{"a":1}');
  const to = layout(home).root;
  write(path.join(to, 'settings.json'), '{"b":2}');
  assert.equal(migrateClaudeConfig({ home, to, isWin: false }), null);
  assert.equal(fs.readFileSync(path.join(to, 'settings.json'), 'utf8'), '{"b":2}');
});

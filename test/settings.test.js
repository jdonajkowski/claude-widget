const test = require('node:test');
const assert = require('node:assert/strict');
const { splitArgs, joinArgs, parseEnv, formatEnv, normalize, toForm, ensureImport, hasImport } = require('../src/settings');

const defaults = { shell: 'powershell.exe', projectsRoot: 'C:\\P', cwd: 'C:\\H', fontFamily: 'Consolas' };

test('splitArgs and joinArgs round-trip quoted arguments', () => {
  const args = ['-NoLogo', '-Command', 'claude --model x'];
  assert.equal(joinArgs(args), '-NoLogo -Command "claude --model x"');
  assert.deepEqual(splitArgs(joinArgs(args)), args);
});

test('parseEnv reads KEY=value lines and skips comments', () => {
  assert.deepEqual(parseEnv('# note\nA=1\n\nB = two=2\nbad'), { A: '1', B: ' two=2' });
  assert.equal(formatEnv({ A: '1', B: 'x' }), 'A=1\nB=x');
});

test('normalize clamps numbers, falls back to defaults and reports bad values', () => {
  const { values, errors } = normalize({
    shell: '  ', fontSize: '40', opacity: '0.1', alwaysOnTop: 0, backgroundMaterial: 'glass',
    theme: { background: '#000', cursor: 'red' }
  }, defaults);
  assert.equal(values.shell, 'powershell.exe');
  assert.equal(values.fontSize, 32);
  assert.equal(values.opacity, 0.3);
  assert.equal(values.alwaysOnTop, false);
  assert.equal('backgroundMaterial' in values, false);
  assert.deepEqual(values.theme, { background: '#000' });
  assert.equal(errors.length, 2);
});

test('normalize only returns fields the form sent', () => {
  assert.deepEqual(normalize({ hotkey: ' Control+Alt+K ' }, defaults).values, { hotkey: 'Control+Alt+K' });
  assert.deepEqual(normalize({ claudeHooks: '' }, defaults).values, { claudeHooks: false });
});

test('toForm turns args and env into text', () => {
  const form = toForm({ shellArgs: ['-c', 'a b'], env: { X: '1' }, fontSize: 13 });
  assert.equal(form.shellArgs, '-c "a b"');
  assert.equal(form.env, 'X=1');
  assert.equal(form.fontSize, 13);
});

test('ensureImport adds @AGENTS.md once', () => {
  assert.equal(ensureImport(''), '@AGENTS.md\n');
  assert.equal(ensureImport('# Mine\r\nrules'), '@AGENTS.md\n\n# Mine\r\nrules');
  assert.equal(ensureImport('x\n  @AGENTS.md  \n'), null);
  assert.equal(hasImport('@AGENTS.md'), true);
  assert.equal(hasImport('see AGENTS.md'), false);
});

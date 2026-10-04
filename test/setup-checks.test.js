const test = require('node:test');
const assert = require('node:assert/strict');
const { LINUX_PMS, TOOLS, installCommand, signInCommand, cleanIdentity, looksLikeEmail } = require('../src/setup-checks');

const tool = (id) => TOOLS.find((t) => t.id === id);
const pacman = LINUX_PMS.find((p) => p.id === 'pacman');
const apt = LINUX_PMS.find((p) => p.id === 'apt');

test('install commands per platform', () => {
  assert.equal(installCommand(tool('git'), { isWin: true }), 'winget install --id Git.Git -e --source winget');
  assert.equal(installCommand(tool('git'), { isWin: false, pm: pacman }), 'sudo pacman -S --needed git');
  assert.equal(installCommand(tool('node'), { isWin: false, pm: pacman }), 'sudo pacman -S --needed nodejs npm');
  assert.equal(installCommand(tool('gh'), { isWin: false, pm: apt }), 'sudo apt-get install -y gh');
  assert.equal(installCommand(tool('claude'), { isWin: false, pm: null }), 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(installCommand(tool('code'), { isWin: false, pm: apt }), null); // not in Debian's repos
  assert.equal(installCommand(tool('git'), { isWin: false, pm: null }), null);
});

test('sign-in commands exist for Claude and GitHub only', () => {
  assert.equal(signInCommand('gh', true), 'gh auth login');
  assert.equal(signInCommand('claude', false), 'claude');
  assert.equal(signInCommand('git', true), null);
});

test('git identity values are one line', () => {
  assert.equal(cleanIdentity('  Ada\nLovelace '), 'Ada Lovelace');
  assert.equal(looksLikeEmail('ada@example.com'), true);
  assert.equal(looksLikeEmail('ada at example'), false);
});

test('every tool says why it matters and has a Windows installer', () => {
  for (const t of TOOLS) {
    assert.ok(t.why, t.id);
    assert.ok(t.install.win, t.id);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { findOnPath, unwrapStatus, runtime, sessionSettings, isClaudeCommand } = require('../src/claude-launch');

const hooksDir = 'C:\\App\\resources\\app\\hooks';
const execPath = 'C:\\App\\Claude Widget.exe';

test('findOnPath searches PATH entries in order', () => {
  const seen = new Set([path.join('C:\\b', 'node.exe')]);
  const env = { PATH: 'C:\\a;"C:\\b";C:\\c' };
  assert.equal(findOnPath(['node.exe'], { env, isWin: true, exists: (p) => seen.has(p) }), path.join('C:\\b', 'node.exe'));
  assert.equal(findOnPath(['nope.exe'], { env, isWin: true, exists: (p) => seen.has(p) }), null);
});

test('unwrapStatus strips an existing widget wrapper', () => {
  assert.equal(unwrapStatus('node "C:/x/hooks/statusline-tee.js" npx -y ccstatusline@latest'), 'npx -y ccstatusline@latest');
  assert.equal(unwrapStatus('npx -y ccstatusline@latest'), 'npx -y ccstatusline@latest');
  assert.equal(unwrapStatus(undefined), '');
});

test('with Node on PATH, hooks and the status line run plain node', () => {
  const rt = runtime({ node: 'C:\\node\\node.exe', execPath, isWin: true });
  assert.deepEqual(rt.hook('C:\\h\\workers-hook.js'), { type: 'command', command: 'node "C:/h/workers-hook.js"' });
  assert.equal(rt.status('C:\\h\\statusline-tee.js', 'npx ccstatusline'), 'node "C:/h/statusline-tee.js" npx ccstatusline');
});

test('without Node, bash runs the widget executable as Node', () => {
  const rt = runtime({ node: null, execPath: '/opt/Claude Widget/claude-widget', isWin: false });
  assert.equal(rt.kind, 'built-in');
  assert.equal(rt.hook('/opt/h/workers-hook.js').command, "ELECTRON_RUN_AS_NODE=1 '/opt/Claude Widget/claude-widget' '/opt/h/workers-hook.js'");
  const win = runtime({ node: null, execPath, isWin: true, gitBash: 'C:\\Git\\bin\\bash.exe' });
  assert.equal(win.hook('C:\\h\\w.js').shell, 'bash');
});

test('Windows without Node or Git Bash uses PowerShell, with hooks in the background', () => {
  const rt = runtime({ node: null, execPath, isWin: true, gitBash: null });
  const hook = rt.hook('C:\\h\\workers-hook.js');
  assert.equal(hook.shell, 'powershell');
  assert.equal(hook.async, true);
  assert.equal(hook.command, "$env:ELECTRON_RUN_AS_NODE='1'; & 'C:\\App\\Claude Widget.exe' 'C:\\h\\workers-hook.js'");
  const encoded = /^powershell -NoProfile -NonInteractive -EncodedCommand (\S+)$/.exec(rt.status('C:\\h\\tee.js', 'npx x'))[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'),
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $env:ELECTRON_RUN_AS_NODE='1'; & 'C:\\App\\Claude Widget.exe' 'C:\\h\\tee.js' npx x | ForEach-Object { $_ }");
});

test('sessionSettings adds every hook event and wraps the user status line', () => {
  const { settings, runtime: kind } = sessionSettings({
    hooksDir, execPath, node: 'node.exe', isWin: true,
    global: { statusLine: { type: 'command', command: 'npx -y ccstatusline@latest', padding: 0 } }
  });
  assert.equal(kind, 'node');
  assert.deepEqual(Object.keys(settings.hooks), ['SubagentStart', 'SubagentStop', 'Stop', 'Notification', 'PostToolUse', 'PreToolUse']);
  assert.equal(settings.hooks.PostToolUse[0].matcher, 'Bash|PowerShell');
  assert.deepEqual(settings.hooks.PostToolUse[0].hooks.map((h) => h.command), ['node "C:/App/resources/app/hooks/workers-hook.js"', 'node "C:/App/resources/app/hooks/guard-hook.js"']);
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node "C:/App/resources/app/hooks/guard-hook.js"' }] }]);
  assert.equal(settings.statusLine.command, 'node "C:/App/resources/app/hooks/statusline-tee.js" npx -y ccstatusline@latest');
  assert.equal(settings.statusLine.padding, 0);
});

test('sessionSettings leaves out what global settings already wire up', () => {
  const w = { type: 'command', command: 'node "C:/x/hooks/workers-hook.js"' };
  const everyHook = {
    ...Object.fromEntries(['SubagentStart', 'SubagentStop', 'Stop', 'Notification'].map((e) => [e, [{ hooks: [w] }]])),
    PostToolUse: ['Bash|PowerShell', 'TodoWrite|TaskCreate|TaskUpdate'].map((matcher) => ({ matcher, hooks: [w] }))
  };
  const global = {
    hooks: everyHook,
    statusLine: { type: 'command', command: 'node "C:/x/hooks/statusline-tee.js" npx ccstatusline' }
  };
  assert.equal(sessionSettings({ hooksDir, execPath, node: 'node', isWin: true, global, guard: false }).settings, null);
  assert.deepEqual(Object.keys(sessionSettings({ hooksDir, execPath, node: 'node', isWin: true, global: { ...global, hooks: everyHook } }).settings.hooks), ['PreToolUse', 'PostToolUse']);
});

test('sessionSettings adds hook matchers an older global setup lacks', () => {
  const w = { type: 'command', command: 'node "C:/x/hooks/workers-hook.js"' };
  const global = {
    hooks: Object.fromEntries(['SubagentStart', 'SubagentStop', 'Stop', 'Notification'].map((e) => [e, [{ hooks: [w] }]])),
    statusLine: { type: 'command', command: 'node "C:/x/hooks/statusline-tee.js"' }
  };
  global.hooks.PostToolUse = [{ matcher: 'Bash|PowerShell', hooks: [w] }];
  const { settings } = sessionSettings({ hooksDir, execPath, node: 'node', isWin: true, global, guard: false });
  assert.deepEqual(settings.hooks, { PostToolUse: [{ matcher: 'TodoWrite|TaskCreate|TaskUpdate', hooks: [{ type: 'command', command: 'node "C:/App/resources/app/hooks/workers-hook.js"' }] }] });
});

test('the guard hook runs in the foreground, the others in the background, under PowerShell', () => {
  const { settings } = sessionSettings({ hooksDir, execPath, node: null, isWin: true, gitBash: null });
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].async, undefined);
  assert.equal(settings.hooks.Stop[0].hooks[0].async, true);
});

test('isClaudeCommand only matches Claude Code', () => {
  for (const c of ['claude', 'claude.cmd', '& "C:\\Users\\me\\.local\\bin\\claude.exe"', '/usr/bin/claude --model x']) assert.equal(isClaudeCommand(c), true, c);
  for (const c of ["Write-Output 'hi'", 'claudette', 'node app.js']) assert.equal(isClaudeCommand(c), false, c);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const spfx = require('../src/spfx');
const g = require('../src/generators');

test('engine ranges as SPFx publishes them', () => {
  assert.equal(spfx.satisfies('v22.14.0', '>=22.14.0 < 23.0.0'), true);
  assert.equal(spfx.satisfies('v22.23.3', '>=22.14.0 < 23.0.0'), true);
  assert.equal(spfx.satisfies('v24.19.0', '>=22.14.0 < 23.0.0'), false);
  assert.equal(spfx.satisfies('v22.13.9', '>=22.14.0 < 23.0.0'), false);
  assert.equal(spfx.satisfies('20.11.1', '>=18.17.1 <19.0.0 || >=20.11.0 <21.0.0'), true);
  assert.equal(spfx.satisfies('18.20.0', '^18 || ^20'), true);
  assert.equal(spfx.satisfies('19.0.0', '^18 || ^20'), false);
  assert.equal(spfx.nodeMajor('>=22.14.0 < 23.0.0'), 22);
  assert.equal(spfx.nodeMajor('>=18.17.1 <19.0.0 || >=20.11.0 <21.0.0'), 20);
});

test('the latest release comes from the registry dist-tags', async () => {
  const doc = {
    'dist-tags': { latest: '1.23.2', next: '1.24.0-rc.0' },
    versions: { '1.23.2': { engines: { node: '>=22.14.0 < 23.0.0' } }, '1.24.0-rc.0': {} },
    time: { '1.23.2': '2026-06-30T00:00:00.000Z' }
  };
  const r = await spfx.latest({ installedNode: 'v24.19.0', get: async () => doc });
  assert.deepEqual(r, { version: '1.23.2', node: '>=22.14.0 < 23.0.0', released: '2026-06-30T00:00:00.000Z', nodeMajor: 22, installedNode: 'v24.19.0', nodeOk: false });
  assert.match((await spfx.latest({ get: async () => { throw new Error('offline'); } })).error, /offline/);
});

test('the SPFx generator command pins the version and its Node.js', () => {
  const c = spfx.generatorCommand({ version: '1.23.2', nodeMajor: 22, solutionName: 'My Parts', componentType: 'webpart', framework: 'none', componentName: 'Sales Chart' });
  assert.equal(c, 'npx -y -p node@22 -p yo@5 -p @microsoft/generator-sharepoint@1.23.2 -- yo @microsoft/sharepoint --solution-name "My Parts" --component-type webpart --component-name "Sales Chart" --framework none --environment spo --package-manager npm --skip-install --no-insight');
  assert.match(spfx.generatorCommand({ version: '1.23.2', solutionName: 'x', componentType: 'application-customizer' }), /--component-type extension --extension-type ApplicationCustomizer --component-name "HelloWorld" --environment/);
  assert.doesNotMatch(spfx.generatorCommand({ solutionName: 'x', componentType: 'library' }), /component-name|framework/);
});

const info = { version: '1.23.2', node: '>=22.14.0 < 23.0.0', nodeMajor: 22, installedNode: 'v24.19.0', nodeOk: false };

test('an SPFx plan generates from the folder above, then installs and commits', () => {
  const p = g.plan('spfx', 'My Parts', { spfxInfo: info, ps: false, isWin: false });
  assert.match(p.steps[1], /^npx .* < \/dev\/null$/);
  assert.match(g.plan('spfx', 'x', { spfxInfo: info, ps: true }).steps[1], /^\$null \| npx /);
  assert.match(g.plan('spfx', 'x', { spfxInfo: info, ps: false, isWin: true }).steps[1], / < nul$/);
  assert.deepEqual(Object.keys(p.files), ['AGENTS.md', 'CLAUDE.md', '.nvmrc']);
  assert.equal(p.files['.nvmrc'], '22\n');
  assert.equal(p.steps[0], 'cd ..');
  assert.equal(p.steps[2], 'cd "My Parts"');
  assert.deepEqual(p.steps.slice(3), ['npm install', 'git init -b main', 'git add -A', 'git commit -m "Initial commit"']);
  assert.match(p.notes[0], /supports Node\.js >=22\.14\.0 < 23\.0\.0; you have v24\.19\.0/);
  assert.match(g.plan('spfx', 'x', { spfxInfo: { error: 'offline' } }).command, /generator-sharepoint@latest/);
  assert.match(g.plan('spfx', 'x', { spfx: { componentName: '1bad' } }).error, /Component name/);
});

test('TanStack Start and Next.js plans', () => {
  const t = g.plan('tanstack-start', 'Shop App', { install: false, git: false, isWin: false });
  assert.deepEqual(t.steps, ['npx -y @tanstack/cli@latest create shop-app --target-dir . --framework React --add-ons tanstack-query,form,table --toolchain eslint --no-examples --no-git --no-intent --package-manager npm --no-install -y -f < /dev/null']);
  assert.ok(t.files['AGENTS.md'].includes('TanStack'));
  const n = g.plan('nextjs', 'web-site', { install: true, git: false, ps: true });
  assert.deepEqual(Object.keys(n.files), []);
  assert.match(n.command, /^\$null \| npx -y create-next-app@latest \. .*; if \(\$\?\) \{ node -e .* if \(\$\?\) \{ npm install \} \}$/);
  assert.match(g.plan('nextjs', 'Web Site').error, /"web-site"/);
});

test('appended text survives any shell as base64', () => {
  const cmd = g.appendCommand('AGENTS.md', 'a "quoted" `line` & more\n');
  const b64 = cmd.split(' ').pop();
  assert.equal(Buffer.from(b64, 'base64').toString(), 'a "quoted" `line` & more\n');
  assert.doesNotMatch(b64, /[\s"'`&|<>]/);
});

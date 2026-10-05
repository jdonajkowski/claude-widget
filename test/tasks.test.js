const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const t = require('../src/tasks');

const fakeFs = (files) => ({
  readdirSync: () => Object.keys(files),
  readFileSync: (p) => { const k = path.basename(p); if (!(k in files)) throw new Error('ENOENT'); return files[k]; }
});
const cmds = (files, opts = {}) => t.detectTasks('/p', { fsx: fakeFs(files), isWin: false, ...opts }).map((x) => x.command);

test('Makefile and justfile targets', () => {
  assert.deepEqual(t.makeTargets('.PHONY: all\nall: build\nbuild:\n\tcc x\nCC := gcc\n%.o: %.c\ntest :\n'), ['all', 'build', 'test']);
  assert.deepEqual(t.justRecipes('set shell := ["bash"]\nalias b := build\nbuild:\n  cargo build\ntest *args: build\n  x\n@lint:\n  y\n'), ['build', 'test', 'lint']);
});

test('package.json scripts run with the lockfile\'s package manager', () => {
  assert.deepEqual(cmds({ 'package.json': '{"scripts":{"dev":"vite","test":"x","start":"y"}}', node_modules: '' }),
    ['npm run dev', 'npm test', 'npm start', 'npm install', 'npm outdated', 'npm audit', 'npm pack']);
  assert.deepEqual(cmds({ 'package.json': '{"scripts":{"dev":"vite"}}', 'pnpm-lock.yaml': '' }), ['pnpm install', 'pnpm dev', 'pnpm outdated', 'pnpm audit', 'pnpm pack']);
});

test('scripts land in Run, Test, Package or Setup by name', () => {
  const list = t.detectTasks('/p', { fsx: fakeFs({ 'package.json': '{"scripts":{"dev":"a","test:unit":"b","build":"c","lint":"d","clean":"e","gen":"f"}}' }), isWin: false });
  const sec = Object.fromEntries(list.filter((x) => x.group === 'npm').map((x) => [x.label, x.section]));
  assert.deepEqual([sec.dev, sec['test:unit'], sec.build, sec.lint, sec.clean, sec.gen, sec.install], ['run', 'test', 'package', 'test', 'setup', 'scripts', 'setup']);
  assert.equal(list.find((x) => x.label === 'install').first, true);
});

test('SPFx projects get gulp or heft commands', () => {
  const pkg = '{"dependencies":{"@microsoft/sp-core-library":"1.20.0"}}';
  const gulp = t.detectTasks('/p', { fsx: fakeFs({ 'package.json': pkg, 'gulpfile.js': '', node_modules: '' }), isWin: true, ps: true }).filter((x) => x.group === 'spfx');
  assert.deepEqual(gulp.map((x) => x.command).slice(0, 4), ['npx gulp serve', 'npx gulp serve --nobrowser', 'npx gulp test', 'npx gulp bundle --ship; if ($?) { npx gulp package-solution --ship }']);
  const heft = t.detectTasks('/p', { fsx: fakeFs({ 'package.json': pkg, node_modules: '' }), isWin: false }).filter((x) => x.group === 'spfx');
  assert.equal(heft.find((x) => x.section === 'package').command, 'npx heft test --clean --production && npx heft package-solution --production');
  assert.equal(cmds({ 'package.json': '{}', node_modules: '' }).some((c) => c.includes('gulp') || c.includes('heft')), false);
});

test('language projects get their usual commands', () => {
  assert.deepEqual(cmds({ 'Cargo.toml': '' }), ['cargo run', 'cargo test', 'cargo clippy', 'cargo build', 'cargo build --release']);
  assert.deepEqual(cmds({ 'pyproject.toml': '[tool.pytest]', 'uv.lock': '', 'main.py': '' }), ['uv run python main.py', 'uv run pytest', 'uv build', 'uv sync']);
  assert.deepEqual(cmds({ 'requirements.txt': '', 'app.py': '' }, { isWin: true }),
    ['python app.py', 'python -m unittest', 'python -m venv .venv', 'python -m pip install -r requirements.txt']);
  assert.deepEqual(cmds({ 'requirements.txt': '', '.venv': '', tests: '' }, { isWin: true }),
    ['.venv\\Scripts\\python.exe -m pytest', '.venv\\Scripts\\python.exe -m pip install -r requirements.txt']);
  assert.deepEqual(cmds({ 'App.csproj': '' }).slice(0, 3), ['dotnet run', 'dotnet watch run', 'dotnet test']);
  assert.deepEqual(cmds({ 'compose.yaml': '' }), ['docker compose up', 'docker compose down']);
  assert.deepEqual(cmds({}), []);
});

test('a solution runs each app project it lists', () => {
  const sln = 'Project("{FAE04EC0}") = "Web", "src\\Web\\Web.csproj", "{1}"\nEndProject\nProject("{FAE04EC0}") = "Web.Tests", "tests\\Web.Tests\\Web.Tests.csproj", "{2}"\nEndProject\n';
  const list = cmds({ 'App.sln': sln });
  assert.equal(list[0], 'dotnet run --project "src/Web/Web.csproj"');
  assert.equal(list.some((c) => c.includes('Web.Tests')), false);
  assert.ok(list.includes('dotnet publish -c Release') && list.includes('dotnet pack -c Release'));
});

test('chain stops at the first failure in either shell', () => {
  assert.equal(t.chain(['a', 'b', 'c'], false), 'a && b && c');
  assert.equal(t.chain(['a', 'b'], true), 'a; if ($?) { b }');
});

test('detectServerUrl finds what dev servers print', () => {
  assert.equal(t.detectServerUrl('  \x1b[32m➜\x1b[39m  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m'), 'http://localhost:5173/');
  assert.equal(t.detectServerUrl('Server running at http://127.0.0.1:8000.'), 'http://127.0.0.1:8000');
  assert.equal(t.detectServerUrl('ready - started server on 0.0.0.0:3000, url: http://0.0.0.0:3000'), 'http://localhost:3000');
  assert.equal(t.detectServerUrl('Listening on port 8080'), 'http://localhost:8080');
  assert.equal(t.detectServerUrl('compiled 12 modules'), null);
  assert.equal(t.detectServerUrl('see https://example.com:443/docs'), null);
});

test('auxLaunch keeps the terminal open after the command', () => {
  assert.deepEqual(t.auxLaunch({ shell: 'powershell.exe', isWin: true, command: 'npm run dev' }), { file: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', 'npm run dev'] });
  assert.deepEqual(t.auxLaunch({ shell: '/bin/zsh', isWin: false, command: 'make' }), { file: '/bin/zsh', args: ['-lc', 'make; exec "/bin/zsh"'] });
  assert.deepEqual(t.auxLaunch({ shell: '/bin/bash', isWin: false }), { file: '/bin/bash', args: ['-l'] });
});

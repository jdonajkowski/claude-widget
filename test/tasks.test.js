const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const t = require('../src/tasks');

const fakeFs = (files) => ({
  readdirSync: () => Object.keys(files),
  readFileSync: (p) => { const k = path.basename(p); if (!(k in files)) throw new Error('ENOENT'); return files[k]; }
});
const cmds = (files, opts = {}) => t.detectTasks('/p', { fsx: fakeFs(files), isWin: false, ...opts }).map((x) => x.command);

test('package.json scripts run with the lockfile\'s package manager', () => {
  assert.deepEqual(cmds({ 'package.json': '{"scripts":{"dev":"vite","test":"x","start":"y"}}', node_modules: '' }), ['npm run dev', 'npm test', 'npm start']);
  assert.deepEqual(cmds({ 'package.json': '{"scripts":{"dev":"vite"}}', 'pnpm-lock.yaml': '' }), ['pnpm install', 'pnpm dev']);
});

test('Makefile and justfile targets', () => {
  assert.deepEqual(t.makeTargets('.PHONY: all\nall: build\nbuild:\n\tcc x\nCC := gcc\n%.o: %.c\ntest :\n'), ['all', 'build', 'test']);
  assert.deepEqual(t.justRecipes('set shell := ["bash"]\nalias b := build\nbuild:\n  cargo build\ntest *args: build\n  x\n@lint:\n  y\n'), ['build', 'test', 'lint']);
});

test('language projects get their usual commands', () => {
  assert.deepEqual(cmds({ 'Cargo.toml': '' }), ['cargo run', 'cargo build', 'cargo test', 'cargo clippy']);
  assert.deepEqual(cmds({ 'pyproject.toml': '[tool.pytest]', 'uv.lock': '', 'main.py': '' }), ['uv sync', 'uv run python main.py', 'uv run pytest']);
  assert.deepEqual(cmds({ 'requirements.txt': '', 'app.py': '' }, { isWin: true }), ['python -m pip install -r requirements.txt', 'python app.py']);
  assert.deepEqual(cmds({ 'App.sln': '' }), ['dotnet build', 'dotnet run', 'dotnet test']);
  assert.deepEqual(cmds({ 'compose.yaml': '' }), ['docker compose up', 'docker compose down']);
  assert.deepEqual(cmds({}), []);
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

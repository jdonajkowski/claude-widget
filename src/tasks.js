// Run button: the tasks a project offers (package.json scripts, Makefile and justfile targets, Cargo,
// Go, Python, .NET, Gradle, Maven, CMake, Deno, Composer, Docker Compose), and spotting the URL a dev
// server prints so it can open in the built-in browser. Looks at the project's top folder only.
const fs = require('fs');
const path = require('path');

const read = (fsx, p) => { try { return fsx.readFileSync(p, 'utf8'); } catch { return null; } };
const json = (fsx, p) => { try { return JSON.parse(read(fsx, p)); } catch { return null; } };

function nodeRunner(names) {
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('yarn.lock')) return 'yarn';
  if (names.has('bun.lockb') || names.has('bun.lock')) return 'bun';
  return 'npm';
}

// Makefile targets, skipping special (.PHONY), pattern (%) and variable (:=) lines.
function makeTargets(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/^([A-Za-z0-9][\w.-]*)\s*:(?![:=])/gm)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// justfile recipes: `name args: deps` at the start of a line, not settings, aliases or assignments.
function justRecipes(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/^@?([A-Za-z_][\w-]*)(?:\s+[^:=\n]*)?:(?!=)/gm)) {
    if (!['set', 'alias', 'export', 'import', 'mod'].includes(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// [{ id, label, command, group }] for the folder. group names the menu section.
function detectTasks(root, { fsx = fs, isWin = process.platform === 'win32' } = {}) {
  let names;
  try { names = new Set(fsx.readdirSync(root)); } catch { return []; }
  const has = (n) => names.has(n);
  const tasks = [];
  const add = (group, label, command) => tasks.push({ id: `${group}:${label}`, group, label, command });

  if (has('package.json')) {
    const pkg = json(fsx, path.join(root, 'package.json')) || {};
    const runner = nodeRunner(names);
    if (!has('node_modules')) add(runner, 'install', `${runner} install`);
    for (const name of Object.keys(pkg.scripts || {})) {
      add(runner, name, runner === 'npm' ? (name === 'start' || name === 'test' ? `npm ${name}` : `npm run ${name}`) : `${runner} ${name === 'install' ? 'run install' : name}`);
    }
  }
  for (const f of ['deno.json', 'deno.jsonc']) {
    if (!has(f)) continue;
    const cfg = json(fsx, path.join(root, f)) || {};
    for (const name of Object.keys(cfg.tasks || {})) add('deno', name, `deno task ${name}`);
  }
  const makefile = ['Makefile', 'makefile', 'GNUmakefile'].find(has);
  if (makefile) for (const t of makeTargets(read(fsx, path.join(root, makefile))).slice(0, 25)) add('make', t, `make ${t}`);
  const justfile = ['justfile', 'Justfile', '.justfile'].find(has);
  if (justfile) for (const r of justRecipes(read(fsx, path.join(root, justfile))).slice(0, 25)) add('just', r, `just ${r}`);
  if (has('Cargo.toml')) for (const c of ['run', 'build', 'test', 'clippy']) add('cargo', c, `cargo ${c}`);
  if (has('go.mod')) {
    add('go', 'run', 'go run .');
    add('go', 'build', 'go build ./...');
    add('go', 'test', 'go test ./...');
  }
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) {
    const uv = has('uv.lock');
    const py = uv ? 'uv run python' : isWin ? 'python' : 'python3';
    if (uv) add('python', 'sync', 'uv sync');
    else if (has('requirements.txt')) add('python', 'install requirements', `${py} -m pip install -r requirements.txt`);
    for (const f of ['main.py', 'app.py']) if (has(f)) add('python', f, `${py} ${f}`);
    if (has('manage.py')) add('python', 'runserver', `${py} manage.py runserver`);
    if (has('tests') || has('test') || /pytest/.test(read(fsx, path.join(root, 'pyproject.toml')) || '')) add('python', 'pytest', uv ? 'uv run pytest' : `${py} -m pytest`);
  }
  if ([...names].some((n) => /\.(sln|csproj|fsproj)$/i.test(n))) for (const c of ['build', 'run', 'test']) add('dotnet', c, `dotnet ${c}`);
  if (has('gradlew') || has('gradlew.bat')) {
    const g = isWin ? '.\\gradlew.bat' : './gradlew';
    for (const c of ['build', 'run', 'test']) add('gradle', c, `${g} ${c}`);
  }
  if (has('pom.xml')) for (const c of ['package', 'test']) add('maven', c, `mvn ${c}`);
  if (has('CMakeLists.txt')) {
    add('cmake', 'configure', 'cmake -S . -B build');
    add('cmake', 'build', 'cmake --build build');
  }
  if (has('composer.json')) {
    const c = json(fsx, path.join(root, 'composer.json')) || {};
    for (const name of Object.keys(c.scripts || {})) add('composer', name, `composer run ${name}`);
  }
  const compose = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].find(has);
  if (compose) {
    add('docker', 'compose up', 'docker compose up');
    add('docker', 'compose down', 'docker compose down');
  }
  return tasks;
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;

// The first local URL a dev server prints ("Local: http://localhost:5173/", "listening on 127.0.0.1:3000").
function detectServerUrl(text) {
  const s = String(text || '').replace(ANSI, '');
  const m = /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(:\d{2,5})?(\/[^\s'"<>)]*)?/i.exec(s);
  if (m) return m[0].replace('0.0.0.0', 'localhost').replace(/[.,;]+$/, '');
  const bare = /\b(?:listening|running|started|serving|available)\b[^\n]*?\b(?:on|at)\s+(?:port\s+)?(localhost|127\.0\.0\.1|0\.0\.0\.0)?:?(\d{2,5})\b/i.exec(s);
  return bare ? `http://localhost:${bare[2]}` : null;
}

// How an extra terminal runs a command and stays open afterwards (or runs the shell alone).
function auxLaunch({ shell, isWin, command }) {
  const sh = shell || (isWin ? 'powershell.exe' : '/bin/bash');
  const ps = /(^|[\\/])(powershell|pwsh)(\.exe)?$/i.test(sh);
  if (isWin) {
    if (ps) return { file: sh, args: command ? ['-NoLogo', '-NoExit', '-Command', command] : ['-NoLogo'] };
    return { file: sh, args: command ? ['/k', command] : [] }; // cmd.exe
  }
  return { file: sh, args: command ? ['-lc', `${command}; exec ${JSON.stringify(sh)}`] : ['-l'] };
}

module.exports = { detectTasks, makeTargets, justRecipes, detectServerUrl, auxLaunch, nodeRunner };

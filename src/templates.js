// New project wizard: small starter projects written straight to disk (no network needed), each with
// an AGENTS.md (picked up through a CLAUDE.md import), a .gitignore and the command that installs its
// dependencies, which the widget runs in a terminal tab afterwards.

// Folder names that work on Windows and Linux alike.
function validName(name) {
  const n = String(name || '');
  return /^[A-Za-z0-9][\w .-]{0,79}$/.test(n) && !/[ .]$/.test(n) && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n);
}

// package.json / Python package names: lower case, dashes or underscores.
const pkgName = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
const pyName = (name) => pkgName(name).replace(/-/g, '_').replace(/^(\d)/, '_$1');

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

const NODE_IGNORE = 'node_modules/\ndist/\nout/\n.env\n*.log\n';

function agents(name, lines) {
  return `# ${name}\n\nInstructions for Claude in this project.\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
}

const TEMPLATES = [
  {
    id: 'empty',
    label: 'Empty project',
    description: 'README, AGENTS.md and .gitignore. Tell Claude what to build.',
    files: (name) => ({
      'README.md': `# ${name}\n`,
      'AGENTS.md': agents(name, ['Describe the project here: what it is, how to run it, how to test it.']),
      '.gitignore': '.env\n*.log\n'
    })
  },
  {
    id: 'node-cli',
    label: 'Node.js command line tool',
    description: 'Plain JavaScript with the built-in test runner. No dependencies.',
    files: (name) => ({
      'package.json': json({
        name: pkgName(name), version: '0.1.0', private: true, type: 'commonjs', bin: { [pkgName(name)]: 'src/cli.js' },
        scripts: { start: 'node src/cli.js', test: 'node --test' }
      }),
      'src/cli.js': "#!/usr/bin/env node\nconst { greet } = require('./index');\n\nconsole.log(greet(process.argv[2] || 'world'));\n",
      'src/index.js': "function greet(who) {\n  return `Hello, ${who}!`;\n}\n\nmodule.exports = { greet };\n",
      'test/index.test.js': "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { greet } = require('../src/index');\n\ntest('greet', () => {\n  assert.equal(greet('Ada'), 'Hello, Ada!');\n});\n",
      'README.md': `# ${name}\n\n\`\`\`\nnpm start -- Ada\nnpm test\n\`\`\`\n`,
      'AGENTS.md': agents(name, ['Node.js, CommonJS, no dependencies unless asked.', 'Run `npm test` after changes.']),
      '.gitignore': NODE_IGNORE
    })
  },
  {
    id: 'web-vite',
    label: 'Web app (Vite)',
    description: 'HTML, CSS and JavaScript with a Vite dev server. Opens in the built-in browser.',
    install: 'npm install',
    run: 'npm run dev',
    files: (name) => ({
      'package.json': json({ name: pkgName(name), version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, devDependencies: { vite: '^7.0.0' } }),
      'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${name}</title>\n  <link rel="stylesheet" href="/src/style.css">\n</head>\n<body>\n  <main id="app"></main>\n  <script type="module" src="/src/main.js"></script>\n</body>\n</html>\n`,
      'src/main.js': `const app = document.querySelector('#app');\napp.innerHTML = '<h1>${name.replace(/'/g, "\\'")}</h1><p>Edit <code>src/main.js</code> and save.</p>';\n`,
      'src/style.css': ':root { color-scheme: light dark; font-family: system-ui, sans-serif; }\nbody { margin: 0; display: grid; place-items: center; min-height: 100vh; }\n',
      'README.md': `# ${name}\n\n\`\`\`\nnpm install\nnpm run dev\n\`\`\`\n`,
      'AGENTS.md': agents(name, ['Vite web app, plain JavaScript (ES modules), no framework unless asked.', 'Check changes in the browser at the dev server URL (`npm run dev`).', 'Run `npm run build` before calling a change done.']),
      '.gitignore': NODE_IGNORE
    })
  },
  {
    id: 'electron',
    label: 'Desktop app (Electron)',
    description: 'A window with a preload script and context isolation, ready to grow.',
    install: 'npm install',
    run: 'npm start',
    files: (name) => ({
      'package.json': json({ name: pkgName(name), productName: name, version: '0.1.0', private: true, main: 'src/main.js', scripts: { start: 'electron .' }, devDependencies: { electron: '^38.0.0' } }),
      'src/main.js': "const { app, BrowserWindow } = require('electron');\nconst path = require('path');\n\nfunction createWindow() {\n  const win = new BrowserWindow({\n    width: 900,\n    height: 640,\n    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }\n  });\n  win.loadFile(path.join(__dirname, 'index.html'));\n}\n\napp.whenReady().then(() => {\n  createWindow();\n  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });\n});\n\napp.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });\n",
      'src/preload.js': "const { contextBridge } = require('electron');\n\ncontextBridge.exposeInMainWorld('app', {\n  versions: { electron: process.versions.electron, node: process.versions.node }\n});\n",
      'src/index.html': `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>${name}</h1>\n  <p id="versions"></p>\n  <script src="renderer.js"></script>\n</body>\n</html>\n`,
      'src/renderer.js': "const { electron, node } = window.app.versions;\ndocument.getElementById('versions').textContent = `Electron ${electron}, Node ${node}`;\n",
      'src/style.css': 'body { font-family: system-ui, sans-serif; margin: 2rem; }\n',
      'README.md': `# ${name}\n\n\`\`\`\nnpm install\nnpm start\n\`\`\`\n`,
      'AGENTS.md': agents(name, ['Electron app: main process in src/main.js, page in src/index.html, bridge in src/preload.js.', 'Keep contextIsolation and sandbox on; expose only what the page needs through the preload.']),
      '.gitignore': NODE_IGNORE
    })
  },
  {
    id: 'python',
    label: 'Python package',
    description: 'src layout with pyproject.toml and pytest. Uses uv when it is installed.',
    install: 'uv sync',
    installFallback: { win: 'python -m venv .venv; .\\.venv\\Scripts\\pip install -e . pytest', linux: 'python3 -m venv .venv && .venv/bin/pip install -e . pytest' },
    files: (name) => {
      const mod = pyName(name);
      return {
        'pyproject.toml': `[project]\nname = "${pkgName(name)}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = []\n\n[project.scripts]\n${pkgName(name)} = "${mod}.__main__:main"\n\n[dependency-groups]\ndev = ["pytest>=8"]\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`,
        [`src/${mod}/__init__.py`]: 'def greet(who: str) -> str:\n    return f"Hello, {who}!"\n',
        [`src/${mod}/__main__.py`]: `import sys\n\nfrom ${mod} import greet\n\n\ndef main() -> None:\n    print(greet(sys.argv[1] if len(sys.argv) > 1 else "world"))\n\n\nif __name__ == "__main__":\n    main()\n`,
        'tests/test_greet.py': `from ${mod} import greet\n\n\ndef test_greet():\n    assert greet("Ada") == "Hello, Ada!"\n`,
        'README.md': `# ${name}\n\n\`\`\`\nuv sync\nuv run pytest\nuv run ${pkgName(name)} Ada\n\`\`\`\n`,
        'AGENTS.md': agents(name, [`Python package in src/${mod}, tests in tests/ (pytest).`, 'Use type hints. Run `uv run pytest` after changes.']),
        '.gitignore': '.venv/\n__pycache__/\n*.pyc\n.pytest_cache/\ndist/\n.env\n'
      };
    }
  }
];

// Files to write for a template, plus the CLAUDE.md that imports AGENTS.md (Claude Code reads CLAUDE.md).
function render(id, name) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  const files = t.files(String(name).trim());
  if (files['AGENTS.md'] && !files['CLAUDE.md']) files['CLAUDE.md'] = '@AGENTS.md\n';
  return { files, install: t.install || null, installFallback: t.installFallback || null, run: t.run || null };
}

const list = () => TEMPLATES.map(({ id, label, description }) => ({ id, label, description }));

module.exports = { validName, pkgName, pyName, render, list };

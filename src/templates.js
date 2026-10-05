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

// C# names: PascalCase identifier from the folder name ("my app" -> "MyApp").
function csName(name) {
  const parts = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const n = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('') || 'App';
  return /^\d/.test(n) ? `App${n}` : n;
}

const DEFAULT_TFM = 'net10.0';

// `dotnet --list-sdks` output -> target framework of the newest SDK ("10.0.100 [C:\...]" -> "net10.0").
function tfmFromSdks(text) {
  const majors = [...String(text).matchAll(/^(\d+)\.\d+\.\d+/gm)].map((m) => Number(m[1])).filter((n) => n >= 6);
  return majors.length ? `net${Math.max(...majors)}.0` : null;
}
const CS_IGNORE = 'bin/\nobj/\n.vs/\n.vscode/\n*.user\n*.suo\nTestResults/\n.env\n';
const CS_PROJECT_TYPE = '9A19103F-16F7-4668-BE54-9A1E7A4F7556'; // SDK-style project
const guid = () => require('crypto').randomUUID().toUpperCase();

// A Visual Studio solution listing projects ([{ name, path }] with forward slashes), CRLF like Visual Studio writes it.
function sln(projects) {
  const ps = projects.map((p) => ({ ...p, id: guid() }));
  const lines = [
    '',
    'Microsoft Visual Studio Solution File, Format Version 12.00',
    '# Visual Studio Version 17',
    'VisualStudioVersion = 17.0.31903.59',
    'MinimumVisualStudioVersion = 10.0.40219.1',
    ...ps.flatMap((p) => [`Project("{${CS_PROJECT_TYPE}}") = "${p.name}", "${p.path.replace(/\//g, '\\')}", "{${p.id}}"`, 'EndProject']),
    'Global',
    '\tGlobalSection(SolutionConfigurationPlatforms) = preSolution',
    '\t\tDebug|Any CPU = Debug|Any CPU',
    '\t\tRelease|Any CPU = Release|Any CPU',
    '\tEndGlobalSection',
    '\tGlobalSection(ProjectConfigurationPlatforms) = postSolution',
    ...ps.flatMap((p) => ['Debug', 'Release'].flatMap((c) => [`\t\t{${p.id}}.${c}|Any CPU.ActiveCfg = ${c}|Any CPU`, `\t\t{${p.id}}.${c}|Any CPU.Build.0 = ${c}|Any CPU`])),
    '\tEndGlobalSection',
    'EndGlobal',
    ''
  ];
  return lines.join('\r\n');
}

const csproj = (sdk, props, items = '') => `<Project Sdk="${sdk}">\n\n  <PropertyGroup>\n${Object.entries(props).map(([k, v]) => `    <${k}>${v}</${k}>`).join('\n')}\n  </PropertyGroup>\n${items ? `\n${items}\n` : ''}\n</Project>\n`;

// xUnit test project referencing the app. Floating versions: restore takes the newest stable release.
const testProj = (tfm, app, extra = '') => csproj('Microsoft.NET.Sdk', { TargetFramework: tfm, Nullable: 'enable', ImplicitUsings: 'enable', IsPackable: 'false' },
  `  <ItemGroup>\n    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.*" />\n    <PackageReference Include="xunit" Version="2.*" />\n    <PackageReference Include="xunit.runner.visualstudio" Version="3.*" />\n${extra}  </ItemGroup>\n\n  <ItemGroup>\n    <Using Include="Xunit" />\n  </ItemGroup>\n\n  <ItemGroup>\n    <ProjectReference Include="..\\..\\src\\${app}\\${app}.csproj" />\n  </ItemGroup>`);

const csAgents = (name, app, kind) => agents(name, [
  `${kind} in src/${app}, xUnit tests in tests/${app}.Tests, solution ${app}.sln.`,
  'Nullable reference types are on: no `!` to silence warnings without a reason.',
  'Run `dotnet build` and `dotnet test` after changes, and `dotnet format` on files you changed.'
]);

const CS_TEMPLATES = [
  {
    id: 'csharp-console',
    label: 'C# console app (.NET)',
    description: 'A solution with a console app and an xUnit test project.',
    install: 'dotnet restore',
    files: (name, { tfm = DEFAULT_TFM } = {}) => {
      const app = csName(name);
      return {
        [`${app}.sln`]: sln([{ name: app, path: `src/${app}/${app}.csproj` }, { name: `${app}.Tests`, path: `tests/${app}.Tests/${app}.Tests.csproj` }]),
        [`src/${app}/${app}.csproj`]: csproj('Microsoft.NET.Sdk', { OutputType: 'Exe', TargetFramework: tfm, Nullable: 'enable', ImplicitUsings: 'enable', RootNamespace: app }),
        [`src/${app}/Program.cs`]: `using ${app};\n\nConsole.WriteLine(Greeter.Greet(args.Length > 0 ? args[0] : "world"));\n`,
        [`src/${app}/Greeter.cs`]: `namespace ${app};\n\npublic static class Greeter\n{\n    public static string Greet(string who) => $"Hello, {who}!";\n}\n`,
        [`tests/${app}.Tests/${app}.Tests.csproj`]: testProj(tfm, app),
        [`tests/${app}.Tests/GreeterTests.cs`]: `namespace ${app}.Tests;\n\npublic class GreeterTests\n{\n    [Fact]\n    public void Greets_by_name() => Assert.Equal("Hello, Ada!", Greeter.Greet("Ada"));\n}\n`,
        'README.md': `# ${name}\n\n\`\`\`\ndotnet run --project src/${app} -- Ada\ndotnet test\n\`\`\`\n`,
        'AGENTS.md': csAgents(name, app, 'C# console app'),
        '.gitignore': CS_IGNORE
      };
    }
  },
  {
    id: 'csharp-webapi',
    label: 'C# web API (ASP.NET Core)',
    description: 'Minimal API with OpenAPI, integration tests with xUnit. Runs on localhost:5080.',
    install: 'dotnet restore',
    files: (name, { tfm = DEFAULT_TFM } = {}) => {
      const app = csName(name);
      const major = (/^net(\d+)/.exec(tfm) || [])[1] || '10';
      return {
        [`${app}.sln`]: sln([{ name: app, path: `src/${app}/${app}.csproj` }, { name: `${app}.Tests`, path: `tests/${app}.Tests/${app}.Tests.csproj` }]),
        [`src/${app}/${app}.csproj`]: csproj('Microsoft.NET.Sdk.Web', { TargetFramework: tfm, Nullable: 'enable', ImplicitUsings: 'enable', RootNamespace: app },
          `  <ItemGroup>\n    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="${major}.*" />\n  </ItemGroup>`),
        [`src/${app}/Program.cs`]: `var builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddOpenApi();\n\nvar app = builder.Build();\n\nif (app.Environment.IsDevelopment())\n{\n    app.MapOpenApi(); // the API description at /openapi/v1.json\n}\n\napp.MapGet("/", () => Results.Ok(new { name = "${app}", status = "ok" }));\napp.MapGet("/hello/{name}", (string name) => new Greeting($"Hello, {name}!"));\n\napp.Run();\n\npublic record Greeting(string Message);\n\n// Lets the tests start the app with WebApplicationFactory<Program>.\npublic partial class Program;\n`,
        [`src/${app}/Properties/launchSettings.json`]: json({ profiles: { http: { commandName: 'Project', launchBrowser: false, applicationUrl: 'http://localhost:5080', environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' } } } }),
        [`src/${app}/appsettings.json`]: json({ Logging: { LogLevel: { Default: 'Information', 'Microsoft.AspNetCore': 'Warning' } }, AllowedHosts: '*' }),
        [`src/${app}/${app}.http`]: `@host = http://localhost:5080\n\nGET {{host}}/hello/Ada\n\n###\n\nGET {{host}}/openapi/v1.json\n`,
        [`tests/${app}.Tests/${app}.Tests.csproj`]: testProj(tfm, app, `    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="${major}.*" />\n`),
        [`tests/${app}.Tests/ApiTests.cs`]: `using System.Net.Http.Json;\nusing Microsoft.AspNetCore.Mvc.Testing;\n\nnamespace ${app}.Tests;\n\npublic class ApiTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>\n{\n    [Fact]\n    public async Task Hello_greets_by_name()\n    {\n        var greeting = await factory.CreateClient().GetFromJsonAsync<Greeting>("/hello/Ada");\n        Assert.Equal("Hello, Ada!", greeting?.Message);\n    }\n}\n`,
        'README.md': `# ${name}\n\n\`\`\`\ndotnet run --project src/${app}     # http://localhost:5080/hello/Ada\ndotnet test\n\`\`\`\n\nThe API description is at http://localhost:5080/openapi/v1.json while running in Development. Requests to try are in \`src/${app}/${app}.http\`.\n`,
        'AGENTS.md': csAgents(name, app, 'ASP.NET Core minimal API'),
        '.gitignore': CS_IGNORE
      };
    }
  }
];

TEMPLATES.push(...CS_TEMPLATES);

// Files to write for a template, plus the CLAUDE.md that imports AGENTS.md (Claude Code reads CLAUDE.md).
function render(id, name, opts = {}) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  const files = t.files(String(name).trim(), opts);
  if (files['AGENTS.md'] && !files['CLAUDE.md']) files['CLAUDE.md'] = '@AGENTS.md\n';
  return { files, install: t.install || null, installFallback: t.installFallback || null, run: t.run || null };
}

const list = () => TEMPLATES.map(({ id, label, description }) => ({ id, label, description }));

module.exports = { validName, pkgName, pyName, csName, tfmFromSdks, render, list, DEFAULT_TFM };

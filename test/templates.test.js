const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/templates');

test('validName accepts ordinary folder names only', () => {
  for (const n of ['my-app', 'App 2', 'tool_x.v2']) assert.equal(t.validName(n), true, n);
  for (const n of ['', ' x', '../x', 'a/b', 'con', 'name.', 'a:b', '-x']) assert.equal(t.validName(n), false, n);
});

test('package names are normalized', () => {
  assert.equal(t.pkgName('My Cool App'), 'my-cool-app');
  assert.equal(t.pyName('9 Lives'), '_9_lives');
});

test('every template renders AGENTS.md, a CLAUDE.md import and a .gitignore', () => {
  for (const { id } of t.list()) {
    const r = t.render(id, 'Demo App');
    assert.ok(r.files['AGENTS.md'], id);
    assert.equal(r.files['CLAUDE.md'], '@AGENTS.md\n', id);
    assert.ok(r.files['.gitignore'], id);
    for (const [f, text] of Object.entries(r.files)) {
      assert.equal(typeof text, 'string', `${id}/${f}`);
      if (f.endsWith('.json')) JSON.parse(text);
    }
  }
  assert.equal(t.render('web-vite', 'x').run, 'npm run dev');
  assert.ok(t.render('python', 'Demo App').files['src/demo_app/__init__.py']);
  assert.equal(t.render('nope', 'x'), null);
});

test('C# names are PascalCase identifiers', () => {
  assert.equal(t.csName('my web-api'), 'MyWebApi');
  assert.equal(t.csName('2fast'), 'App2fast');
  assert.equal(t.csName('...'), 'App');
});

test('the newest installed SDK picks the target framework', () => {
  assert.equal(t.tfmFromSdks('8.0.404 [C:\\Program Files\\dotnet\\sdk]\n10.0.100 [C:\\Program Files\\dotnet\\sdk]\n9.0.300 [x]\n'), 'net10.0');
  assert.equal(t.tfmFromSdks(''), null);
});

test('C# templates make a solution with the app and a test project', () => {
  const tasks = require('../src/tasks');
  for (const id of ['csharp-console', 'csharp-webapi']) {
    const r = t.render(id, 'my web-api', { tfm: 'net9.0' });
    const f = r.files;
    assert.equal(r.install, 'dotnet restore');
    assert.match(f['src/MyWebApi/MyWebApi.csproj'], /<TargetFramework>net9\.0<\/TargetFramework>/);
    assert.match(f['tests/MyWebApi.Tests/MyWebApi.Tests.csproj'], /<ProjectReference Include="..\\..\\src\\MyWebApi\\MyWebApi.csproj" \/>/);
    // The Run menu finds the app (not the tests) in the solution.
    assert.deepEqual(tasks.slnProjects(f['MyWebApi.sln']).map((p) => p.file), ['src/MyWebApi/MyWebApi.csproj', 'tests/MyWebApi.Tests/MyWebApi.Tests.csproj']);
    assert.ok(f['MyWebApi.sln'].includes('\r\n'));
  }
  const web = t.render('csharp-webapi', 'api', { tfm: 'net9.0' }).files;
  assert.match(web['src/Api/Api.csproj'], /Microsoft\.AspNetCore\.OpenApi" Version="9\.\*"/);
  assert.match(web['src/Api/Program.cs'], /public partial class Program;/);
  assert.equal(JSON.parse(web['src/Api/Properties/launchSettings.json']).profiles.http.applicationUrl, 'http://localhost:5080');
  assert.match(t.render('csharp-console', 'x').files['src/X/X.csproj'], /net10\.0/);
});

// New projects made by the framework's own generator, so they start on its latest release: SharePoint
// Framework (Yeoman generator), TanStack Start (TanStack CLI) and Next.js (create-next-app). plan() lists
// the files to write first and the commands the widget runs in a terminal tab; it does no I/O itself.
const { chain } = require('./tasks');
const spfx = require('./spfx');

// npm's naming rules, which create-next-app applies to the folder name.
const npmName = (name) => /^[a-z0-9][a-z0-9._-]{0,213}$/.test(String(name)) && !/[.]$/.test(String(name));
const suggestNpmName = (name) => String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '') || 'app';

const agentsFile = (name, lines) => `# ${name}\n\nInstructions for Claude in this project.\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;

const TANSTACK_ADD_ONS = 'tanstack-query,form,table';

const GENERATOR_TEMPLATES = [
  {
    id: 'spfx',
    label: 'SharePoint Framework (SPFx)',
    description: 'Web part, extension or library on the latest SPFx release, with the Node.js version it needs.',
    package: spfx.GENERATOR
  },
  {
    id: 'tanstack-start',
    label: 'TypeScript app (TanStack Start)',
    description: 'React with TanStack Router, Query, Form and Table, Tailwind and ESLint, from the TanStack CLI.',
    package: '@tanstack/react-start'
  },
  {
    id: 'nextjs',
    label: 'Next.js app',
    description: 'TypeScript, App Router, Tailwind and ESLint in src/, from create-next-app. Lower-case name.',
    package: 'next',
    npmName: true
  }
];

const isGenerator = (id) => GENERATOR_TEMPLATES.some((t) => t.id === id);

// Lines appended to a file from any shell: the text travels base64-encoded, so no quoting can break it.
const appendCommand = (file, text) =>
  `node -e "require('fs').appendFileSync('${file}', Buffer.from(process.argv[1], 'base64'))" ${Buffer.from(text).toString('base64')}`;

// { files, steps, notes, error } for a new project in <projectsRoot>/<name>.
// opts: { install, git, github, ps, spfxInfo: spfx.latest() result, spfx: { componentType, framework, componentName } }
function plan(id, name, opts = {}) {
  const { install = true, git = true, github = false, ps = false, isWin = process.platform === 'win32', spfxInfo = null } = opts;
  // Generators get empty input: in a terminal tab, Yeoman otherwise keeps waiting on the keyboard after it
  // finishes (and a question nobody answers would hang the setup instead of failing it).
  const noInput = (c) => (ps ? `$null | ${c}` : `${c} < ${isWin ? 'nul' : '/dev/null'}`);
  const files = {};
  const steps = [];
  const notes = [];

  if (id === 'spfx') {
    const o = { componentType: 'webpart', framework: 'react', componentName: 'HelloWorld', ...(opts.spfx || {}) };
    if (o.componentType !== 'library' && !spfx.validComponentName(o.componentName)) return { error: 'Component name: start with a letter; letters, numbers and spaces only' };
    const info = spfxInfo && !spfxInfo.error ? spfxInfo : null;
    files['AGENTS.md'] = agentsFile(name, spfx.agentsLines(info));
    files['CLAUDE.md'] = '@AGENTS.md\n';
    if (info && info.nodeMajor) files['.nvmrc'] = `${info.nodeMajor}\n`;
    // The generator writes into <cwd>/<solution name>, so it runs from the folder above the project.
    steps.push('cd ..', noInput(spfx.generatorCommand({ version: info ? info.version : 'latest', nodeMajor: info && info.nodeMajor, solutionName: name, ...o })), `cd "${name}"`);
    if (!info) notes.push(`Couldn't reach npm to check the latest SPFx${spfxInfo && spfxInfo.error ? ` (${spfxInfo.error})` : ''}, so the generator's newest version is used.`);
    // The generator itself runs on the right Node through npx (above). npm install only warns about the engine.
    if (info && info.nodeOk === false && info.nodeMajor) {
      notes.push(`SPFx ${info.version} supports Node.js ${info.node}; you have ${info.installedNode}. The generator ran on Node ${info.nodeMajor} through npx. Builds may still work on your version, but it isn't supported: if something fails, switch to Node ${info.nodeMajor} (nvm-windows, fnm and Volta read the project's .nvmrc).`);
    }
  } else if (id === 'tanstack-start') {
    files['AGENTS.md'] = agentsFile(name, [
      'TanStack Start (React, TypeScript, Vite): routes are files in src/routes (TanStack Router), data with TanStack Query, forms with TanStack Form, tables with TanStack Table, styles with Tailwind.',
      'Look up TanStack APIs before using them (`npx @tanstack/cli doc <library> <path>` or context7); they change often.',
      'Run `npm run lint` and `npm run build` before calling a change done. Check pages in the built-in browser (`npm run dev`, port 3000).'
    ]);
    files['CLAUDE.md'] = '@AGENTS.md\n';
    const pkg = suggestNpmName(name);
    steps.push(noInput(`npx -y @tanstack/cli@latest create ${pkg} --target-dir . --framework React --add-ons ${TANSTACK_ADD_ONS} --toolchain eslint --no-examples --no-git --no-intent --package-manager npm --no-install -y -f`));
  } else if (id === 'nextjs') {
    if (!npmName(name)) return { error: `Next.js needs a lower-case name without spaces, e.g. "${suggestNpmName(name)}"` };
    // create-next-app refuses a folder with AGENTS.md/CLAUDE.md in it and writes its own (Next.js rules);
    // the project notes are added to its AGENTS.md afterwards.
    steps.push(noInput('npx -y create-next-app@latest . --ts --eslint --tailwind --app --src-dir --use-npm --skip-install --disable-git --yes'));
    steps.push(appendCommand('AGENTS.md', `\n## This project\n\n- Next.js App Router in src/app, TypeScript, Tailwind CSS.\n- Run \`npm run lint\` and \`npm run build\` before calling a change done. Check pages in the built-in browser (\`npm run dev\`, port 3000).\n`));
  } else {
    return { error: 'Unknown template' };
  }

  if (install) steps.push('npm install');
  if (git) steps.push('git init -b main', 'git add -A', 'git commit -m "Initial commit"');
  if (git && github) steps.push(`gh repo create ${name.replace(/\s+/g, '-')} --private --source . --push`);
  return { files, steps, command: chain(steps, ps), notes };
}

const list = () => GENERATOR_TEMPLATES.map(({ id, label, description, npmName: n }) => ({ id, label, description, generator: true, npmName: !!n }));

module.exports = { GENERATOR_TEMPLATES, isGenerator, plan, list, npmName, suggestNpmName, appendCommand };

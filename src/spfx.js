// New SPFx project: the latest SharePoint Framework release (from the npm registry), whether the installed
// Node.js can build it, and the Yeoman generator command that creates the solution in the project folder.
const https = require('https');

const GENERATOR = '@microsoft/generator-sharepoint';
const REGISTRY_URL = `https://registry.npmjs.org/${GENERATOR.replace('/', '%2F')}`;

const COMPONENT_TYPES = {
  webpart: { label: 'Web part', args: ['--component-type', 'webpart'] },
  'application-customizer': { label: 'Extension: Application Customizer', args: ['--component-type', 'extension', '--extension-type', 'ApplicationCustomizer'] },
  'command-set': { label: 'Extension: ListView Command Set', args: ['--component-type', 'extension', '--extension-type', 'ListViewCommandSet'] },
  library: { label: 'Library', args: ['--component-type', 'library'] }
};
const FRAMEWORKS = { react: 'React', none: 'No framework', minimal: 'Minimal' };

const parseVersion = (v) => {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
};
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

// Whether a version satisfies an npm engines range: comparators (>=, >, <=, <, =, ^, ~, x-ranges) joined
// by spaces, alternatives by ||. Enough for the ranges SPFx publishes (">=22.14.0 < 23.0.0", "^18 || ^20").
function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  return String(range).split('||').some((alt) => {
    const parts = alt.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every((p) => {
      const m = /^(>=|<=|>|<|=|\^|~)?v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(p);
      if (!m) return false;
      const [, op = '', ...nums] = m;
      const given = nums.filter((n) => n !== undefined && n !== 'x' && n !== '*').map(Number);
      const t = [given[0] || 0, given[1] || 0, given[2] || 0];
      const c = cmp(v, t);
      if (op === '>=') return c >= 0;
      if (op === '>') return c > 0;
      if (op === '<=') return c <= 0;
      if (op === '<') return c < 0;
      if (op === '^') return c >= 0 && v[0] === t[0];
      if (op === '~') return c >= 0 && v[0] === t[0] && v[1] === t[1];
      // =, or a bare (possibly partial) version: match the parts given.
      return given.every((n, i) => v[i] === n);
    });
  });
}

// The Node.js major to run the generator with: the newest major the range allows (">=22.14.0 < 23.0.0" -> 22).
function nodeMajor(range) {
  for (let major = 30; major >= 12; major--) if (satisfies(`${major}.99.99`, range) || satisfies(`${major}.0.0`, range) || satisfies(`${major}.14.0`, range)) return major;
  return null;
}

// Registry document -> { version, node, released }, the latest stable release.
function latestFrom(doc) {
  const version = doc && doc['dist-tags'] && doc['dist-tags'].latest;
  if (!version || !doc.versions || !doc.versions[version]) return null;
  const engines = doc.versions[version].engines || {};
  return { version, node: engines.node || null, released: (doc.time && doc.time[version]) || null };
}

function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`npm registry answered ${res.statusCode}`)); }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (raw += d));
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (err) { reject(err); } });
    });
    req.on('timeout', () => req.destroy(new Error('npm registry timed out')));
    req.on('error', reject);
  });
}

// { version, node, released, nodeMajor, installedNode, nodeOk } or { error } when offline.
async function latest({ installedNode = null, get = fetchJson } = {}) {
  let info;
  try {
    info = latestFrom(await get(REGISTRY_URL));
  } catch (err) {
    return { error: err.message, installedNode };
  }
  if (!info) return { error: 'No release found', installedNode };
  return {
    ...info,
    nodeMajor: info.node ? nodeMajor(info.node) : null,
    installedNode,
    nodeOk: installedNode && info.node ? satisfies(installedNode, info.node) : null
  };
}

const validComponentName = (n) => /^[A-Za-z][A-Za-z0-9 ]{0,39}$/.test(String(n || ''));

// The generator command, run from the folder that holds the project folder: with --solution-name the
// generator writes into <cwd>/<solution name>, which is the project folder. Names are validated before
// (letters, numbers, spaces, dots, dashes, underscores), so double quotes are enough in every shell.
function generatorCommand({ version, nodeMajor: major, solutionName, componentType = 'webpart', framework = 'react', componentName = 'HelloWorld' }) {
  const type = COMPONENT_TYPES[componentType] || COMPONENT_TYPES.webpart;
  const pkgs = [...(major ? [`node@${major}`] : []), 'yo@5', `${GENERATOR}@${version || 'latest'}`];
  const args = [
    '--solution-name', `"${solutionName}"`,
    ...type.args,
    ...(componentType === 'library' ? [] : ['--component-name', `"${componentName}"`]),
    ...(componentType === 'webpart' ? ['--framework', FRAMEWORKS[framework] ? framework : 'react'] : []),
    '--environment', 'spo', '--package-manager', 'npm', '--skip-install', '--no-insight'
  ];
  return `npx -y ${pkgs.map((p) => `-p ${p}`).join(' ')} -- yo @microsoft/sharepoint ${args.join(' ')}`;
}

// AGENTS.md lines for the new solution.
function agentsLines(info) {
  const node = info && info.node ? ` Microsoft supports it on Node.js ${info.node}${info.nodeMajor ? ` (.nvmrc: ${info.nodeMajor})` : ''}; if a build fails on another version, try that first.` : '';
  return [
    `SharePoint Framework ${info && info.version ? info.version : ''} solution, built with Heft (\`npm run build\`, \`npm run start\`).${node}`,
    'TypeScript in src/; web part properties in the manifest and the property pane, strings in loc/.',
    'Run `npm run build` before calling a change done. Package for the app catalog with the production build (it writes sharepoint/solution/*.sppkg).'
  ];
}

module.exports = { GENERATOR, COMPONENT_TYPES, FRAMEWORKS, satisfies, nodeMajor, latestFrom, latest, fetchJson, validComponentName, generatorCommand, agentsLines };

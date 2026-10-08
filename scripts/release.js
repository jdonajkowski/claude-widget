// Releases a version from the current branch: tests, version commit, push, pull request, merge, tag on main,
// then waits for the GitHub Actions build that attaches the installers to the release.
//   node scripts/release.js 0.13.0 [--dry-run]
// Run it on the feature branch with a clean working tree. Needs git, npm and an authenticated gh.
const { execFileSync } = require('child_process');

const version = process.argv[2];
const dry = process.argv.includes('--dry-run');
const win = process.platform === 'win32';

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail('usage: node scripts/release.js <x.y.z> [--dry-run]');

// Runs a command with its output shown; with --dry-run only prints it. out: return its output instead.
function run(cmd, args, { out = false, readOnly = false } = {}) {
  const line = `${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
  if (dry && !readOnly) return console.log(`[dry run] ${line}`);
  if (!out) console.log(`> ${line}`);
  const opts = { encoding: 'utf8', shell: win && cmd === 'npm', stdio: out ? ['ignore', 'pipe', 'inherit'] : 'inherit' };
  const res = execFileSync(cmd, args, opts);
  return out ? res.trim() : undefined;
}

const branch = run('git', ['branch', '--show-current'], { out: true, readOnly: true });
if (!branch || branch === 'main') fail('start from a feature branch, not main');
if (run('git', ['status', '--porcelain'], { out: true, readOnly: true })) fail('the working tree is not clean');
const tag = `v${version}`;
if (run('git', ['tag', '--list', tag], { out: true, readOnly: true })) fail(`${tag} already exists`);

run('npm', ['test']);
run('npm', ['version', version, '--no-git-tag-version']);
run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', `chore: release ${version}`]);
run('git', ['push', '-u', 'origin', branch]);
run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `Release ${version}`, '--body', `Release ${version}.`]);
run('gh', ['pr', 'merge', branch, '--merge']);
run('git', ['checkout', 'main']);
run('git', ['pull']);
// The tag must be on the merge commit, or CI refuses it (the version in package.json has to match).
run('git', ['tag', tag]);
run('git', ['push', 'origin', tag]);
if (!dry) {
  console.log('Waiting for the build...');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000); // the run takes a moment to appear
  run('gh', ['run', 'watch', '--exit-status', run('gh', ['run', 'list', '--branch', tag, '--limit', '1', '--json', 'databaseId', '-q', '.[0].databaseId'], { out: true })]);
}
run('gh', ['release', 'view', tag, '--json', 'url,assets', '-q', '.url']);

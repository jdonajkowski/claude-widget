// Reads branch, changed-file count and ahead/behind for the footer from `git status --porcelain=v2 --branch`.
const { execFile } = require('child_process');

function parse(out) {
  const info = { branch: null, ahead: 0, behind: 0, upstream: false, changed: 0 };
  for (const line of String(out).split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      info.branch = head === '(detached)' ? 'detached' : head;
    } else if (line.startsWith('# branch.upstream ')) {
      info.upstream = true;
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { info.ahead = Number(m[1]); info.behind = Number(m[2]); }
    } else if (/^[12u?] /.test(line)) {
      info.changed++;
    }
  }
  return info;
}

// Resolves to null when cwd is not inside a git repo (or git is missing or too slow).
function read(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain=v2', '--branch'], { cwd, timeout: 4000, windowsHide: true },
      (err, stdout) => resolve(err ? null : parse(stdout)));
  });
}

module.exports = { parse, read };

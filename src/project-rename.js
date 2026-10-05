// Renaming a project renames its folder, then moves Claude's history for it (<config dir>/projects/<encoded
// cwd>, which also holds Claude's memory for the folder) so the reopened session continues the same
// conversation (checked with Claude Code 2.1.289: --continue finds it under the new name).
const fs = require('fs');
const path = require('path');
const { encodeHistoryDir } = require('./sessions');

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// Why name (already trimmed) can't be a folder name, or null.
function nameError(name, isWin = process.platform === 'win32') {
  const n = String(name || '');
  if (!n) return 'Enter a name.';
  if (n === '.' || n === '..') return 'Not a valid folder name.';
  if (isWin && /[<>:"/\\|?*\x00-\x1f]/.test(n)) return 'A folder name can\'t contain \\ / : * ? " < > |';
  if (!isWin && n.includes('/')) return 'A folder name can\'t contain /';
  if (isWin && n.endsWith('.')) return 'A folder name can\'t end with a dot.';
  if (isWin && RESERVED.test(n)) return `${n} is a name Windows keeps for itself.`;
  if (n.length > 120) return 'That name is too long.';
  return null;
}

// Errors Windows gives while something still has the folder open; processes take a moment to exit.
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

// fs.rename, retried while the folder is still busy. Returns null, or the last error.
async function renameWithRetry(from, to, { tries = 20, delayMs = 250, rename = fs.promises.rename } = {}) {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to);
      return null;
    } catch (err) {
      if (!BUSY.has(err.code) || i >= tries) return err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// Moves <claudeDir>/projects/<from> to <to>. If <to> already has history, moves only what it lacks.
function moveHistory(claudeDir, from, to, { isWin = process.platform === 'win32', fsx = fs } = {}) {
  const root = path.join(claudeDir, 'projects');
  const src = path.join(root, encodeHistoryDir(from));
  const dst = path.join(root, encodeHistoryDir(to));
  if (src === dst || !fsx.existsSync(src)) return;
  // A case-only rename on Windows: the same folder, so just fix its case.
  if (isWin && src.toLowerCase() === dst.toLowerCase()) return fsx.renameSync(src, dst);
  if (!fsx.existsSync(dst)) return fsx.renameSync(src, dst);
  merge(src, dst, fsx);
}

function merge(src, dst, fsx) {
  for (const e of fsx.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (!fsx.existsSync(d)) fsx.renameSync(s, d);
    else if (e.isDirectory() && fsx.statSync(d).isDirectory()) merge(s, d, fsx);
  }
}

module.exports = { nameError, renameWithRetry, moveHistory };

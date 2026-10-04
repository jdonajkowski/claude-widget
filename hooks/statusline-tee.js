// Claude Code statusLine wrapper: saves the status JSON for the widget's footer, then runs your real
// status line command with the same input and passes its output through.
//   "statusLine": { "type": "command", "command": "node \".../statusline-tee.js\" npx -y ccstatusline@latest" }
// Writes to the file named by CLAUDE_WIDGET_STATUS (set only inside the widget), or --out=<file> for debugging.
const fs = require('fs');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
let out = process.env.CLAUDE_WIDGET_STATUS;
if (args[0] && args[0].startsWith('--out=')) out = args.shift().slice('--out='.length);
const command = args.join(' ');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  if (out) {
    // Write then rename so the widget never reads a half-written file; fall back if the rename is blocked.
    try {
      fs.writeFileSync(out + '.tmp', raw);
      fs.renameSync(out + '.tmp', out);
    } catch {
      try { fs.writeFileSync(out, raw); } catch { /* never break the status line */ }
    }
  }
  if (!command) return;
  const child = spawn(command, { shell: true, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(raw);
  child.on('exit', (code) => { process.exitCode = code ?? 0; });
});

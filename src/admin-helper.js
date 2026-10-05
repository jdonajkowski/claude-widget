// Runs elevated (started through UAC by src/admin-shell.js, as the widget's executable with
// ELECTRON_RUN_AS_NODE) and hosts the admin terminal's PTY. It connects back to the widget over the
// named pipe given on the command line, proves itself with the token, then relays the terminal as
// JSON lines until the pipe closes. It never listens for connections itself.
const net = require('net');
const pty = require('node-pty');

const [pipe, token] = process.argv.slice(2);
if (!pipe || !token) process.exit(2);

let term = null;
const sock = net.connect(pipe);
const send = (o) => { if (!sock.destroyed) sock.write(JSON.stringify(o) + '\n'); };
const quit = () => {
  try { if (term) term.kill(); } catch { /* gone */ }
  process.exit(0);
};

function handle(m) {
  if (m.spawn && !term) {
    const s = m.spawn;
    try {
      term = pty.spawn(s.file, s.args, { name: 'xterm-256color', cols: s.cols || 100, rows: s.rows || 30, cwd: s.cwd, env: s.env, useConpty: true });
    } catch (err) {
      send({ data: `\r\n\x1b[31mCould not start ${s.file}: ${err.message}\x1b[0m\r\n` });
      send({ exit: -1 });
      return;
    }
    term.onData((data) => send({ data }));
    term.onExit(({ exitCode }) => { send({ exit: exitCode }); sock.end(); setTimeout(quit, 500); });
  } else if (m.input !== undefined && term) {
    term.write(m.input);
  } else if (m.resize && term) {
    try { term.resize(m.resize[0], m.resize[1]); } catch { /* exited */ }
  } else if (m.kill) {
    quit();
  }
}

sock.on('connect', () => send({ hello: token }));
let buf = '';
sock.setEncoding('utf8');
sock.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try { handle(JSON.parse(line)); } catch { /* ignore a bad line */ }
  }
});
sock.on('close', quit);
sock.on('error', quit);

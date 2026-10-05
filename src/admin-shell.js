// Admin terminal on Windows: a PTY can't be elevated from a normal process, so the widget opens a
// named pipe with a random name, starts src/admin-helper.js elevated (one UAC prompt), and the helper
// connects back and runs the shell. Only a client that sends the random token gets the terminal, and
// only the first one. Returns a node-pty-like object, so the rest of the widget treats it as any PTY.
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

// The PowerShell command that asks for elevation and starts the helper hidden.
function elevateCommand({ execPath, helper, pipe, token }) {
  const inner = `$env:ELECTRON_RUN_AS_NODE='1'; & ${psq(execPath)} ${psq(helper)} ${psq(pipe)} ${psq(token)}`;
  return `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-WindowStyle','Hidden','-EncodedCommand','${encode(inner)}'`;
}

function startElevated({ execPath, helper, launch, cwd, env, cols, rows, timeoutMs = 120000 }) {
  const pipe = `\\\\.\\pipe\\claude-widget-admin-${crypto.randomBytes(12).toString('hex')}`;
  const token = crypto.randomBytes(24).toString('hex');
  const dataCbs = [];
  const exitCbs = [];
  let sock = null;
  let done = false;
  let size = [cols || 100, rows || 30];
  const emit = (data) => dataCbs.forEach((cb) => cb(data));
  const finish = (code) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    server.close();
    if (sock) sock.destroy();
    exitCbs.forEach((cb) => cb({ exitCode: code }));
  };
  const send = (o) => { if (sock && !sock.destroyed) sock.write(JSON.stringify(o) + '\n'); };

  const server = net.createServer((s) => {
    if (sock) { s.destroy(); return; }
    let buf = '';
    let authed = false;
    s.setEncoding('utf8');
    s.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { s.destroy(); return; }
        if (!authed) {
          if (m.hello !== token || sock) { s.destroy(); return; }
          authed = true;
          sock = s;
          clearTimeout(timer);
          server.close(); // no further connections
          emit('\x1b[2J\x1b[H');
          send({ spawn: { ...launch, cwd, env, cols: size[0], rows: size[1] } });
          continue;
        }
        if (typeof m.data === 'string') emit(m.data);
        if (typeof m.exit === 'number') finish(m.exit);
      }
    });
    s.on('close', () => { if (s === sock) finish(0); });
    s.on('error', () => {});
  });

  const timer = setTimeout(() => {
    emit('\r\n\x1b[31mNo administrator approval. Press Enter to ask again.\x1b[0m\r\n');
    finish(-1);
  }, timeoutMs);

  server.on('error', (err) => { emit(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`); finish(-1); });
  server.listen(pipe, () => {
    emit('\x1b[33mWaiting for administrator approval (UAC)…\x1b[0m\r\n');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', elevateCommand({ execPath, helper, pipe, token })], { windowsHide: true, stdio: 'ignore' });
    ps.on('exit', (code) => {
      if (code !== 0 && !sock) {
        emit('\r\n\x1b[31mAdministrator approval was declined. Press Enter to ask again.\x1b[0m\r\n');
        finish(-1);
      }
    });
  });

  return {
    write: (data) => send({ input: data }),
    resize: (c, r) => { size = [c, r]; send({ resize: [c, r] }); },
    kill: () => { send({ kill: true }); finish(0); },
    onData: (cb) => dataCbs.push(cb),
    onExit: (cb) => exitCbs.push(cb)
  };
}

module.exports = { startElevated, elevateCommand };

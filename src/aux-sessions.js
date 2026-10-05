// Extra terminals next to a project's Claude session, shown as tabs above the terminal:
//   task         a command from the Run menu (npm run dev, cargo test, ...), restarted with Enter
//   shell        a plain shell in the project folder
//   admin        an elevated shell (UAC on Windows through src/admin-shell.js, sudo -s on Linux)
//   admin-claude Claude Code elevated (Windows), with the widget's hooks and change log
// Ids are "aux:<n>"; PTY messages use the same channels as Claude sessions.
const { detectServerUrl } = require('./tasks');

function createAux({ pty, isWin, send, startElevated = null, onUrl = () => {}, onChange = () => {} }) {
  const terms = new Map();
  let next = 1;

  function spawnTerm(a, cols, rows) {
    a.urlFound = false;
    a.tail = '';
    try {
      a.term = a.elevated && startElevated
        ? startElevated({ launch: a.launch, cwd: a.cwd, env: a.env, cols, rows })
        : pty.spawn(a.launch.file, a.launch.args, { name: 'xterm-256color', cols: cols || 100, rows: rows || 30, cwd: a.cwd, env: a.env, useConpty: isWin ? true : undefined });
    } catch (err) {
      a.term = null;
      a.running = false;
      send('pty:data', { id: a.id, data: `\r\n\x1b[31mFailed to start ${a.launch.file}: ${err.message}\x1b[0m\r\n` });
      send('pty:exit', { id: a.id, code: -1 });
      onChange();
      return;
    }
    a.running = true;
    const current = a.term;
    current.onData((data) => {
      send('pty:data', { id: a.id, data });
      if (a.kind === 'task' && !a.urlFound) {
        // A URL can arrive split across chunks, so only finished lines are searched.
        a.tail = (a.tail + data).slice(-2000);
        const url = detectServerUrl(a.tail.slice(0, a.tail.lastIndexOf('\n') + 1));
        if (url) { a.urlFound = true; onUrl(a, url); }
      }
    });
    current.onExit(({ exitCode }) => {
      if (a.term !== current) return;
      a.term = null;
      a.running = false;
      send('pty:exit', { id: a.id, code: exitCode });
      onChange();
    });
    onChange();
  }

  // spec: { projectId, cwd, title, kind, launch: {file, args}, env, elevated }
  function open(spec, cols, rows) {
    const id = `aux:${next++}`;
    const a = { ...spec, id, term: null, running: false };
    terms.set(id, a);
    spawnTerm(a, cols, rows);
    return id;
  }

  function kill(a) {
    if (!a.term) return;
    const t = a.term;
    a.term = null;
    try { t.kill(); } catch { /* gone */ }
  }

  return {
    open,
    has: (id) => terms.has(id),
    get: (id) => terms.get(id),
    write: (id, data) => { const a = terms.get(id); if (a && a.term) a.term.write(data); },
    resize: (id, cols, rows) => {
      const a = terms.get(id);
      if (a && a.term && cols > 0 && rows > 0) { try { a.term.resize(cols, rows); } catch { /* exited */ } }
    },
    restart: (id, cols, rows) => { const a = terms.get(id); if (!a) return; kill(a); spawnTerm(a, cols, rows); },
    close: (id) => { const a = terms.get(id); if (!a) return false; terms.delete(id); kill(a); onChange(); return true; },
    closeProject: (projectId) => { for (const a of [...terms.values()]) if (a.projectId === projectId) { terms.delete(a.id); kill(a); } onChange(); },
    closeAll: () => { for (const a of terms.values()) kill(a); terms.clear(); },
    list: () => [...terms.values()].map((a) => ({ id: a.id, projectId: a.projectId, title: a.title, kind: a.kind, running: a.running }))
  };
}

module.exports = { createAux };

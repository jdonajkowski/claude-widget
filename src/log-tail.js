// Polls an append-only JSON Lines file and reports newly completed lines as parsed objects.
// Keeps partial trailing lines (as bytes, so split UTF-8 survives) and restarts from 0 if the file shrinks.
const fs = require('fs');

function createLogTail(file, onEvents, { intervalMs = 300 } = {}) {
  let offset = 0;
  let pending = Buffer.alloc(0);

  function poll() {
    let size;
    try { size = fs.statSync(file).size; } catch { return; }
    if (size < offset) { offset = 0; pending = Buffer.alloc(0); }
    if (size === offset) return;
    const chunk = Buffer.alloc(size - offset);
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      fs.readSync(fd, chunk, 0, chunk.length, offset);
    } catch { return; } finally { if (fd !== undefined) fs.closeSync(fd); }
    offset = size;
    const data = Buffer.concat([pending, chunk]);
    const end = data.lastIndexOf(0x0a);
    if (end === -1) { pending = data; return; }
    pending = data.subarray(end + 1);
    const events = [];
    for (const line of data.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip bad line */ }
    }
    if (events.length) onEvents(events);
  }

  function reset() {
    try { fs.writeFileSync(file, ''); } catch { /* unwritable: tail just stays empty */ }
    offset = 0;
    pending = Buffer.alloc(0);
  }

  const timer = intervalMs > 0 ? setInterval(poll, intervalMs) : null;
  return { poll, reset, close: () => timer && clearInterval(timer) };
}

module.exports = { createLogTail };

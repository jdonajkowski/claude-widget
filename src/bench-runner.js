// Quick before/after benchmark, run as a separate Node process (the widget's executable with
// ELECTRON_RUN_AS_NODE). Prints one JSON line per stage ({ stage, label, step, of }) and a final { result }.
// About 10 seconds: single-core and all-core hashing, memory copy speed, disk writes.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// SHA-256 over a 64 KB buffer for ms milliseconds: MB hashed per second.
function hashFor(ms) {
  const buf = crypto.randomBytes(64 * 1024);
  const end = Date.now() + ms;
  let n = 0;
  while (Date.now() < end) {
    for (let i = 0; i < 16; i++) crypto.createHash('sha256').update(buf).digest();
    n += 16;
  }
  return (n * buf.length) / 1048576 / (ms / 1000);
}

if (!isMainThread) {
  parentPort.postMessage(hashFor(workerData.ms));
} else {
  const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');

  function allCores(ms) {
    const n = os.cpus().length;
    return Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
      const w = new Worker(__filename, { workerData: { ms } });
      w.once('message', resolve);
      w.once('error', reject);
    }))).then((list) => list.reduce((a, b) => a + b, 0));
  }

  // Copies between two 64 MB buffers: GB per second.
  function memCopy(ms) {
    const a = Buffer.alloc(64 * 1048576, 1);
    const b = Buffer.alloc(64 * 1048576);
    const end = Date.now() + ms;
    const start = Date.now();
    let n = 0;
    while (Date.now() < end) { a.copy(b); b.copy(a); n += 2; }
    return (n * a.length) / 1073741824 / ((Date.now() - start) / 1000);
  }

  // 256 MB in 4 MB chunks, flushed to disk: MB per second.
  function diskWrite(dir) {
    const file = path.join(dir, `claude-widget-bench-${process.pid}.tmp`);
    const chunk = crypto.randomBytes(4 * 1048576);
    const start = process.hrtime.bigint();
    const fd = fs.openSync(file, 'w');
    try {
      for (let i = 0; i < 64; i++) fs.writeSync(fd, chunk);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const secs = Number(process.hrtime.bigint() - start) / 1e9;
    fs.rmSync(file, { force: true });
    return 256 / secs;
  }

  // 4 KB writes, each flushed (what databases and package managers do): writes per second.
  function diskSync(dir, ms) {
    const file = path.join(dir, `claude-widget-bench-sync-${process.pid}.tmp`);
    const chunk = crypto.randomBytes(4096);
    const fd = fs.openSync(file, 'w');
    const end = Date.now() + ms;
    const start = Date.now();
    let n = 0;
    try {
      while (Date.now() < end) { fs.writeSync(fd, chunk, 0, chunk.length, (n % 256) * 4096); fs.fsyncSync(fd); n++; }
    } finally {
      fs.closeSync(fd);
      fs.rmSync(file, { force: true });
    }
    return n / ((Date.now() - start) / 1000);
  }

  (async () => {
    const dir = process.argv[2] || os.tmpdir();
    const result = {};
    try {
      say({ stage: 'cpu1', label: 'Single core', step: 1, of: 5 });
      result.cpu1 = hashFor(2000);
      say({ stage: 'cpuN', label: 'All cores', step: 2, of: 5 });
      result.cpuN = await allCores(2500);
      say({ stage: 'mem', label: 'Memory', step: 3, of: 5 });
      result.mem = memCopy(1500);
      say({ stage: 'diskW', label: 'Disk write', step: 4, of: 5 });
      result.diskW = diskWrite(dir);
      say({ stage: 'diskSync', label: 'Disk flushes', step: 5, of: 5 });
      result.diskSync = diskSync(dir, 1500);
      say({ result });
    } catch (err) {
      say({ error: err.message, result });
    }
  })();
}

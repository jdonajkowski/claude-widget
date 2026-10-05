// Live system monitor: CPU (total and per core), memory, the home drive, GPUs and temperatures.
// The parsers are pure; createSampler polls every intervalMs while someone is watching.
//   GPU: nvidia-smi when present, else AMD/Intel GPUs through /sys/class/drm on Linux.
//   CPU temperature: hwmon on Linux; on Windows LibreHardwareMonitor's WMI sensors if it runs, else ACPI.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function cpuTimes(cpus) {
  return cpus.map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}

// Busy share between two cpuTimes() readings, total and per core, 0-100.
function cpuPercent(prev, cur) {
  const pct = (a, b) => {
    const total = b.total - a.total;
    return total > 0 ? Math.round(Math.max(0, Math.min(100, (1 - (b.idle - a.idle) / total) * 100))) : 0;
  };
  const cores = cur.map((c, i) => (prev[i] ? pct(prev[i], c) : 0));
  const sum = (list) => list.reduce((a, c) => ({ idle: a.idle + c.idle, total: a.total + c.total }), { idle: 0, total: 0 });
  return { pct: pct(sum(prev), sum(cur)), cores };
}

const num = (s) => {
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
};

const NVIDIA_QUERY = 'name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,power.limit,clocks.gr';

// nvidia-smi --query-gpu=<NVIDIA_QUERY> --format=csv,noheader,nounits
function parseNvidia(out) {
  return String(out || '').split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const [name, util, temp, memUsed, memTotal, power, powerLimit, clock] = line.split(',').map((s) => s.trim());
    return { name, util: num(util), temp: num(temp), memUsed: num(memUsed), memTotal: num(memTotal), power: num(power), powerLimit: num(powerLimit), clock: num(clock), vendor: 'nvidia' };
  });
}

const read = (fsx, p) => { try { return fsx.readFileSync(p, 'utf8').trim(); } catch { return null; } };
const list = (fsx, p) => { try { return fsx.readdirSync(p); } catch { return []; } };

const CPU_SENSORS = ['k10temp', 'coretemp', 'zenpower', 'cpu_thermal', 'cpu-thermal', 'acpitz'];

// CPU package temperature in °C from /sys/class/hwmon, preferring the CPU drivers in CPU_SENSORS order.
function linuxCpuTemp(fsx = fs, root = '/sys/class/hwmon') {
  const found = list(fsx, root).map((d) => ({ dir: path.posix.join(root, d), name: read(fsx, path.posix.join(root, d, 'name')) }));
  for (const sensor of CPU_SENSORS) {
    const hit = found.find((f) => f.name === sensor);
    if (!hit) continue;
    const t = num(read(fsx, path.posix.join(hit.dir, 'temp1_input')));
    if (t !== null) return Math.round(t / 100) / 10;
  }
  return null;
}

// AMD (and Intel) GPUs through amdgpu's sysfs files; cards without gpu_busy_percent are skipped.
function linuxDrmGpus(fsx = fs, root = '/sys/class/drm') {
  const out = [];
  for (const card of list(fsx, root).filter((d) => /^card\d+$/.test(d))) {
    const dev = path.posix.join(root, card, 'device');
    const util = num(read(fsx, path.posix.join(dev, 'gpu_busy_percent')));
    if (util === null) continue;
    const mib = (f) => { const v = num(read(fsx, path.posix.join(dev, f))); return v === null ? null : Math.round(v / 1048576); };
    const hw = list(fsx, path.posix.join(dev, 'hwmon'))[0];
    const temp = hw ? num(read(fsx, path.posix.join(dev, 'hwmon', hw, 'temp1_input'))) : null;
    const power = hw ? num(read(fsx, path.posix.join(dev, 'hwmon', hw, 'power1_average'))) : null;
    out.push({
      name: card, util, temp: temp === null ? null : Math.round(temp / 1000), memUsed: mib('mem_info_vram_used'), memTotal: mib('mem_info_vram_total'),
      power: power === null ? null : Math.round(power / 1e5) / 10, powerLimit: null, clock: null, vendor: 'amd'
    });
  }
  return out;
}

// One PowerShell call: LibreHardwareMonitor's CPU package sensor, else the first ACPI thermal zone.
const WIN_TEMP_SCRIPT = [
  "$t = $null",
  "try { $t = Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'Package|Tctl|CPU' } | Select-Object -First 1 -ExpandProperty Value } catch {}",
  "if ($null -eq $t) { try { $z = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1; if ($z) { $t = $z.CurrentTemperature / 10 - 273.15 } } catch {} }",
  "if ($null -ne $t) { [math]::Round($t, 1) }"
].join('; ');

function diskUsage(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { path: dir, total: s.blocks * s.bsize, used: (s.blocks - s.bavail) * s.bsize };
  } catch {
    return null;
  }
}

const run = (file, args, timeout = 4000) => new Promise((resolve) => {
  execFile(file, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
});

// onSample({ at, cpu, mem, disk, gpus, cpuTemp, load, uptime }). It runs while any watcher wants it: want(name, on).
function createSampler({ isWin = process.platform === 'win32', intervalMs = 2000, onSample, home = os.homedir() }) {
  let timer = null;
  const watchers = new Set();
  let prev = cpuTimes(os.cpus());
  let nvidia = true; // until nvidia-smi fails
  let tempTries = 0;
  let cpuTemp = null;
  let lastTempAt = 0;
  let busy = false;

  async function gpus() {
    if (nvidia) {
      const out = await run('nvidia-smi', [`--query-gpu=${NVIDIA_QUERY}`, '--format=csv,noheader,nounits']);
      if (out !== null) return parseNvidia(out);
      nvidia = false;
    }
    return isWin ? [] : linuxDrmGpus();
  }

  async function temp() {
    if (!isWin) return linuxCpuTemp();
    // PowerShell is slow to start, so the temperature is read every 10 s, and given up on after 3 misses.
    if (tempTries >= 3 || Date.now() - lastTempAt < 10000) return cpuTemp;
    lastTempAt = Date.now();
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_TEMP_SCRIPT], 8000);
    const t = out === null ? null : num(out.trim().split(/\r?\n/).pop());
    if (t === null) tempTries++;
    else tempTries = 0;
    cpuTemp = t;
    return t;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const cpus = os.cpus();
      const cur = cpuTimes(cpus);
      const cpu = cpuPercent(prev, cur);
      prev = cur;
      const [g, t] = await Promise.all([gpus(), temp()]);
      onSample({
        at: Date.now(),
        cpu: { ...cpu, model: (cpus[0] && cpus[0].model.trim()) || '', count: cpus.length },
        mem: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
        disk: diskUsage(isWin ? path.parse(home).root : home),
        gpus: g,
        cpuTemp: t,
        load: isWin ? null : os.loadavg(),
        uptime: os.uptime()
      });
    } finally {
      busy = false;
    }
  }

  function want(name, on) {
    if (on) watchers.add(name);
    else watchers.delete(name);
    if (watchers.size && !timer) {
      prev = cpuTimes(os.cpus());
      timer = setInterval(tick, intervalMs);
      setTimeout(tick, 300); // a first CPU reading needs a short gap after prev
    } else if (!watchers.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { want, running: () => !!timer, stop: () => { watchers.clear(); want('', false); } };
}

module.exports = { cpuTimes, cpuPercent, parseNvidia, linuxCpuTemp, linuxDrmGpus, createSampler, NVIDIA_QUERY, WIN_TEMP_SCRIPT };

const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/sysmon');

const t = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });

test('cpuPercent compares two readings, total and per core', () => {
  const a = m.cpuTimes([t(100, 900), t(0, 1000)]);
  const b = m.cpuTimes([t(150, 950), t(100, 1000)]);
  assert.deepEqual(m.cpuPercent(a, b), { pct: 75, cores: [50, 100] });
  assert.deepEqual(m.cpuPercent(a, a), { pct: 0, cores: [0, 0] });
});

test('parseNvidia reads the csv query, [N/A] becomes null', () => {
  const [g] = m.parseNvidia('NVIDIA GeForce RTX 4080, 37, 52, 2048, 16376, 85.43, 320.00, 2520\r\n');
  assert.deepEqual(g, { name: 'NVIDIA GeForce RTX 4080', util: 37, temp: 52, memUsed: 2048, memTotal: 16376, power: 85.43, powerLimit: 320, clock: 2520, vendor: 'nvidia' });
  assert.equal(m.parseNvidia('X, 1, 2, 3, 4, [N/A], [N/A], 5')[0].power, null);
  assert.deepEqual(m.parseNvidia(''), []);
});

// A tiny fake of the few fs calls the Linux readers use.
const fakeFs = (files) => ({
  readFileSync: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
  readdirSync: (p) => {
    const kids = new Set(Object.keys(files).filter((f) => f.startsWith(`${p}/`)).map((f) => f.slice(p.length + 1).split('/')[0]));
    if (!kids.size) throw new Error('ENOENT');
    return [...kids];
  }
});

test('linuxCpuTemp prefers the CPU sensor driver', () => {
  const fsx = fakeFs({
    '/sys/class/hwmon/hwmon0/name': 'nvme\n', '/sys/class/hwmon/hwmon0/temp1_input': '40000',
    '/sys/class/hwmon/hwmon1/name': 'k10temp\n', '/sys/class/hwmon/hwmon1/temp1_input': '61250\n'
  });
  assert.equal(m.linuxCpuTemp(fsx), 61.3);
  assert.equal(m.linuxCpuTemp(fakeFs({})), null);
});

test('linuxDrmGpus reads amdgpu sysfs', () => {
  const d = '/sys/class/drm/card1/device';
  const [g] = m.linuxDrmGpus(fakeFs({
    [`${d}/gpu_busy_percent`]: '12', [`${d}/mem_info_vram_used`]: String(512 * 1048576), [`${d}/mem_info_vram_total`]: String(8192 * 1048576),
    [`${d}/hwmon/hwmon3/temp1_input`]: '48000', [`${d}/hwmon/hwmon3/power1_average`]: '35000000',
    '/sys/class/drm/card1-DP-1/status': 'connected'
  }));
  assert.deepEqual(g, { name: 'card1', util: 12, temp: 48, memUsed: 512, memTotal: 8192, power: 35, powerLimit: null, clock: null, vendor: 'amd' });
});

// Benchmark results (src/bench-runner.js) and how two runs compare. Pure.
const METRICS = [
  { key: 'cpu1', label: 'Single core', unit: 'MB/s hashed' },
  { key: 'cpuN', label: 'All cores', unit: 'MB/s hashed' },
  { key: 'mem', label: 'Memory copy', unit: 'GB/s' },
  { key: 'diskW', label: 'Disk write', unit: 'MB/s' },
  { key: 'diskSync', label: 'Disk flushes', unit: 'writes/s' }
];

const round = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

// Rows for a table: each metric's value, the baseline's, and the change in percent (higher is better for all).
function compare(run, base) {
  return METRICS.map((m) => {
    const value = run && typeof run.results[m.key] === 'number' ? run.results[m.key] : null;
    const was = base && typeof base.results[m.key] === 'number' ? base.results[m.key] : null;
    const delta = value !== null && was ? Math.round(((value - was) / was) * 1000) / 10 : null;
    return { ...m, value: value === null ? null : round(value), base: was === null ? null : round(was), delta };
  });
}

// Below this, a change is within run-to-run noise.
const NOISE_PCT = 3;
const verdict = (delta) => (delta === null ? '' : Math.abs(delta) < NOISE_PCT ? 'same' : delta > 0 ? 'better' : 'worse');

module.exports = { METRICS, compare, verdict, NOISE_PCT };

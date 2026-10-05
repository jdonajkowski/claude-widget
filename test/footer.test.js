const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, fmtTokens, fmtDuration, fmtResets, fmtGit, level } = require('../src/footer');
const git = require('../src/git-status');

// Trimmed from a real Claude Code 2.1.289 statusLine payload.
const sample = {
  cwd: 'C:\\x',
  effort: { level: 'medium' },
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  workspace: { current_dir: 'C:\\x\\y' },
  cost: { total_cost_usd: 0.81378 },
  context_window: {
    context_window_size: 1000000,
    current_usage: { input_tokens: 2, output_tokens: 16, cache_creation_input_tokens: 586, cache_read_input_tokens: 80072 },
    used_percentage: 8
  },
  rate_limits: { five_hour: { used_percentage: 40, resets_at: 1000 }, seven_day: { used_percentage: 9, resets_at: 2000 } }
};

test('summarize reads the statusLine fields', () => {
  assert.deepEqual(summarize(sample), {
    model: 'Opus 5.5', effort: 'medium', cost: 0.81378, ctxPct: 8, ctxTokens: 80660, ctxSize: 1000000,
    fiveHour: 40, sevenDay: 9, fiveHourResets: 1000, sevenDayResets: 2000, cwd: 'C:\\x\\y'
  });
});

test('summarize tolerates missing fields', () => {
  const s = summarize({ cwd: 'C:\\x' });
  assert.equal(s.cwd, 'C:\\x');
  assert.equal(s.ctxPct, null);
  assert.equal(s.ctxTokens, null);
  assert.equal(s.cost, null);
  assert.equal(summarize(null), null);
});

test('formats tokens, durations and reset times', () => {
  assert.equal(fmtTokens(80660), '81k');
  assert.equal(fmtTokens(1000000), '1M');
  assert.equal(fmtTokens(1500000), '1.5M');
  assert.equal(fmtTokens(900), '900');
  assert.equal(fmtDuration(83000), '1:23');
  assert.equal(fmtDuration(3723000), '1:02:03');
  assert.equal(fmtResets(3600 + 5 * 60, 0), '1h05');
  assert.equal(fmtResets(600, 0), '10m');
  assert.equal(fmtResets(3 * 86400 + 2 * 3600, 0), '3d2h');
  assert.equal(fmtResets(10, 20000), '');
});

test('level warns at 60% and 85%', () => {
  assert.equal(level(59), '');
  assert.equal(level(60), 'warm');
  assert.equal(level(85), 'hot');
  assert.equal(level(null), '');
});

test('parses git porcelain v2 branch output', () => {
  const out = [
    '# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b src/main.js', '? test/new.test.js', ''
  ].join('\n');
  assert.deepEqual(git.parse(out), { branch: 'main', ahead: 2, behind: 1, upstream: true, changed: 2 });
  assert.equal(fmtGit(git.parse(out)), 'main ●2 ↑2 ↓1');
});

test('clean branch without upstream shows a check', () => {
  assert.equal(fmtGit(git.parse('# branch.head feat\n')), 'feat ✓');
  assert.equal(fmtGit(null), null);
});

test('windowPct is how far through a rate limit window we are', () => {
  const { windowPct, WINDOWS, fmtBytes } = require('../src/footer');
  const now = 1_000_000_000_000;
  assert.equal(windowPct(now / 1000 + 3600, now, WINDOWS.fiveHour), 80);
  assert.equal(windowPct(now / 1000 - 1, now, WINDOWS.fiveHour), null);
  assert.equal(windowPct(null, now, WINDOWS.fiveHour), null);
  assert.equal(fmtBytes(512 * 1073741824), '512.0G');
  assert.equal(fmtBytes(2048 * 1073741824), '2.0T');
});

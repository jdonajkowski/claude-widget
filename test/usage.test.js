const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const u = require('../src/usage');

test('normalize reads ccusage daily and session output', () => {
  const daily = u.normalize({ daily: [{ period: '2026-10-04', inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4, totalTokens: 10, totalCost: 1.5, modelsUsed: ['m'] }] }, 'daily');
  assert.deepEqual(daily, [{ key: '2026-10-04', input: 1, output: 2, cacheCreate: 3, cacheRead: 4, total: 10, cost: 1.5, models: ['m'], last: null }]);
  const s = u.normalize({ session: [{ period: 'abc', inputTokens: 5, metadata: { lastActivity: '2026-10-04T01:00:00Z' } }] }, 'session');
  assert.equal(s[0].key, 'abc');
  assert.equal(s[0].total, 5);
  assert.equal(s[0].last, '2026-10-04T01:00:00Z');
  assert.deepEqual(u.normalize({}, 'daily'), []);
});

test('transcripts give session projects and token totals, each message counted once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  const proj = path.join(dir, 'projects', 'C--Users-me-Projects-app');
  fs.mkdirSync(proj, { recursive: true });
  const line = (o) => JSON.stringify(o);
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1, cache_read_input_tokens: 100 };
  fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), [
    line({ type: 'user', cwd: '/home/me/Projects/app', timestamp: '2026-10-03T10:00:00Z' }),
    line({ type: 'assistant', requestId: 'r1', timestamp: '2026-10-03T10:00:01Z', message: { id: 'm1', model: 'claude-x', usage } }),
    line({ type: 'assistant', requestId: 'r1', timestamp: '2026-10-03T10:00:01Z', message: { id: 'm1', model: 'claude-x', usage } }),
    line({ type: 'assistant', requestId: 'r2', timestamp: '2026-10-04T09:00:00Z', message: { id: 'm2', model: 'claude-y', usage } })
  ].join('\n'));
  const map = u.sessionProjects([dir]);
  assert.deepEqual(map.get('sess-1'), { cwd: '/home/me/Projects/app', name: path.basename('/home/me/Projects/app') });
  const r = u.scanTranscripts([dir]);
  assert.deepEqual(r.daily.map((d) => [d.key, d.total]), [['2026-10-03', 116], ['2026-10-04', 116]]);
  assert.equal(r.totals.total, 232);
  assert.deepEqual(r.sessions[0].models, ['claude-x', 'claude-y']);
});

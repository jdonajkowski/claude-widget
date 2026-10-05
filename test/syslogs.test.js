const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/syslogs');

test('parseWin accepts one event or a list', () => {
  const one = s.parseWin(JSON.stringify({ time: '2026-10-04T12:00:00.0000000Z', level: 2, source: 'Disk', id: 7, log: 'System', message: 'Bad block\r\n' }));
  assert.deepEqual(one, [{ time: Date.parse('2026-10-04T12:00:00Z'), level: 'error', source: 'Disk', id: 7, log: 'System', message: 'Bad block' }]);
  assert.equal(s.parseWin('[{"level":3},{"level":1}]').map((e) => e.level).join(), 'warning,critical');
  assert.deepEqual(s.parseWin(''), []);
});

test('parseJournal maps priorities and byte-array messages, newest first', () => {
  const out = [
    JSON.stringify({ __REALTIME_TIMESTAMP: '1000000', PRIORITY: '3', SYSLOG_IDENTIFIER: 'kernel', MESSAGE: 'one' }),
    JSON.stringify({ __REALTIME_TIMESTAMP: '2000000', PRIORITY: '4', _COMM: 'x', _PID: '9', MESSAGE: [104, 105] })
  ].join('\n');
  assert.deepEqual(s.parseJournal(out).map((e) => [e.time, e.level, e.source, e.message]), [[2000, 'warning', 'x', 'hi'], [1000, 'error', 'kernel', 'one']]);
});

test('journalArgs and the Windows script follow level and hours', () => {
  assert.deepEqual(s.journalArgs({ level: 'warning', hours: 2 }), ['-o', 'json', '--no-pager', '-n', '300', '-p', 'warning', '--since', '-2h']);
  assert.match(s.winScript({ level: 'error', hours: 6 }), /Level = 1,2; StartTime = \(Get-Date\)\.AddHours\(-6\)/);
});

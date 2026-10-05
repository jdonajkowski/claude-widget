// Log viewer: recent errors and warnings from the Windows Event Log (System and Application) or the
// systemd journal, in one shape: { time, level, source, id, log, message }. Parsers are pure.
const { execFile } = require('child_process');

const LEVELS = ['critical', 'error', 'warning'];

// Windows: Level 1 critical, 2 error, 3 warning.
function winScript({ level = 'error', hours = 24, max = 300 }) {
  const lv = level === 'warning' ? '1,2,3' : level === 'critical' ? '1' : '1,2';
  return [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$e = Get-WinEvent -FilterHashtable @{ LogName = 'System','Application'; Level = ${lv}; StartTime = (Get-Date).AddHours(-${Number(hours) || 24}) } -MaxEvents ${Number(max) || 300} -ErrorAction SilentlyContinue`,
    "$e | ForEach-Object { $m = [string]$_.Message; if ($m.Length -gt 4000) { $m = $m.Substring(0, 4000) }; [pscustomobject]@{ time = $_.TimeCreated.ToUniversalTime().ToString('o'); level = $_.Level; source = $_.ProviderName; id = $_.Id; log = $_.LogName; message = $m } } | ConvertTo-Json -Compress -Depth 2"
  ].join('; ');
}

function parseWin(out) {
  const text = String(out || '').trim();
  if (!text) return [];
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(data) ? data : [data]; // one event comes back as an object
  return list.map((e) => ({
    time: Date.parse(e.time) || 0,
    level: e.level === 1 ? 'critical' : e.level === 2 ? 'error' : 'warning',
    source: e.source || '',
    id: e.id ?? '',
    log: e.log || '',
    message: String(e.message || '').replace(/\r\n/g, '\n').trim()
  }));
}

// journalctl -o json: one object per line. MESSAGE can be an array of bytes for non-UTF-8 text.
function parseJournal(out) {
  const list = [];
  for (const line of String(out || '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const p = Number(e.PRIORITY);
    const msg = Array.isArray(e.MESSAGE) ? Buffer.from(e.MESSAGE).toString('utf8') : String(e.MESSAGE ?? '');
    list.push({
      time: Math.round(Number(e.__REALTIME_TIMESTAMP) / 1000) || 0,
      level: p <= 2 ? 'critical' : p === 3 ? 'error' : 'warning',
      source: e.SYSLOG_IDENTIFIER || e._COMM || e._SYSTEMD_UNIT || '',
      id: e._PID ? `pid ${e._PID}` : '',
      log: e._SYSTEMD_UNIT || (e._TRANSPORT === 'kernel' ? 'kernel' : ''),
      message: msg.trim()
    });
  }
  return list.sort((a, b) => b.time - a.time);
}

const journalArgs = ({ level = 'error', hours = 24, max = 300 }) =>
  ['-o', 'json', '--no-pager', '-n', String(Number(max) || 300), '-p', level === 'warning' ? 'warning' : level === 'critical' ? 'crit' : 'err', '--since', `-${Number(hours) || 24}h`];

function read({ isWin = process.platform === 'win32', ...opts } = {}) {
  return new Promise((resolve) => {
    const done = (parse) => (err, stdout, stderr) => {
      const entries = parse(stdout);
      resolve({ entries, error: !entries.length && err ? String(stderr || err.message).trim().split('\n')[0] : null });
    };
    const o = { timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 };
    if (isWin) execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', winScript(opts)], o, done(parseWin));
    else execFile('journalctl', journalArgs(opts), o, done(parseJournal));
  });
}

// What "Ask Claude" pastes into the session for one entry.
function prompt(entry, isWin) {
  const when = new Date(entry.time).toLocaleString();
  return `Help me diagnose this ${isWin ? 'Windows event log' : 'system journal'} ${entry.level} (${when}, ${entry.source}${entry.id !== '' ? `, ${entry.id}` : ''}). ` +
    `Explain what it means and whether it needs fixing, and check the system before changing anything:\n\n${entry.message.slice(0, 3000)}`;
}

module.exports = { LEVELS, winScript, parseWin, parseJournal, journalArgs, read, prompt };

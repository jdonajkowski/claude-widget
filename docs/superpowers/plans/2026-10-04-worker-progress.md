# Worker Progress Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one busy/done row per running subagent and background shell in the Claude Widget.

**Architecture:** Claude Code hooks run `hooks/workers-hook.js`, which appends JSON event lines to a log file named by the `CLAUDE_WIDGET_WORKERS` env var. The widget sets that variable for its own pty session. The main process tails the log (`src/log-tail.js`) and forwards events to the renderer, which reduces them to a worker list (`src/workers.js`) and draws a panel between the title bar and the terminal.

**Tech Stack:** Electron 44.5.1, xterm.js 6, node-pty 1.1, plain Node (no new dependencies), `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-10-04-worker-progress-design.md`

## Global Constraints

- No new npm dependencies. The hook script must run with plain `node` and nothing installed.
- The hook always exits 0, writes nothing to stdout or stderr, and never throws.
- The hook does nothing when `CLAUDE_WIDGET_WORKERS` is unset.
- The log is append-only JSON Lines. Event shapes are exactly:
  - `{"t":"start","id","kind":"agent"|"shell","label","ts"}`
  - `{"t":"stop","id","ts"}`
  - `{"t":"snapshot","ids":[...],"ts"}`
- Done rows disappear 5 s after `doneAt`.
- At most 4 rows are shown, then a "+N more" row.
- Shell labels are the command clipped to 40 characters.
- The renderer runs with `sandbox: true`, so `src/workers.js` must load both as a browser `<script>` (exposing `window.WidgetWorkers`) and through Node `require`.
- The widget's existing behaviour stays unchanged: the OSC 9;4 strip, the notify hooks, and `config.env` merging.
- Windows paths. The installed app lives at `%LOCALAPPDATA%\Programs\claude-desktop-widget`, and `asar` is off.

## Review Focus

1. **Two subagents starting in the same instant.** Both rows should appear, with no corrupted or merged log lines. Covered in Task 3 by running two hooks concurrently.
2. **A long or multi-line background command** (heredoc, `&&` chains). Its row should be one line of at most 40 characters. Covered in Task 3 (newline collapsing and clipping).
3. **The widget reading the log while a hook is mid-write.** No event should be lost or doubled, and a partial line should be held until it completes. Covered in Task 4.
4. **Restarting the session (Ctrl+Shift+R) while workers are running.** All rows should clear, and new events should still show up after the log is truncated. Covered in Task 4 (truncation detection) and Task 5 (renderer clears).
5. **Claude sessions outside the widget, or a hook given empty or garbage stdin.** Nothing should be written, nothing printed, and the exit code should be 0. Covered in Task 3.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `hooks/workers-hook.js` (new) | Hook entry point: turns a hook payload into log lines |
| `src/workers.js` (new) | Pure reducer: events → worker list. Loads in both Node and the browser |
| `src/log-tail.js` (new) | Polls a JSONL file and emits newly appended, parsed events. Handles partial lines and truncation |
| `src/main.js` (modify) | Sets the env var, truncates the log on spawn, runs the tail, sends `workers:events` |
| `src/preload.js` (modify) | Exposes `widget.workers.onEvents` |
| `src/renderer/index.html`, `renderer.js`, `styles.css` (modify) | `#workers` panel |
| `test/workers.test.js`, `test/workers-hook.test.js`, `test/log-tail.test.js` (new) | Unit tests |
| `package.json` (modify) | `test` script; `hooks/**/*` added to `build.files` |
| `README.md` (modify) | Hook setup docs |

---

### Task 1: Verify the real hook payloads (throwaway probe)

The rest of the plan assumes four things. Confirm them before any product code is written:
- (a) `PostToolUse` for a background Bash/PowerShell call carries `tool_input.run_in_background === true` and `tool_response.backgroundTaskId`.
- (b) That same id appears in `background_tasks[].id` on `Stop` while the shell runs, and is gone after it exits.
- (c) Subagents appear in `background_tasks` with `type === "subagent"`, and that entry's `id` equals `SubagentStart`'s `agent_id`.
- (d) Hooks inherit the session's environment variables.

**Files:**
- Create (scratch, not committed): `%TEMP%\claude\hook-probe.js`
- Temporarily modify: `~/.claude/settings.json`

- [ ] **Step 1: Write the probe**

```js
// %TEMP%\claude\hook-probe.js — logs raw hook payloads. Throwaway.
const fs = require('fs');
const path = require('path');
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  const out = path.join(process.env.TEMP, 'claude', 'hook-probe.jsonl');
  fs.appendFileSync(out, JSON.stringify({ env_ConEmuTask: process.env.ConEmuTask || null, payload: raw }) + '\n');
});
```

- [ ] **Step 2: Register it temporarily.** Back up `~/.claude/settings.json` to `~/.claude/settings.json.probe-bak`. Then add a hook entry `{"type":"command","command":"node \"C:/Users/jacob/AppData/Local/Temp/claude/hook-probe.js\""}` under `SubagentStart`, `SubagentStop`, `Stop` (as an extra item in the existing Stop entry's `hooks` array), and `PostToolUse` (new entry with `"matcher": "Bash|PowerShell"`).

- [ ] **Step 3: Exercise it in the widget session.** Run one background PowerShell command, `Start-Sleep -Seconds 20; 'probe done'` with `run_in_background: true`. Then dispatch one small Explore subagent. End the turn, wait for the shell's completion notification, and let that turn end too.

- [ ] **Step 4: Read `%TEMP%\claude\hook-probe.jsonl` and record the answers to (a)–(d)** in the "Probe findings" section at the bottom of this plan:
  - the exact field paths,
  - whether the ids match,
  - the subagent `type` string,
  - whether `env_ConEmuTask` was `"claude-widget"`.

  If (a) uses a different field path, update `TASK_ID_PATHS` in Task 3. If (c) holds, set `SNAPSHOT_KINDS` in Task 2 to `['shell', 'agent']`, otherwise keep `['shell']`. If (d) fails, stop and redesign: the env-var link doesn't work.

- [ ] **Step 5: Restore settings.** Copy `settings.json.probe-bak` back over `settings.json` and delete the backup. Delete the probe files.

- [ ] **Step 6: Commit the findings** (plan file only):

```bash
git add docs/superpowers/plans/2026-10-04-worker-progress.md
git commit -m "docs: record hook payload probe findings"
```

---

### Task 2: Worker reducer (`src/workers.js`)

**Files:**
- Create: `src/workers.js`
- Create: `test/workers.test.js`
- Modify: `package.json` (add `"test": "node --test test/"` to `scripts`)

**Interfaces:**
- Produces: `reduce(events: Event[], now: number) -> Worker[]`
  - `Worker = { id: string, kind: 'agent'|'shell', label: string, startedAt: number, doneAt: number|null }`, sorted by `startedAt`.
  - Also exports `DONE_TTL_MS = 5000` and `SNAPSHOT_KINDS`.
  - In Node it is available via `require('../src/workers')`. In the browser it is `window.WidgetWorkers`.

- [ ] **Step 1: Write the failing tests**

```js
// test/workers.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { reduce, DONE_TTL_MS } = require('../src/workers');

const start = (id, kind, ts, label = id) => ({ t: 'start', id, kind, label, ts });

test('start creates a running worker', () => {
  const w = reduce([start('a1', 'agent', 1000, 'Explore')], 2000);
  assert.deepEqual(w, [{ id: 'a1', kind: 'agent', label: 'Explore', startedAt: 1000, doneAt: null }]);
});

test('stop marks the worker done', () => {
  const w = reduce([start('a1', 'agent', 1000), { t: 'stop', id: 'a1', ts: 3000 }], 3500);
  assert.equal(w[0].doneAt, 3000);
});

test('done workers drop out after DONE_TTL_MS', () => {
  const ev = [start('a1', 'agent', 1000), { t: 'stop', id: 'a1', ts: 3000 }];
  assert.equal(reduce(ev, 3000 + DONE_TTL_MS).length, 1);
  assert.equal(reduce(ev, 3000 + DONE_TTL_MS + 1).length, 0);
});

test('snapshot finishes shells it no longer lists', () => {
  const ev = [start('s1', 'shell', 1000), start('s2', 'shell', 1100), { t: 'snapshot', ids: ['s2'], ts: 5000 }];
  const w = reduce(ev, 5000);
  assert.equal(w.find((x) => x.id === 's1').doneAt, 5000);
  assert.equal(w.find((x) => x.id === 's2').doneAt, null);
});

test('snapshot older than a shell start does not finish it', () => {
  const ev = [{ t: 'snapshot', ids: [], ts: 900 }, start('s1', 'shell', 1000)];
  assert.equal(reduce(ev, 1200)[0].doneAt, null);
});

test('snapshot taken before start but logged after it does not finish it', () => {
  const ev = [start('s1', 'shell', 1000), { t: 'snapshot', ids: [], ts: 900 }];
  assert.equal(reduce(ev, 1200)[0].doneAt, null);
});

test('snapshot does not finish already-done workers again', () => {
  const ev = [start('s1', 'shell', 1000), { t: 'snapshot', ids: [], ts: 2000 }, { t: 'snapshot', ids: [], ts: 4000 }];
  assert.equal(reduce(ev, 4000)[0].doneAt, 2000);
});

test('duplicate start is ignored', () => {
  const ev = [start('a1', 'agent', 1000, 'first'), start('a1', 'agent', 2000, 'second')];
  const w = reduce(ev, 2500);
  assert.equal(w.length, 1);
  assert.equal(w[0].label, 'first');
});

test('stop for an unknown id is ignored', () => {
  assert.deepEqual(reduce([{ t: 'stop', id: 'nope', ts: 1 }], 2), []);
});

test('malformed events are skipped', () => {
  const ev = [null, 42, { t: 'start' }, { t: 'snapshot', ids: 'x', ts: 1 }, start('a1', 'agent', 1000)];
  assert.equal(reduce(ev, 1500).length, 1);
});

test('workers are ordered by start time', () => {
  const ev = [start('b', 'shell', 2000), start('a', 'agent', 1000)];
  assert.deepEqual(reduce(ev, 3000).map((w) => w.id), ['a', 'b']);
});
```

- [ ] **Step 2: Add the test script and run the tests to verify they fail**

In `package.json`, change `scripts` to:

```json
"scripts": {
  "start": "electron .",
  "test": "node --test test/",
  "pack": "electron-builder --dir",
  "dist": "electron-builder"
},
```

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/workers'`.

- [ ] **Step 3: Implement**

```js
// src/workers.js — turns the hook event log into the list of rows to draw.
// Loaded by the renderer as a plain <script> (window.WidgetWorkers) and by tests via require.
(function (root) {
  const DONE_TTL_MS = 5000;
  // Worker kinds that a snapshot may finish. Set from the payload probe (plan Task 1).
  const SNAPSHOT_KINDS = ['shell'];

  function reduce(events, now) {
    const byId = new Map();
    for (const e of events) {
      if (!e || typeof e !== 'object' || typeof e.ts !== 'number') continue;
      if (e.t === 'start' && typeof e.id === 'string' && !byId.has(e.id)) {
        byId.set(e.id, { id: e.id, kind: e.kind, label: String(e.label ?? e.id), startedAt: e.ts, doneAt: null });
      } else if (e.t === 'stop' && byId.has(e.id)) {
        const w = byId.get(e.id);
        if (w.doneAt === null) w.doneAt = e.ts;
      } else if (e.t === 'snapshot' && Array.isArray(e.ids)) {
        const live = new Set(e.ids);
        for (const w of byId.values()) {
          if (w.doneAt === null && SNAPSHOT_KINDS.includes(w.kind) && w.startedAt < e.ts && !live.has(w.id)) {
            w.doneAt = e.ts;
          }
        }
      }
    }
    return [...byId.values()]
      .filter((w) => w.doneAt === null || now - w.doneAt <= DONE_TTL_MS)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  const api = { reduce, DONE_TTL_MS, SNAPSHOT_KINDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetWorkers = api;
})(this);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/workers.js test/workers.test.js package.json
git commit -m "feat: add worker event reducer"
```

---

### Task 3: Hook script (`hooks/workers-hook.js`)

**Files:**
- Create: `hooks/workers-hook.js`
- Create: `test/workers-hook.test.js`
- Modify: `package.json` (`build.files` gains `"hooks/**/*"`)

**Interfaces:**
- Consumes: hook payload JSON on stdin, and the `CLAUDE_WIDGET_WORKERS` env var (log file path).
- Produces: log lines in the Global Constraints shapes. Also exports `toEvents(payload, now) -> Event[]` for tests (the script only runs `main()` when executed directly).

- [ ] **Step 1: Write the failing tests**

```js
// test/workers-hook.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { toEvents } = require('../hooks/workers-hook');

const HOOK = path.join(__dirname, '..', 'hooks', 'workers-hook.js');
const tmpLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-')), 'workers.jsonl');
const run = (payload, env) => spawnSync(process.execPath, [HOOK], { input: payload, env: { ...process.env, ...env }, encoding: 'utf8' });
const readLines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('SubagentStart -> start agent', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' }, 5),
    [{ t: 'start', id: 'ag1', kind: 'agent', label: 'Explore', ts: 5 }]);
});

test('SubagentStop -> stop + snapshot', () => {
  const ev = toEvents({ hook_event_name: 'SubagentStop', agent_id: 'ag1', background_tasks: [{ id: 'b1', type: 'shell' }] }, 7);
  assert.deepEqual(ev, [{ t: 'stop', id: 'ag1', ts: 7 }, { t: 'snapshot', ids: ['b1'], ts: 7 }]);
});

test('Stop -> snapshot (empty when no background_tasks)', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'Stop' }, 9), [{ t: 'snapshot', ids: [], ts: 9 }]);
});

test('PostToolUse background Bash -> start shell with clipped one-line label', () => {
  const cmd = 'cat <<EOF > x\nhello\nEOF && npm run build -- --watch --verbose --extra-long-flag';
  const ev = toEvents({
    hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: cmd, run_in_background: true },
    tool_response: { backgroundTaskId: 'bt1' }
  }, 11);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].t, 'start');
  assert.equal(ev[0].id, 'bt1');
  assert.equal(ev[0].kind, 'shell');
  assert.ok(ev[0].label.length <= 40, `label too long: ${ev[0].label.length}`);
  assert.ok(!/\n/.test(ev[0].label));
  assert.ok(ev[0].label.startsWith('cat <<EOF > x hello EOF'));
});

test('PostToolUse foreground or without task id -> nothing', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} }, 1), []);
  assert.deepEqual(toEvents({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls', run_in_background: true }, tool_response: {} }, 1), []);
});

test('unknown events and garbage -> nothing', () => {
  assert.deepEqual(toEvents({ hook_event_name: 'UserPromptSubmit' }, 1), []);
  assert.deepEqual(toEvents(null, 1), []);
});

test('script appends lines when env var is set, prints nothing, exits 0', () => {
  const log = tmpLog();
  const r = run(JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' }), { CLAUDE_WIDGET_WORKERS: log });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(readLines(log)[0].id, 'ag1');
});

test('script does nothing without the env var', () => {
  const env = { ...process.env };
  delete env.CLAUDE_WIDGET_WORKERS;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop' }), env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('script survives empty and garbage stdin', () => {
  const log = tmpLog();
  for (const input of ['', 'not json', '{"hook_event_name":']) {
    const r = run(input, { CLAUDE_WIDGET_WORKERS: log });
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, '');
  }
  assert.equal(fs.existsSync(log), false);
});

test('script survives an unwritable log path', () => {
  const r = run(JSON.stringify({ hook_event_name: 'Stop' }), { CLAUDE_WIDGET_WORKERS: path.join(os.tmpdir(), 'no-such-dir-cw', 'x', 'workers.jsonl') });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
});

test('concurrent hooks write intact lines', async () => {
  const log = tmpLog();
  const N = 8;
  await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_WIDGET_WORKERS: log } });
    p.on('exit', resolve);
    p.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: `ag${i}`, agent_type: 'Explore' }));
  })));
  const ids = readLines(log).map((e) => e.id).sort();
  assert.deepEqual(ids, Array.from({ length: N }, (_, i) => `ag${i}`).sort());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: the workers-hook tests FAIL with `Cannot find module '../hooks/workers-hook'`, and the reducer tests still pass.

- [ ] **Step 3: Implement**

```js
// hooks/workers-hook.js — Claude Code hook that feeds the Claude Widget's worker rows.
// Registered for SubagentStart, SubagentStop, Stop and PostToolUse (Bash|PowerShell).
// Appends JSON lines to the file named by CLAUDE_WIDGET_WORKERS, which only the widget sets.
// Must never block Claude or print into the session: always exits 0, writes nothing to stdout/stderr.
const fs = require('fs');

const LABEL_MAX = 40;
// Where PostToolUse puts a background shell's task id (confirmed by the plan's Task 1 probe).
const TASK_ID_PATHS = [['tool_response', 'backgroundTaskId']];

const get = (obj, keys) => keys.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

function clip(text) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > LABEL_MAX ? oneLine.slice(0, LABEL_MAX - 1) + '…' : oneLine;
}

function snapshot(p, ts) {
  const tasks = Array.isArray(p.background_tasks) ? p.background_tasks : [];
  return { t: 'snapshot', ids: tasks.map((x) => x && x.id).filter((id) => typeof id === 'string'), ts };
}

function toEvents(p, ts) {
  if (!p || typeof p !== 'object') return [];
  switch (p.hook_event_name) {
    case 'SubagentStart':
      return p.agent_id ? [{ t: 'start', id: p.agent_id, kind: 'agent', label: clip(p.agent_type || 'agent'), ts }] : [];
    case 'SubagentStop':
      return [...(p.agent_id ? [{ t: 'stop', id: p.agent_id, ts }] : []), snapshot(p, ts)];
    case 'Stop':
      return [snapshot(p, ts)];
    case 'PostToolUse': {
      if (!get(p, ['tool_input', 'run_in_background'])) return [];
      const id = TASK_ID_PATHS.map((k) => get(p, k)).find((v) => typeof v === 'string' && v);
      return id ? [{ t: 'start', id, kind: 'shell', label: clip(get(p, ['tool_input', 'command']) || p.tool_name), ts }] : [];
    }
    default:
      return [];
  }
}

function main() {
  const file = process.env.CLAUDE_WIDGET_WORKERS;
  if (!file) return;
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      const events = toEvents(JSON.parse(raw), Date.now());
      if (events.length) fs.appendFileSync(file, events.map((e) => JSON.stringify(e) + '\n').join(''));
    } catch { /* never disturb the session */ }
  });
}

if (require.main === module) {
  process.on('uncaughtException', () => process.exit(0));
  main();
}

module.exports = { toEvents, clip };
```

Then in `package.json`, change `build.files` to:

```json
"files": [
  "src/**/*",
  "hooks/**/*",
  "assets/**/*",
  "package.json"
],
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all tests pass, including `concurrent hooks write intact lines`. The single `appendFileSync` per hook keeps each write atomic on Windows for these small sizes.

- [ ] **Step 5: Commit**

```bash
git add hooks/workers-hook.js test/workers-hook.test.js package.json
git commit -m "feat: add Claude Code hook that logs worker events"
```

---

### Task 4: Log tail (`src/log-tail.js`) and main/preload wiring

**Files:**
- Create: `src/log-tail.js`
- Create: `test/log-tail.test.js`
- Modify: `src/main.js` (spawnTerminal around lines 151-162; app lifecycle at the end)
- Modify: `src/preload.js:9-33`

**Interfaces:**
- Produces: `createLogTail(file: string, onEvents: (events: object[]) => void, { intervalMs = 300 } = {}) -> { reset(): void, poll(): void, close(): void }`
  - `reset()` truncates (creating the file if needed) and rewinds.
  - `poll()` reads any new complete lines now. The timer calls it, and tests call it directly.
- Produces (IPC): channel `workers:events` with payload `object[]`. Preload exposes `widget.workers.onEvents(cb) -> unsubscribe`.
- Produces (env): `CLAUDE_WIDGET_WORKERS` set in the pty env to `<userData>\workers.jsonl`.

Note: the spec said "`fs.watch` plus a 1 s poll fallback". This plan uses only a 300 ms size poll. One `statSync` every 300 ms is negligible, and a poll can't miss appends the way `fs.watch` can on Windows.

- [ ] **Step 1: Write the failing tests**

```js
// test/log-tail.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLogTail } = require('../src/log-tail');

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-tail-')), 'workers.jsonl');
  const got = [];
  const tail = createLogTail(file, (evs) => got.push(...evs), { intervalMs: 0 }); // 0 = no timer; tests call poll()
  tail.reset();
  return { file, got, tail };
}

test('emits appended complete lines once', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, '{"t":"start","id":"a"}\n{"t":"stop","id":"a"}\n');
  tail.poll();
  tail.poll();
  assert.deepEqual(got.map((e) => e.t), ['start', 'stop']);
  tail.close();
});

test('holds a partial line until it completes', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, '{"t":"start",');
  tail.poll();
  assert.equal(got.length, 0);
  fs.appendFileSync(file, '"id":"a"}\n');
  tail.poll();
  assert.deepEqual(got, [{ t: 'start', id: 'a' }]);
  tail.close();
});

test('skips lines that are not JSON', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, 'garbage\n{"t":"stop","id":"a"}\n\n');
  tail.poll();
  assert.deepEqual(got, [{ t: 'stop', id: 'a' }]);
  tail.close();
});

test('reset truncates and later appends are still read', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, '{"n":1}\n');
  tail.poll();
  tail.reset();
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  fs.appendFileSync(file, '{"n":2}\n');
  tail.poll();
  assert.deepEqual(got.map((e) => e.n), [1, 2]);
  tail.close();
});

test('external truncation is detected and the file re-read from the start', () => {
  const { file, got, tail } = setup();
  fs.appendFileSync(file, '{"n":1}\n{"n":2}\n');
  tail.poll();
  fs.writeFileSync(file, '{"n":3}\n');
  tail.poll();
  assert.deepEqual(got.map((e) => e.n), [1, 2, 3]);
  tail.close();
});

test('missing file is not an error', () => {
  const { file, got, tail } = setup();
  fs.rmSync(file);
  assert.doesNotThrow(() => tail.poll());
  assert.equal(got.length, 0);
  tail.close();
});

test('multibyte characters split across reads survive', () => {
  const { file, got, tail } = setup();
  const line = Buffer.from('{"label":"ünïcødé…"}\n', 'utf8');
  fs.appendFileSync(file, line.subarray(0, 12));
  tail.poll();
  fs.appendFileSync(file, line.subarray(12));
  tail.poll();
  assert.deepEqual(got, [{ label: 'ünïcødé…' }]);
  tail.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: the log-tail tests FAIL with `Cannot find module '../src/log-tail'`.

- [ ] **Step 3: Implement `src/log-tail.js`**

```js
// Polls an append-only JSON Lines file and reports newly completed lines as parsed objects.
// Keeps partial trailing lines (bytes, so split UTF-8 survives) and restarts from 0 if the file shrinks.
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Wire it into `src/main.js`**

Add the require after `const pty = require('node-pty');`:

```js
const { createLogTail } = require('./log-tail');
```

Add after `const statePath = ...`:

```js
// Hook event log for the worker rows (written by hooks/workers-hook.js, see README).
const workersLogPath = path.join(userDir, 'workers.jsonl');
```

Change the `env:` line in `spawnTerminal()` so the widget's variable comes last and `config.env` can't override it:

```js
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...config.env, CLAUDE_WIDGET_WORKERS: workersLogPath },
```

At the top of `spawnTerminal()`, right after `killTerminal();`, add:

```js
  workersTail.reset();
```

Add after `let term = null;`:

```js
const workersTail = createLogTail(workersLogPath, (events) => send('workers:events', events));
```

In `app.on('will-quit', ...)`, add `workersTail.close();` after `killTerminal();`.

- [ ] **Step 6: Expose it in `src/preload.js`.** Add after the `clipboard` block:

```js
  workers: {
    onEvents: on('workers:events')
  },
```

- [ ] **Step 7: Smoke check.** Run `npm test` (all pass), then `node -e "require('./src/log-tail')"` (no output).

- [ ] **Step 8: Commit**

```bash
git add src/log-tail.js test/log-tail.test.js src/main.js src/preload.js
git commit -m "feat: tail the worker hook log and forward events to the renderer"
```

---

### Task 5: Renderer panel

**Files:**
- Modify: `src/renderer/index.html` (add `#workers` between `</header>` and `<main id="terminal">`; add the `workers.js` script)
- Modify: `src/renderer/renderer.js` (new section after the OSC 9;4 block; clear in `start()`)
- Modify: `src/renderer/styles.css` (panel styles after `#progress` rules)

**Interfaces:**
- Consumes: `window.WidgetWorkers.reduce` and `DONE_TTL_MS` (Task 2), and `widget.workers.onEvents` (Task 4).

- [ ] **Step 1: HTML.** Insert after `</header>`:

```html
    <section id="workers" hidden></section>
```

Insert before `<script src="renderer.js"></script>`:

```html
  <script src="../workers.js"></script>
```

- [ ] **Step 2: CSS.** Append after the `@keyframes progress-busy { ... }` block:

```css
/* Worker rows (subagents and background shells), between the title bar and the terminal. */
#workers {
  flex: 0 0 auto;
  padding: 3px 10px 4px;
  background: var(--bar);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font: 11px/16px 'Cascadia Mono', Consolas, monospace;
  color: var(--muted);
}
#workers[hidden] { display: none; }
.worker { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.worker .label { overflow: hidden; text-overflow: ellipsis; color: #e8e6e3; }
.worker .time { margin-left: auto; font-variant-numeric: tabular-nums; }
.worker .icon {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1.5px solid var(--accent);
  border-right-color: transparent;
  border-radius: 50%;
  animation: worker-spin 0.9s linear infinite;
}
.worker.done .icon { border: 0; animation: none; color: #57ab5a; font-size: 10px; line-height: 8px; }
.worker.done .icon::before { content: '✓'; }
.worker.done { animation: worker-fade 5s ease-in forwards; }
.worker.more { color: var(--muted); }
@keyframes worker-spin { to { transform: rotate(360deg); } }
@keyframes worker-fade { 0%, 60% { opacity: 1; } 100% { opacity: 0.15; } }
```

- [ ] **Step 3: JS.** In `renderer.js`, insert this block right after the `term.parser.registerOscHandler(9, ...)` block:

```js
  // --- Worker rows (subagents + background shells, fed by hooks/workers-hook.js) ---
  const workersEl = document.getElementById('workers');
  const MAX_ROWS = 4;
  let workerEvents = [];
  let workerTimer = null;
  const rowEls = new Map();

  const fmtElapsed = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const makeRow = () => {
    const row = document.createElement('div');
    row.className = 'worker';
    row.innerHTML = '<span class="icon"></span><span class="label"></span><span class="time"></span>';
    return row;
  };

  const renderWorkers = () => {
    const now = Date.now();
    const workers = WidgetWorkers.reduce(workerEvents, now);
    const shown = workers.slice(0, MAX_ROWS);
    const keep = new Set(shown.map((w) => w.id));
    for (const [id, el] of rowEls) if (!keep.has(id)) { el.remove(); rowEls.delete(id); }
    let more = workersEl.querySelector('.more');
    for (const w of shown) {
      let row = rowEls.get(w.id);
      if (!row) {
        // Insert once and never move it: moving a node restarts its CSS fade/spin animations.
        // Workers start in time order, so a new row belongs at the end (before "+N more").
        row = makeRow();
        rowEls.set(w.id, row);
        workersEl.insertBefore(row, more);
      }
      row.querySelector('.label').textContent = w.label;
      row.querySelector('.time').textContent = fmtElapsed((w.doneAt ?? now) - w.startedAt);
      row.classList.toggle('done', w.doneAt !== null);
    }
    if (workers.length > MAX_ROWS) {
      if (!more) { more = document.createElement('div'); more.className = 'worker more'; workersEl.appendChild(more); }
      more.textContent = `+${workers.length - MAX_ROWS} more`;
    } else if (more) {
      more.remove();
    }
    workersEl.hidden = workers.length === 0;
    if (workers.length === 0 && workerTimer) { clearInterval(workerTimer); workerTimer = null; }
  };

  const clearWorkers = () => {
    workerEvents = [];
    renderWorkers();
  };

  widget.workers.onEvents((events) => {
    workerEvents = workerEvents.concat(events);
    renderWorkers();
    if (!workerTimer) workerTimer = setInterval(renderWorkers, 1000);
  });
```

In `start()`, add `clearWorkers();` right after `setProgress(0, 0);`.

Update the first line of `renderer.js` to `/* global Terminal, FitAddon, WebLinksAddon, WidgetWorkers */`.

The terminal re-fits on its own when the panel's height changes: `#terminal` is `flex: 1`, and the existing `ResizeObserver` on it calls `fit.fit()`.

- [ ] **Step 4: Check it from source with a fake event log.** Quit the installed widget first (single-instance lock), then run `npm start` from the repo. In the widget's own PowerShell (or any shell), append fake events to `%APPDATA%\Claude Widget\workers.jsonl`:

```powershell
$f = "$env:APPDATA\Claude Widget\workers.jsonl"; $t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
1..6 | % { Add-Content $f ('{"t":"start","id":"a' + $_ + '","kind":"agent","label":"Explore ' + $_ + '","ts":' + $t + '}') }
```

Expected: the panel appears with 4 spinning rows plus "+2 more", the elapsed time ticks, and the terminal shrinks to fit. Then:

```powershell
$t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); 1..6 | % { Add-Content $f ('{"t":"stop","id":"a' + $_ + '","ts":' + $t + '}') }
```

Expected: the rows switch to ✓, fade, disappear after about 5 s, and the panel hides. Press Ctrl+Shift+R with rows showing: they clear immediately.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/renderer.js src/renderer/styles.css
git commit -m "feat: show worker rows between the title bar and the terminal"
```

---

### Task 6: Install, register hooks, document, and live test

**Files:**
- Modify: `README.md` (Features list; new "Worker rows" subsection under Settings; repo layout)
- Modify (outside repo): `~/.claude/settings.json`

- [ ] **Step 1: README.** Add this to the Features list:

```markdown
- Worker rows: a busy/done row per running subagent and background shell (needs the hooks below)
```

Add this subsection after "### Progress bar":

````markdown
### Worker rows

The widget shows a row for each running subagent and background shell. Claude Code reports these through hooks, so add this to `~/.claude/settings.json` (merge into any existing `hooks`; keep your other `Stop` hooks):

```json
"hooks": {
  "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node \"%LOCALAPPDATA%/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "SubagentStop":  [{ "hooks": [{ "type": "command", "command": "node \"%LOCALAPPDATA%/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "Stop":          [{ "hooks": [{ "type": "command", "command": "node \"%LOCALAPPDATA%/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "PostToolUse":   [{ "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"%LOCALAPPDATA%/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }]
}
```

Replace `%LOCALAPPDATA%` with the full path if your shell doesn't expand it. The hook only acts inside the widget (it checks `CLAUDE_WIDGET_WORKERS`, which the widget sets), so other Claude sessions are unaffected. A background shell's row is marked done at the end of the next Claude turn after it exits.
````

Add these to the repo layout block:

```
src/workers.js         Reducer: hook events -> worker rows (renderer + tests)
src/log-tail.js        Tails the hook event log for the main process
hooks/workers-hook.js  Claude Code hook that writes the event log
```

- [ ] **Step 2: Build and install.** Run `npm test` (all pass), then `npm run dist`. Tell the user to run `dist\Claude Widget Setup 0.1.0.exe`, which restarts the widget. **Warn them first that this ends the current Claude session.**

- [ ] **Step 3: Register the hooks.** Back up `~/.claude/settings.json` to `settings.json.bak-workers`. Then add the four entries using the full path `C:/Users/jacob/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js`. For `Stop`, append the hook object to the existing Stop entry's `hooks` array, after the notify hook. Validate with `node -e "JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8'))"`.

- [ ] **Step 4: Live test in the new widget session.** Ask Claude to:
  - (1) run `Start-Sleep -Seconds 25` in the background, and
  - (2) dispatch one Explore subagent with a small search.

  Expected:
  - Two rows appear: `Start-Sleep -Seconds 25` and `Explore`, both spinning with the elapsed time ticking.
  - The Explore row turns ✓ when the subagent finishes.
  - The shell row turns ✓ at the end of the turn after the sleep exits.
  - Both rows fade and the panel hides.
  - `%APPDATA%\Claude Widget\workers.jsonl` holds the matching lines.

  If a row never finishes, read the log and check the ids against the Task 1 findings.

- [ ] **Step 5: Commit and push**

```bash
git add README.md
git commit -m "docs: document worker rows and hook setup"
git push
```

---

## Probe findings (filled in by Task 1)

Probed 2026-10-04 in Claude Code 2.1.289, inside the widget.

- (a) PostToolUse task id path: `tool_response.backgroundTaskId` (e.g. `"bx9k5rgzg"`). `tool_input.run_in_background === true` for the PowerShell tool.
- (b) Shell id present in Stop `background_tasks` while running / gone after exit: yes, as `{id, type:"shell", status:"running", description, command}`. After the shell exited, the next snapshot no longer listed it.
- (c) Subagent entries in `background_tasks`: `type: "subagent"`, and `id` equals `agent_id`. The `SubagentStop` snapshot still lists the stopping agent as running, which is harmless because the `stop` line is written first. `SubagentStop` can fire twice for one agent, and also fires for internal agents that never had a `SubagentStart`. Both are already ignored by the reducer.
- (d) Hooks inherit session env: yes (`ConEmuTask` was `"claude-widget"` in the hook).
- Resulting settings: `TASK_ID_PATHS = [['tool_response', 'backgroundTaskId']]` (unchanged); `SNAPSHOT_KINDS = ['shell', 'agent']`.

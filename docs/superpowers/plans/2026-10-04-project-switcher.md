# Project Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collapsible project rail on the left of the widget, with one live Claude Code session per opened project and a state dot per row.

**Architecture:** Pure modules (`projects.js`, `session-state.js`, the pure half of `sessions.js`) carry the logic and are unit-tested with `node --test`. `sessions.js` owns every PTY plus its per-session worker log tail and status poll. The renderer keeps one xterm per session (`renderer/terminals.js`) and draws the rail (`renderer/rail.js`); `renderer.js` is the glue.

**Tech Stack:** Electron 44, node-pty, xterm.js 6, node:test.

**Spec:** `docs/superpowers/specs/2026-10-04-project-switcher-design.md`

## Global Constraints

- Rail width: 170px expanded, 36px collapsed. The rail adds width to the window and grows it to the left.
- `window-state.json` bounds exclude the rail; adds `railCollapsed` and `activeProject`.
- Project id = `path.resolve(p)`, lowercased on Windows.
- Session dir = `%APPDATA%\Claude Widget\sessions\<sha1(id) first 12 hex>\` with `workers.jsonl` and `status.json`.
- History dir encoding: every char not in `[A-Za-z0-9]` → `-`.
- New config keys: `projectsRoot` (default `<home>\Projects`), `claudeCommand`.
- Saved lists: `%APPDATA%\Claude Widget\projects.json` = `{ pinned: [paths], hidden: [ids] }`.
- Dot priority: Needs you > Working > Finished > Idle. The active project never enters Finished.
- Notification hook: `notification_type` is `permission_prompt` | `elicitation_dialog` (counted) vs `idle_prompt` | `auth_success` (ignored). Checked in the 2.1.289 binary.

## Review Focus

- A project folder name with spaces or non-ASCII characters: id, session dir and `--continue` detection still work (sessions test).
- A session exits on its own while hidden: the row goes idle-but-exited, and the terminal shows "exited" when you switch to it (session-state test + manual).
- Clicking the active project again does nothing (no respawn) (sessions test: `open` is idempotent).
- A pinned path equal to a scanned folder, differing only in case or a trailing slash, shows once (projects test).
- The rail toggles while maximized: the window size is unchanged (manual check over CDP).

---

### Task 1: `src/projects.js` (pure list building + initials)

**Files:** Create `src/projects.js`, `test/projects.test.js`

**Interfaces:**
- Produces: `normId(p, isWin)`, `initials(name)`, `buildList({ scanned: string[], pinned: string[], hidden: string[], exists: (p)=>bool, isWin }) → [{ id, path, name, pinned, missing }]`

- [ ] Tests: alphabetical case-insensitive order, ties by path; hidden ids removed from the scan but not from pinned; pinned duplicate of a scanned path (case/trailing slash) shown once and marked as not pinned (it is a scanned row); missing pinned → `missing: true`; initials `Claude Widget`→`CW`, `api-server`→`AS`, `notes`→`NO`, `myProject`→`MP`, `x`→`X`.
- [ ] Implement, run `npm test`, commit.

### Task 2: `src/session-state.js` (pure dot reducer)

**Files:** Create `src/session-state.js`, `test/session-state.test.js`

**Interfaces:**
- Produces: `initial() → { working:false, attention:false, finished:false, running:false }`, `apply(s, ev, isActive) → s'`, where `ev` is one of `{t:'progress', state}`, `{t:'attention'}`, `{t:'input'}`, `{t:'activate'}`, `{t:'start'}`, `{t:'exit'}`; and `dot(s) → 'attention'|'working'|'finished'|'idle'`.

- [ ] Tests for every row of the spec table plus priority and "active never finishes".
- [ ] Implement, test, commit.

### Task 3: hook `Notification` case

**Files:** Modify `hooks/workers-hook.js`, `test/workers-hook.test.js`

- [ ] Tests: `permission_prompt` and `elicitation_dialog` → `{t:'attention', reason, ts, sid}`; `idle_prompt`/`auth_success` → nothing; no type + message containing "permission" → attention; malformed → nothing.
- [ ] Implement, test, commit.

### Task 4: `src/sessions.js` (session manager)

**Files:** Create `src/sessions.js`, `test/sessions.test.js`

**Interfaces:**
- Produces: `encodeHistoryDir(cwd)`, `hasHistory(cwd, home)`, `buildLaunch(config, { cont, isWin }) → { file, args }`, `sessionDir(userDir, id)`, `createSessions({ pty, config, userDir, home, isWin, send, onStatus })` → `{ open(id, cwd, cols, rows) → bool, write(id, data), resize(id, cols, rows), restart(id, cols, rows), close(id), closeAll(), has(id), cwd(id), ids() }`. Messages are sent with `send(channel, payload)` using the IPC names in the spec.

- [ ] Tests with a fake pty: open spawns once (idempotent), `--continue` added only when the history dir has a `*.jsonl`, restart never adds it, close kills, env carries per-session paths, explicit `shellArgs` keep their prefix.
- [ ] Implement, test, commit.

### Task 5: main.js wiring

Projects scan/watch/rescan-on-focus, `projects.json`, rail window sizing (grow left, clamp to the work area, maximized case), session IPC, footer status/git per session, `md:resolve`/`md:link` per session cwd, the tray restart targeting the active session, and the context menu (native `Menu`) for rows and the + button.

### Task 6: renderer split

`renderer/terminals.js` (xterm per session), `renderer/rail.js` (rows, collapsed initials), and `renderer.js` glue: per-session caches for workers/status/progress/turn timer, keyboard shortcuts, and the title showing the project name.

### Task 7: settings + README, manual CDP check, build, install

- Back up `~/.claude/settings.json`, then add `workers-hook.js` to `Notification`.
- Check from source over CDP with scratch projects, then `npm run dist` and install.

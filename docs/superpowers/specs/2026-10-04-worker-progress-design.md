# Worker progress rows in the widget

Date: 2026-10-04
Status: approved design, not yet implemented

## Goal

Show one row per running worker in the widget, so you can see at a glance what Claude has going on in the background. A worker is either:

- a **subagent** (Agent tool), or
- a **background shell** (a Bash/PowerShell command run with `run_in_background`).

Each row shows busy or done plus the elapsed time. It does not show a percentage: Claude Code does not expose one for subagents.

The existing OSC 9;4 strip (one overall busy state) stays as it is.

## What Claude Code provides (checked in 2.1.289)

| Worker | Start | Finish |
| --- | --- | --- |
| Subagent | `SubagentStart` hook: `agent_id`, `agent_type` (no description) | `SubagentStop` hook: `agent_id` |
| Background shell | `PostToolUse` on `Bash`/`PowerShell` when `tool_input.run_in_background` is true; the task id is in `tool_response` | No dedicated hook. `Stop` and `SubagentStop` payloads carry `background_tasks`: in-flight work as `{id, type, status, description, command?, agent_type?}` |

A finishing background shell wakes Claude, and that turn ends with `Stop`, so the snapshot after it no longer lists the shell. Finish detection lags by at most one turn.

## Design

### 1. Session ↔ widget link

When `spawnTerminal()` starts a session, it sets `CLAUDE_WIDGET_WORKERS=<userData>\workers.jsonl` in the pty env, after `config.env` so the config can't clobber it. Hooks inherit the variable. Claude sessions outside the widget don't have it, so the hook exits immediately and does nothing. That also means another Claude session can't pollute the widget's rows, without any `session_id` filtering.

### 2. Hook script: `hooks/workers-hook.js`

Plain Node, no dependencies, shipped in the app (`build.files` gains `hooks/**/*`).

- Reads the hook JSON payload from stdin.
- If `CLAUDE_WIDGET_WORKERS` is unset, it exits 0.
- Otherwise it appends one JSON line per event with `fs.appendFileSync`. It appends rather than rewriting a JSON file because parallel subagents start at the same moment, and append-only avoids read-modify-write races.
- It always exits 0, writes nothing to stdout, and swallows its own errors, so it can never block a tool call or print into the session.

Event mapping (`ts` = `Date.now()`):

| Hook | Line written |
| --- | --- |
| `SubagentStart` | `{"t":"start","id":agent_id,"kind":"agent","label":agent_type,"ts"}` |
| `SubagentStop` | `{"t":"stop","id":agent_id,"ts"}`, then a snapshot line |
| `Stop` | snapshot line |
| `PostToolUse` (Bash/PowerShell, `run_in_background` true, task id present) | `{"t":"start","id":taskId,"kind":"shell","label":command clipped to 40 chars,"ts"}` |

Snapshot line: `{"t":"snapshot","ids":[every background_tasks[].id],"ts"}`. Shells always finish through snapshots. Subagents finish through `SubagentStop`, and also through snapshots as a guard (see Error handling), but only if the early check confirms that subagent entries in `background_tasks` use the same id as `agent_id`.

Registration goes in `~/.claude/settings.json`, next to the existing notify hooks, which stay unchanged:

```json
"SubagentStart": [{ "hooks": [{ "type": "command", "command": "node \"<install>/resources/app/hooks/workers-hook.js\"" }] }],
"SubagentStop":  [ same ],
"Stop":          [ same, appended to the existing Stop entry's hooks ],
"PostToolUse":   [{ "matcher": "Bash|PowerShell", "hooks": [ same ] }]
```

`<install>` is `%LOCALAPPDATA%\Programs\claude-desktop-widget`. The README documents this block.

### 3. Widget

**`src/workers.js`**: a pure reducer, `reduce(events, now) -> workers[]`, unit-tested.

- `start` adds a worker `{id, kind, label, startedAt, doneAt: null}`. A repeated `start` for a known id is ignored.
- `stop` sets `doneAt` for that id.
- `snapshot` sets `doneAt` for every running worker of a snapshot-tracked kind that is not listed in `ids`. Shells are always tracked, and agents only if the early check confirms the ids match. It finishes only workers that started before the snapshot's `ts`, so a snapshot taken before a start line can't finish that worker early.
- Workers whose `doneAt` is more than 5 s before `now` are dropped.
- The list is ordered by `startedAt`.

**`src/main.js`**

- On each `spawnTerminal()`, it truncates `workers.jsonl` and resets the read offset.
- It watches the file with `fs.watch` plus a 1 s poll fallback, since `fs.watch` on Windows can miss appends. It reads only bytes past the offset, keeps any partial trailing line for the next read, and skips lines that don't parse as JSON.
- New events go to the renderer as `workers:events`. The full event list is held in the renderer.

**`src/preload.js`**: adds `widget.workers.onEvents(cb)`.

**Renderer**

- A `#workers` element sits between `#bar` and `#terminal` in `index.html`.
- A 1 s ticker runs while any worker exists. Each tick reduces the events and renders the rows:
  - Busy row: spinner glyph, label, `m:ss` elapsed.
  - Done row: ✓, the final elapsed time, and a fade over its last 5 s.
- At most 4 rows are shown, then a "+N more" row.
- The panel is hidden (`display: none`) when the list is empty. The terminal calls `fit()` whenever the panel's row count changes.
- The rows are cleared when the session restarts, since main truncates the log.

### 4. Error handling

- Missing log, unreadable log, or bad lines: skipped. The panel is empty or partial, and nothing throws.
- If the hook fails, Claude is unaffected because it always exits 0.
- A subagent with a lost `SubagentStop` would spin forever. The snapshot guard above covers this if the ids match. If they don't, the row keeps spinning until the session restarts, which clears all rows. That is accepted.

## Testing

1. **Unit tests** (`node --test`, `test/`):
   - Reducer: start/stop, finishing through a snapshot, ignoring a snapshot taken before a shell started, done rows expiring after 5 s, duplicate starts.
   - Hook: pipe sample payloads into the script with a temp `CLAUDE_WIDGET_WORKERS` and assert the lines written. With the variable unset, it writes nothing.
2. **Early check, before building the widget side:** run a real background shell and a real subagent with the hook logging raw payloads, and confirm that:
   - the `PostToolUse` task id field name,
   - the matching `background_tasks[].id` for that shell, and
   - the subagent entries' `type`/`id` in `background_tasks`

   behave as assumed above. Adjust the mapping if they don't.
3. **Live check in the widget:** a background `sleep 20` plus one subagent. Check that the rows appear, tick, turn into ✓, and fade, and that the terminal re-fits.

## Out of scope

- Percent progress.
- Subagent descriptions, because `SubagentStart` doesn't carry them.
- Clicking a row to see output.
- Workers from sessions outside the widget.

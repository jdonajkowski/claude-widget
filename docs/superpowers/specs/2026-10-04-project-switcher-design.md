# Project switcher with live sessions

Date: 2026-10-04
Status: approved design, not yet implemented

## Goal

Switch between projects from a list on the left of the widget. Each opened project keeps its own live Claude Code session running in the background, so switching is instant and loses nothing. The list shows each project's state at a glance: working, needs you, finished while you were away, or idle.

## Decisions

| Question | Decision |
| --- | --- |
| What happens to the session you leave | It keeps running (one live session per opened project). |
| Where the list comes from | Every subfolder of a projects root, plus pinned extras from anywhere. |
| First open of a project in a widget run | `claude --continue` if the folder has Claude history, else `claude`. |
| Layout | Collapsible list on the left (170px expanded, 36px initials strip collapsed). |
| Window size | The rail **adds** width to the window; the terminal and side panel keep their size. |
| Architecture | One xterm per session in the same window (no output replay, no extra windows). |

Not doing: drag-to-reorder, most-recently-used ordering, a cap on open sessions, more than one session per project.

## 1. Layout and window sizing

- Columns, left to right: **project rail | terminal | side panel**. The terminal and side panel keep their current sizes.
- Expanding the rail (170px) grows the window 170px **to the left**, so the terminal stays where it is on screen. Collapsing it (Ctrl+B or a title-bar button) shrinks the rail to 36px and the window by 134px.
- If growing left would push the window past the work area of its display, the window shifts right just enough to fit. If even that can't fit, the terminal shrinks as a last resort.
- Resizing the window by hand changes only the terminal's width, as today.
- `window-state.json` stores the bounds of the window **without** the rail, plus `railCollapsed` and `activeProject`. On restore, the rail width is added back the same way.
- The minimum window width increases by the current rail width.
- The right side panel keeps its current show/hide behavior within the existing width. Only the rail extends the window.
- **Maximized or full screen:** the window can't grow, so expanding or collapsing the rail changes the terminal's width instead. Leaving maximized or full screen restores the saved normal bounds plus the current rail width.

## 2. Main process: session manager

New module `src/sessions.js`. It is the only code that touches `node-pty`, and it takes the `pty` module as a parameter so tests can inject a fake. The single `term`, `workersTail` and `statusPath` globals in `main.js` move into it.

- **Project id:** the folder's normalized absolute path (`path.resolve`, lowercased on Windows).
- **Per-session state:** the PTY, the cwd, and a directory `%APPDATA%\Claude Widget\sessions\<first 12 hex chars of sha1(id)>\` holding `workers.jsonl` and `status.json`, plus a log tail and a status watcher on those files. The PTY env gets `CLAUDE_WIDGET_WORKERS` and `CLAUDE_WIDGET_STATUS` pointing at them, set after `config.env` as today. The existing hooks need no change to be per-session.
- **Starting:** a session starts the first time its project is opened. The command is `config.claudeCommand` (new key). When it isn't set, the default is the last element of `config.shellArgs`, so the current config's `claude.cmd` keeps working, and plain `claude` if `shellArgs` isn't set either. The `--continue` flag is appended to the command ` --continue` when `~/.claude/projects/<encoded cwd>/` contains at least one `*.jsonl`. The encoding replaces every character that isn't `[A-Za-z0-9]` with `-` (e.g. `C:\Users\jacob\Projects` → `C--Users-jacob-Projects`). The command runs inside `config.shell`. On Windows the default args become `['-NoLogo', '-NoExit', '-Command', <command>]`. If the user's config sets `shellArgs` explicitly, the last element is replaced by the command. This keeps `--continue` from failing with "no conversation found" in new projects.
- **Restart (↻):** restarts only the active session, with plain `claudeCommand` (no `--continue`).
- **Close:** "Close session" in a project's context menu kills that PTY and its tail and watcher. The project goes back to idle (○). Quitting the widget kills every session.
- **IPC:** every PTY, worker and status message carries the session id:
  - renderer → main: `pty:start {id, cols, rows}`, `pty:input {id, data}`, `pty:resize {id, cols, rows}`, `pty:restart {id}`, `session:close {id}`
  - main → renderer: `pty:data {id, data}`, `pty:exit {id, code}`, `workers:events {id, events}`, `status {id, status}`
- **Launch:** the widget opens `activeProject` from window state. If it is missing or its folder is gone, it falls back to `config.cwd` when that folder is in the list, otherwise to the first project in the list. The current config's `cwd` is the projects root itself, which is not a project, so it would hit the first-project fallback. Every other project stays idle until clicked.
- `md:resolve` and `md:link` take the session id and resolve relative paths against that session's cwd.

## 3. Renderer: one xterm per session

Split out of `renderer.js` (already 354 lines):

- `src/renderer/terminals.js`: creates and owns one xterm per session.
- `src/renderer/rail.js`: renders the project list and its menus.
- `src/session-state.js`: pure per-session state and dot logic (see section 5), loaded as a plain script like `workers.js`.
- `renderer.js`: glue code.

Behavior:

- Each session gets its own `<div>` inside `#terminal`, with its own xterm, fit addon, web-links / `.md` link handling and OSC 9;4 handler. These are created once, when the session first opens, and kept until the session closes. Hidden terminals keep receiving `pty:data`, so their scrollback is complete.
- **Switching:** hide the old div, show the new one, call `fit()`, send `pty:resize` for that session only, and focus it. Fitting happens after showing because xterm measures 0×0 while hidden.
- **Per-session cache:** worker events, latest status (footer), progress state and turn timer. The worker panel, Workers header and footer always show the active session and re-render from the cache on switch.
- The title bar shows the active project's folder name.
- The 2px progress strip shows the active session's state. Taskbar progress is busy while **any** session is working.
- **Keyboard (caught before xterm):** Ctrl+1…9 opens the Nth project in the list, Ctrl+Tab / Ctrl+Shift+Tab cycle through open sessions in list order, and Ctrl+B toggles the rail.
- When a session's shell exits, only its terminal shows the existing "exited" state.

## 4. Project list

New pure module `src/projects.js`: it builds the ordered list from the scan result and the saved lists. Main does the file I/O.

- **Sources:** every immediate subfolder of `config.projectsRoot` (new key, default `<home>\Projects`), skipping names that start with `.`, plus pinned extras.
- **Saved lists:** `%APPDATA%\Claude Widget\projects.json` holds `{ "pinned": [paths], "hidden": [ids] }`. It is kept separate from the hand-edited `config.json`.
- **Rescan:** at launch, on window focus, and on a non-recursive `fs.watch` of the root (debounced 300ms).
- **Order:** alphabetical by folder name, case-insensitive, with pinned extras mixed in; ties are broken by full path. It never reorders by recent use. A pinned path that is also in the scan appears once.
- **Row:** state dot, then the folder name, with 📌 on pinned extras and the full path as a tooltip. The active row is highlighted.
- **Collapsed row:** two-letter initials with the dot in a corner. Initials come from the first letters of the first two words, splitting on spaces, `-`, `_`, `.` and camelCase (`Claude Widget` → `CW`, `api-server` → `AS`). A one-word name uses its first two letters (`notes` → `NO`).
- **Context menu:** Close session (when one is running), Open in Explorer, then Hide (scanned projects) or Unpin (pinned extras).
- **The + button:** opens a menu with "Add folder…" (folder picker, adds to `pinned`) and "Show hidden (n)" (a submenu that un-hides one project).
- **Edge cases:**
  - A pinned folder that no longer exists shows dimmed as "missing" and can't be opened. Unpin still works.
  - If a running session's folder disappears, the session keeps running and its row stays until you close it.
  - A missing or unreadable `projectsRoot` shows only the pinned list, plus a one-time toast.

## 5. State detection

Each row's dot comes from a pure reducer in `src/session-state.js`, fed by these per-session signals: OSC 9;4 busy/idle, attention events, user input, and which session is active.

| Dot | State | Set by | Cleared by |
| --- | --- | --- | --- |
| ● orange, pulsing | Working | OSC 9;4 state 1–4 | OSC 9;4 state 0 |
| ◐ amber | Needs you | `attention` event | input to that session, or it starts working |
| ✓ green | Finished while away | working → idle while not active | switching to that project |
| ○ grey | Idle / not started | none of the above | — |

Priority when several apply: Needs you > Working > Finished > Idle. The active project never enters "Finished".

**Hook change:** `hooks/workers-hook.js` gets a `Notification` case that writes `{ t: 'attention', reason, ts, sid }`. Only permission prompts and questions count. Claude Code's "waiting for your input" idle notification is ignored, because it follows every turn and "Finished" already covers it. The exact payload field and values (expected: `notification_type`, e.g. `permission_prompt` vs `idle_prompt`) must be checked against real Claude Code 2.1.289 payloads before coding the filter. If there is no type field, fall back to matching the `message` text, and record which was used in the hook's comments.

**Settings change:** add `workers-hook.js` to the existing `Notification` hook list in `~/.claude/settings.json`, next to `notify.ps1` (which keeps its toasts). Back up the file first, and document the registration in the README.

## Testing

- **Unit (node --test):**
  - `projects.js`: ordering, hiding, pinning, de-duplication, initials, missing folders.
  - `sessions.js`: id normalization, history-dir encoding and the `--continue` decision, command / shellArgs building, per-session paths, start/close/restart with a fake pty.
  - `session-state.js`: every transition and clearing rule in the table above, and the priority order.
  - `workers-hook.js`: Notification cases (counted, ignored, malformed).
- **Manual (from-source instance over CDP, as with the Workers header):** fake sessions in two or three scratch project folders, with checks for switching, scrollback being kept, the dots changing, the window growing left and back, the edge-of-screen shift, and restoring after a restart.
- **Final check:** install the build and confirm with real Claude sessions in two projects.

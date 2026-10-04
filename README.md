# Claude Widget

A borderless, always-on-top desktop widget that hosts a [Claude Code](https://claude.com/claude-code) terminal session. Built with Electron, [xterm.js](https://xtermjs.org/) and [node-pty](https://github.com/microsoft/node-pty).

## Features

- Frameless, resizable window that remembers its size and position
- Project switcher: a list of projects on the left, each with its own live Claude Code session, and a dot showing whether it is working, needs you, finished while you were away, or idle
- Global hotkey to show/hide (default `Ctrl+Alt+Space`) and a tray icon with a menu
- Pin on top, adjustable opacity, and optional Windows 11 acrylic/mica backdrop
- Terminal progress bar: Claude Code's OSC 9;4 progress is drawn under the title bar and on the taskbar icon
- Worker rows: a busy/done row per running subagent and background shell (needs the hooks below)
- Status footer: model, cost, context use, 5-hour/7-day limits, git branch and changes, and a turn timer
- Markdown popouts: click a `.md` path in the terminal to open it rendered in its own window (live-reloads on save)
- The shell stays open after `claude` exits, so quitting Claude drops you at a prompt

## Keyboard and mouse

| Action | Shortcut |
| --- | --- |
| Show / hide widget | `Ctrl+Alt+Space` (configurable) |
| Copy selection | `Ctrl+C` with text selected, or `Ctrl+Shift+C` |
| Paste | `Ctrl+V` / `Ctrl+Shift+V` |
| Newline in Claude's prompt | `Shift+Enter` |
| Restart session | `Ctrl+Shift+R` |
| Open the Nth project in the list | `Ctrl+1` … `Ctrl+9` |
| Next / previous open session | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Collapse / expand the project list | `Ctrl+Shift+B`, or the title-bar ☰ button |
| Font size | `Ctrl+=` / `Ctrl+-` |
| Maximize / restore | Title-bar □ button, or double-click the title bar |
| Full screen | `F11` |
| Right-click | Copy selection, or paste if nothing is selected |
| Click a `.md` path | Open it rendered in a popout (`Esc` closes the popout) |

Title-bar buttons: restart, more/less transparent, pin on top, settings, maximize, hide to tray, quit. Leaving maximized or full screen returns the window to its previous size, and a restart reopens it maximized if it was maximized when you quit.

## Settings

Settings live in `%APPDATA%\Claude Widget\config.json` (the gear button or tray menu opens it). The file is created with defaults on first run; restart the widget after editing.

| Key | Default | Notes |
| --- | --- | --- |
| `shell` / `shellArgs` | `powershell.exe -NoLogo -NoExit -Command claude` | Shell that hosts each session. Its last argument is replaced by the Claude command |
| `claudeCommand` | last `shellArgs` element, else `claude` | Command each project's session runs. ` --continue` is added the first time a project with Claude history is opened |
| `projectsRoot` | `~\Projects` | Every subfolder (except names starting with `.`) is listed as a project |
| `cwd` | home folder | Project to open at launch when no project was open last time, if it is in the list |
| `env` | `{}` | Extra environment variables for the session |
| `alwaysOnTop` | `true` | |
| `opacity` | `0.95` | 0.3–1 |
| `backgroundMaterial` | `"none"` | `"acrylic"`, `"mica"` or `"tabbed"` (Windows 11 22H2+) |
| `showInTaskbar` | `false` | Needs to be `true` for taskbar progress |
| `hotkey` | `Control+Alt+Space` | Electron accelerator syntax |
| `fontFamily` / `fontSize` | Cascadia Mono, 13 | |
| `theme` | dark | xterm.js theme colors |

Window position, pin state, opacity, the project list's collapsed state and the active project are saved separately in `window-state.json` in the same folder. The saved bounds exclude the project list, whose width is added on the left.

### Project list

The list on the left shows every subfolder of `projectsRoot` plus folders you pin from anywhere (📌), in alphabetical order. Click a project to switch to it. The session you leave keeps running in the background. A project's session starts the first time you open it in a widget run, with `--continue` if Claude has history for that folder. ↻ restarts only the active session, with a fresh conversation. Expanding the list (170px) grows the window to the left. Collapsed (36px), it shows two-letter initials.

| Dot | Meaning |
| --- | --- |
| Pulsing orange | Working (OSC 9;4 progress) |
| Amber half | Needs you: a permission prompt or a question (needs the `Notification` hook below) |
| Green ✓ | Finished while you were looking at another project |
| Grey ring | Idle or not started |

Right-click a project for Close session, Open in Explorer, and Hide (Unpin for pinned folders). The + button adds a folder or un-hides one. Pins and hidden projects are saved in `%APPDATA%\Claude Widget\projects.json`.

### Progress bar

Claude Code only emits OSC 9;4 progress for terminals it recognises, and it explicitly turns progress *off* when `WT_SESSION` is set (checked in 2.1.289). Make the session look like ConEmu instead in `config.json`:

```json
"env": { "ConEmuTask": "claude-widget" }
```

Do not set `WT_SESSION`; it disables the bar.

### Worker rows

The widget shows a row for each running subagent and background shell, in a side panel to the right of the terminal. Rows stack from the top of the panel, above the status footer. The panel shows whenever there are rows or footer data. Claude Code reports these through hooks, so add this to `~/.claude/settings.json`. Merge it into any existing `hooks`, and keep your other `Stop` hooks by adding this one to the same `hooks` array.

```json
"hooks": {
  "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "SubagentStop":  [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "Stop":          [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "PostToolUse":   [{ "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "Notification":  [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }]
}
```

Replace `<you>` with your Windows user name. The hook only acts inside the widget: it checks `CLAUDE_WIDGET_WORKERS`, which the widget sets for each of its sessions, so other Claude sessions are unaffected. The `Notification` entry drives the "needs you" dot. Only permission prompts and questions count (`notification_type` `permission_prompt` / `elicitation_dialog`), not the idle reminder after each turn. Subagent rows finish when the subagent stops. A background shell's row is marked done at the end of the next Claude turn after it exits, since Claude Code has no hook for that. Finished rows fade out after 5 seconds. Events are logged per session to `%APPDATA%\Claude Widget\sessions\<hash>\workers.jsonl`, which is cleared on each session restart.

### Status footer

The bottom of the side panel shows:

- **Model, effort and session cost.**
- **Context:** a bar and the percentage of the context window in use. It turns yellow at 60% and red at 85%.
- **Rate limits:** 5-hour and 7-day usage, and when the 5-hour window resets.
- **Git:** the branch, the number of changed files (●), and commits ahead (↑) or behind (↓) its upstream. Checked every 3 seconds in the session's current folder.
- **Turn timer:** how long Claude has been working on this turn (▶), or how long the last turn took. It follows the progress bar, so it needs the progress setup above.

Model, cost, context and limits come from Claude Code's status line JSON. Wrap your status line command with `hooks/statusline-tee.js` in `~/.claude/settings.json`. The wrapper saves the JSON for the widget, then runs your command and passes its output through, so your status line looks the same:

```json
"statusLine": {
  "type": "command",
  "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/statusline-tee.js\" npx -y ccstatusline@latest"
}
```

Everything after the script path is your own status line command. With nothing after it, the wrapper prints nothing. Like the worker hook, it only saves inside the widget (`CLAUDE_WIDGET_STATUS`). The JSON goes per session to `%APPDATA%\Claude Widget\sessions\<hash>\status.json`, which is cleared on each session restart. The footer shows the active project.

### Markdown popouts

A Markdown path in the terminal output (`.md` or `.markdown`, absolute or relative to the session's folder, spaces allowed) is underlined on hover if the file exists. Clicking it opens the file rendered in its own window. The popout re-renders when the file changes, links to other Markdown files open in their own popouts, and web links open in your browser. Clicking a file that is already open focuses its popout.

## Running from source

Requires Node.js (tested with 24 / npm 11) and Claude Code (`claude` on your `PATH`).

```sh
npm install      # Electron itself downloads on first run
npm start        # run the widget from source
npm test         # unit tests
npm run pack     # unpacked build in dist/win-unpacked
npm run dist     # installer: dist/Claude Widget Setup <version>.exe
```

The installer is a one-click, per-user NSIS setup that installs to `%LOCALAPPDATA%\Programs\claude-desktop-widget` and replaces an existing install. Your settings in `%APPDATA%\Claude Widget` are kept.

Notes:

- No C++ toolchain is needed: `node-pty` ships N-API prebuilds that load in Electron as-is, so the build skips native rebuilds (`npmRebuild: false`).
- npm 11 blocks dependency install scripts by default; `node-pty`'s (which checks the prebuilds and copies `conpty.dll`) is approved in `allowScripts` in `package.json`.
- The widget only allows one instance, so `npm start` just focuses the widget if it's already running. Quit it first.
- `asar` is off, matching the original install layout, so `node-pty`'s binaries load from disk.

## Repo layout

```
src/main.js            Electron main process: window, tray, hotkey, project list, settings
src/sessions.js        One PTY + worker log + status file per open project
src/projects.js        Builds the project list (scan + pinned - hidden) and initials
src/session-state.js   Reducer: per-session signals -> project dot (renderer + tests)
src/preload.js         Bridge exposed to the renderer as window.widget
src/renderer/          UI: terminals.js (one xterm per session), rail.js (project list), renderer.js (glue)
src/workers.js         Reducer: hook events -> worker rows (renderer + tests)
src/log-tail.js        Tails the hook event log for the main process
src/footer.js          Status footer formatting (renderer + tests)
src/git-status.js      Git branch and changes for the footer
src/md-links.js        Finds Markdown paths in terminal text (renderer + tests)
src/md/                Markdown popout window
hooks/workers-hook.js  Claude Code hook that writes the event log
hooks/statusline-tee.js  statusLine wrapper that saves the status JSON for the footer
test/                  Unit tests (npm test)
assets/                App and tray icons
backup/original-src/   Source before the progress-bar patch
backup/config.json     Snapshot of a working user config
```

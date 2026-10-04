# Claude Widget

A borderless, always-on-top desktop widget that hosts a [Claude Code](https://claude.com/claude-code) terminal session. Built with Electron, [xterm.js](https://xtermjs.org/) and [node-pty](https://github.com/microsoft/node-pty).

## Features

- Frameless, resizable window that remembers its size and position
- Global hotkey to show/hide (default `Ctrl+Alt+Space`) and a tray icon with a menu
- Pin on top, adjustable opacity, and optional Windows 11 acrylic/mica backdrop
- Terminal progress bar: Claude Code's OSC 9;4 progress is drawn under the title bar and on the taskbar icon
- Worker rows: a busy/done row per running subagent and background shell (needs the hooks below)
- The shell stays open after `claude` exits, so quitting Claude drops you at a prompt

## Keyboard and mouse

| Action | Shortcut |
| --- | --- |
| Show / hide widget | `Ctrl+Alt+Space` (configurable) |
| Copy selection | `Ctrl+C` with text selected, or `Ctrl+Shift+C` |
| Paste | `Ctrl+V` / `Ctrl+Shift+V` |
| Newline in Claude's prompt | `Shift+Enter` |
| Restart session | `Ctrl+Shift+R` |
| Font size | `Ctrl+=` / `Ctrl+-` |
| Right-click | Copy selection, or paste if nothing is selected |

Title-bar buttons: restart, more/less transparent, pin on top, settings, hide to tray, quit.

## Settings

Settings live in `%APPDATA%\Claude Widget\config.json` (the gear button or tray menu opens it). The file is created with defaults on first run; restart the widget after editing.

| Key | Default | Notes |
| --- | --- | --- |
| `shell` / `shellArgs` | `powershell.exe -NoLogo -NoExit -Command claude` | Command that starts Claude Code |
| `cwd` | home folder | Starting directory |
| `env` | `{}` | Extra environment variables for the session |
| `alwaysOnTop` | `true` | |
| `opacity` | `0.95` | 0.3–1 |
| `backgroundMaterial` | `"none"` | `"acrylic"`, `"mica"` or `"tabbed"` (Windows 11 22H2+) |
| `showInTaskbar` | `false` | Needs to be `true` for taskbar progress |
| `hotkey` | `Control+Alt+Space` | Electron accelerator syntax |
| `fontFamily` / `fontSize` | Cascadia Mono, 13 | |
| `theme` | dark | xterm.js theme colors |

Window position, pin state and opacity are saved separately in `window-state.json` in the same folder.

### Progress bar

Claude Code only emits OSC 9;4 progress for terminals it recognises, and it explicitly turns progress *off* when `WT_SESSION` is set (checked in 2.1.289). Make the session look like ConEmu instead in `config.json`:

```json
"env": { "ConEmuTask": "claude-widget" }
```

Do not set `WT_SESSION`; it disables the bar.

### Worker rows

The widget shows a row for each running subagent and background shell, in a side panel to the right of the terminal. The panel opens when the first worker starts and closes once every row has faded. Claude Code reports these through hooks, so add this to `~/.claude/settings.json`. Merge it into any existing `hooks`, and keep your other `Stop` hooks by adding this one to the same `hooks` array.

```json
"hooks": {
  "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "SubagentStop":  [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "Stop":          [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }],
  "PostToolUse":   [{ "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Local/Programs/claude-desktop-widget/resources/app/hooks/workers-hook.js\"" }] }]
}
```

Replace `<you>` with your Windows user name. The hook only acts inside the widget: it checks `CLAUDE_WIDGET_WORKERS`, which the widget sets for its session, so other Claude sessions are unaffected. Subagent rows finish when the subagent stops. A background shell's row is marked done at the end of the next Claude turn after it exits, since Claude Code has no hook for that. Finished rows fade out after 5 seconds. Events are logged to `%APPDATA%\Claude Widget\workers.jsonl`, which is cleared on each session restart.

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
src/main.js            Electron main process: window, tray, hotkey, PTY, settings
src/preload.js         Bridge exposed to the renderer as window.widget
src/renderer/          Terminal UI (xterm.js), title bar, worker rows, styles
src/workers.js         Reducer: hook events -> worker rows (renderer + tests)
src/log-tail.js        Tails the hook event log for the main process
hooks/workers-hook.js  Claude Code hook that writes the event log
test/                  Unit tests (npm test)
assets/                App and tray icons
backup/original-src/   Source before the progress-bar patch
backup/config.json     Snapshot of a working user config
```

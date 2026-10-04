# Claude Widget

A borderless, always-on-top desktop widget that hosts a [Claude Code](https://claude.com/claude-code) terminal session. Built with Electron, [xterm.js](https://xtermjs.org/) and [node-pty](https://github.com/microsoft/node-pty).

## Features

- Frameless, resizable window that remembers its size and position
- Global hotkey to show/hide (default `Ctrl+Alt+Space`) and a tray icon with a menu
- Pin on top, adjustable opacity, and optional Windows 11 acrylic/mica backdrop
- Terminal progress bar: Claude Code's OSC 9;4 progress is drawn under the title bar and on the taskbar icon
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

Claude Code may only emit progress sequences for terminals it recognises. If the bar never appears, try making the session look like Windows Terminal in `config.json`:

```json
"env": { "WT_SESSION": "1" }
```

## Running from source

Requires Node.js and Claude Code (`claude` on your `PATH`).

```sh
npm install
npm install --save-dev electron
npx electron .
```

`node-pty` is a native module, so it must be built against Electron's Node version (for example with `@electron/rebuild`), and on Windows this needs the Visual Studio C++ build tools. The repo does not yet include packaging config; the installed app lives in `%LOCALAPPDATA%\Programs\Claude Widget`.

## Repo layout

```
src/main.js            Electron main process: window, tray, hotkey, PTY, settings
src/preload.js         Bridge exposed to the renderer as window.widget
src/renderer/          Terminal UI (xterm.js), title bar, styles
assets/                App and tray icons
backup/original-src/   Source before the progress-bar patch
backup/config.json     Snapshot of a working user config
```

# Claude Widget

A borderless, always-on-top desktop widget that hosts [Claude Code](https://claude.com/claude-code) terminal sessions, one per project, with a file tree, an editor, a browser and a status panel around them. Built with Electron, [xterm.js](https://xtermjs.org/), [node-pty](https://github.com/microsoft/node-pty) and [Monaco](https://microsoft.github.io/monaco-editor/). Runs on Windows and Linux (Arch packages included).

## Install

**Windows:** download `Claude.Widget.Setup.<version>.exe` from the [latest release](https://github.com/jdonajkowski/claude-widget/releases/latest) and run it. It installs per user to `%LOCALAPPDATA%\Programs\claude-desktop-widget`, needs no admin rights and replaces an existing install. Everything the widget itself needs is inside the installer; Node.js is not required. The installer isn't code-signed, so SmartScreen may ask you to confirm ("More info" → "Run anyway").

**Linux:** installers are published as [GitHub Releases](https://github.com/jdonajkowski/claude-widget/releases): an Arch `.pacman` package and an AppImage for other distros. This one-liner picks the right file and installs it (no GitHub account needed):

```sh
curl -fsSL https://raw.githubusercontent.com/jdonajkowski/claude-widget/main/scripts/install-linux.sh | bash
```

On Arch and Arch-based distros it installs the package to `/opt/Claude Widget` with a menu entry (it asks for your sudo password). Elsewhere it puts the AppImage in `~/.local/bin` with a menu entry; AppImages need FUSE 2 (`libfuse2` / `fuse2`). To update, run it again. Add `-s v0.3.0` after `bash` for a specific release. You can also download the files from the [releases page](https://github.com/jdonajkowski/claude-widget/releases) and run `sudo pacman -U claude-desktop-widget-<version>.pacman`.

**First launch** opens **Settings → Setup**, which checks this machine and fixes what's missing:

| Item | What Setup does |
| --- | --- |
| Claude Code | Installs it with the official installer (`irm https://claude.ai/install.ps1 \| iex` on Windows, `curl -fsSL https://claude.ai/install.sh \| bash` on Linux) |
| Git | Installs it (`winget` on Windows; `pacman`, `apt` or `dnf` on Linux) and sets your commit name and email |
| GitHub CLI | Installs it and signs in (`gh auth login`) |
| Claude sign-in | Starts `claude`, which signs you in through your browser |
| Node.js, VS Code | Optional; installs them if you want npx-based tools or "Open in VS Code" |

Install and sign-in steps run in a terminal window you can see. Click **Check again** when one finishes: the widget re-reads `PATH`, so new tools work without a restart. Setup is always available from the tray menu or **Settings → Setup**.

## Where things are stored

Everything lives under your projects folder, `~/Projects` (`%USERPROFILE%\Projects` on Windows):

| Folder | Contents |
| --- | --- |
| `~/Projects/<name>` | Your projects. Every subfolder is listed in the widget |
| `~/Projects/.claude` | Claude Code's config folder for widget sessions (`CLAUDE_CONFIG_DIR`): plugins, skills, commands, history, `settings.json`, `CLAUDE.md` and the global `AGENTS.md` |
| `~/Projects/.claude/widget` | The widget's own files: `config.json`, `window-state.json`, `projects.json`, per-session logs |

The first run copies what already exists: `%APPDATA%\Claude Widget` (Windows) into `.claude/widget`, and `~/.claude` plus `~/.claude.json` into `~/Projects/.claude`. Plugin paths are rewritten to the new folder. Your sign-in token is **not** copied, because two copies of one login can sign each other out. Instead, widget sessions sign in once on their own (Setup → Sign in). Claude Code outside the widget, including the Claude desktop app, keeps using `~/.claude`. Set **Settings → General → Claude config folder** to empty to share `~/.claude` instead.

Tools that read Claude's folder directly need to be pointed at it, e.g. `CLAUDE_CONFIG_DIR=~/Projects/.claude npx ccusage@latest daily`.

## Features

- **Projects:** a list on the left with one live Claude Code session per project, and a dot showing whether it is working, needs you, finished while you were away, or idle
- **Files pane:** the folder button in the title bar shows a file tree of the active project. Markdown opens in the viewer, HTML and SVG in the built-in browser, other text files in the editor, and the rest in their default app (programs are shown in Explorer instead of run)
- **Editor:** text files open in Monaco, VS Code's editor component, with syntax highlighting, multi-cursor and find/replace. `Ctrl+S` saves. Changes Claude makes on disk reload live, or show a Reload / Keep my edits bar if you have unsaved edits
- **Open in VS Code:** in the editor, the Markdown viewer and the files pane's right-click menu
- **Browser:** the globe button opens a Chromium window for mockups, local dev servers and tests. It has back/forward, viewport sizes (desktop 1440, laptop 1280, tablet 768, mobile 390), DevTools, and a screenshot button that saves a PNG next to the project, so Claude can look at it. Local HTML files reload when anything in their folder changes. `localhost` links Claude prints open here, other web links in your default browser. Pages run sandboxed, with no permissions (camera, location, …) and their own storage
- **Markdown popouts:** click a `.md` path in the terminal to open it rendered (live-reloads on save). Paths relative to a subfolder, bare file names, a trailing period and OSC 8 links all work. **Edit** opens the file in the editor
- **Settings window:** every setting in a form (gear button), plus **Global instructions**, an editor for the `AGENTS.md` Claude follows in every project
- **Status panel** (right): worker rows for subagents and background shells, model, cost, context use, 5-hour/7-day limits, git branch and changes, and a turn timer. It collapses to a slim strip
- Terminal progress bar under the title bar and on the taskbar icon (Claude Code's OSC 9;4 progress)
- Global hotkey to show/hide (default `Ctrl+Alt+Space`), tray icon, pin on top, adjustable opacity, Windows 11 acrylic/mica backdrop
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
| Show / hide the files pane | `Ctrl+Shift+E`, or the title-bar folder button |
| Collapse / expand the right panel | `Ctrl+Shift+W`, the › button in its header, or click the collapsed strip |
| Font size | `Ctrl+=` / `Ctrl+-` |
| Maximize / restore | Title-bar □ button, or double-click the title bar |
| Full screen | `F11` |
| Right-click | Copy selection, or paste if nothing is selected |
| Click a `.md` path | Open it rendered in a popout (`Esc` closes the popout) |
| Right-click a file in the files pane | Open, edit, open in browser, open in VS Code, show in Explorer, copy path |
| Save in the editor / settings | `Ctrl+S` |
| Browser: address bar, reload, DevTools, back / forward | `Ctrl+L`, `F5` (`Shift` skips the cache), `F12`, `Alt+←` / `Alt+→` |

Title-bar buttons: project list, files, browser on the left; restart, more/less transparent, pin on top, settings, maximize, hide to tray, quit on the right.

## Settings

The gear button (or the tray menu) opens the settings window. It edits `~/Projects/.claude/widget/config.json`, keeps keys it doesn't know, and says when a change needs a restart (it has a Restart button). Opacity, pin and the hotkey apply right away. **Open config.json** opens the file itself.

| Key | Default | Notes |
| --- | --- | --- |
| `shell` / `shellArgs` | `powershell.exe -NoLogo -NoExit -Command claude` (Linux: `$SHELL -lc …`) | Shell that hosts each session. Its last argument is replaced by the Claude command |
| `claudeCommand` | last `shellArgs` element, else `claude` | Command each project's session runs. ` --continue` is added the first time a project with Claude history is opened |
| `claudeConfigDir` | `~/Projects/.claude` | Claude Code's config folder for widget sessions (`CLAUDE_CONFIG_DIR`). Empty: `~/.claude` |
| `claudeHooks` | `true` | Pass the widget's hooks and status line to each session (see below) |
| `projectsRoot` | `~/Projects` | Every subfolder (except names starting with `.`) is listed as a project |
| `cwd` | home folder | Project to open at launch when no project was open last time, if it is in the list |
| `env` | `{}` | Extra environment variables for the sessions |
| `alwaysOnTop` | `true` | |
| `opacity` | `0.95` | 0.3–1 |
| `backgroundMaterial` | `"none"` | `"acrylic"`, `"mica"` or `"tabbed"` (Windows 11 22H2+) |
| `showInTaskbar` | `false` | Needs to be `true` for taskbar progress |
| `hotkey` | `Control+Alt+Space` | Electron accelerator syntax |
| `fontFamily` / `fontSize` | Cascadia Mono, 13 | |
| `theme` | dark | xterm.js theme colors |

Window position, pin state, opacity, the open/collapsed state of each pane and the active project are saved in `window-state.json` in the same folder.

### Global instructions

**Settings → Global instructions** edits `AGENTS.md` in Claude's config folder (`~/Projects/.claude/AGENTS.md`). Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so saving also adds an `@AGENTS.md` import line to the `CLAUDE.md` next to it (anything already in that file is kept). The same `AGENTS.md` can be shared with other AI tools.

### Hooks and status line

Worker rows, the "needs you" dot and most of the status footer come from Claude Code hooks (`hooks/workers-hook.js`) and a status line wrapper (`hooks/statusline-tee.js`). With `claudeHooks` on, the widget hands them to each session it starts with `claude --settings`, so `settings.json` needs nothing added. The wrapper runs your own status line command (from `settings.json`) and passes its output through, so your status line looks the same.

The scripts run on Node.js when it's on `PATH`, otherwise on the widget's own runtime (`ELECTRON_RUN_AS_NODE`), through bash on Linux or Git Bash, or PowerShell on Windows without Git Bash. If `settings.json` already has the widget's hooks or wrapper (the manual setup of older versions), the widget uses those and doesn't add its own. Hooks only act inside the widget: they check `CLAUDE_WIDGET_WORKERS` and `CLAUDE_WIDGET_STATUS`, which only widget sessions have.

Only permission prompts and questions turn the dot to "needs you" (`notification_type` `permission_prompt` / `elicitation_dialog`), not the idle reminder after each turn. Subagent rows finish when the subagent stops. A background shell's row is marked done at the end of the next Claude turn after it exits, since Claude Code has no hook for that. Finished rows fade out after 5 seconds.

### Project list

The list shows every subfolder of `projectsRoot` plus folders you pin from anywhere (📌), in alphabetical order. Click a project to switch to it. The session you leave keeps running in the background. A project's session starts the first time you open it in a widget run, with `--continue` if Claude has history for that folder. ↻ restarts only the active session, with a fresh conversation. Right-click a project for Close session, Open in Explorer, and Hide (Unpin for pinned folders). The + button adds a folder or un-hides one.

| Dot | Meaning |
| --- | --- |
| Pulsing orange | Working (OSC 9;4 progress) |
| Amber half | Needs you: a permission prompt or a question |
| Green ✓ | Finished while you were looking at another project |
| Grey ring | Idle or not started |

### Progress bar

Claude Code only emits OSC 9;4 progress for terminals it recognises, and turns progress *off* when `WT_SESSION` is set. Make the session look like ConEmu instead in `config.json`: `"env": { "ConEmuTask": "claude-widget" }`. Do not set `WT_SESSION`.

## Building

Requires Node.js 20+ (tested with 24 / npm 11).

```sh
npm install         # Electron downloads on first run
npm start           # run from source
npm test            # unit tests
npm run dist        # Windows installer: dist/Claude Widget Setup <version>.exe
```

**Linux packages** (Arch `.pacman` and an AppImage) have to be built on Linux, because `node-pty` is compiled there. On Linux or in WSL, after the one-time package install listed at the top of the script:

```sh
bash scripts/build-linux.sh     # puts the .pacman and .AppImage in dist/
```

Or let GitHub build both platforms (`.github/workflows/build.yml`): **Build installers** in the repo's Actions tab attaches the installers to the run. To publish a release, bump `version` in `package.json`, commit, and push a matching tag:

```sh
git tag v0.3.1 && git push origin v0.3.1
```

The build checks the tag matches `package.json`, then publishes the Windows `.exe`, the `.pacman` and the AppImage as the release `v0.3.1`.

Notes:

- On Windows, `node-pty` ships N-API prebuilds that load in Electron as-is, so the build skips native rebuilds (`npmRebuild: false`).
- npm 11 blocks dependency install scripts by default; `node-pty`'s is approved in `allowScripts` in `package.json`.
- The widget allows one instance, so `npm start` just focuses a running widget. Quit it first, or run with `--user-data-dir=<folder>` for a separate instance.
- `asar` is off, so `node-pty`'s binaries and the hook scripts load from disk. Only Monaco's `min` build is packaged.

## Repo layout

```
src/main.js              Electron main process: windows, tray, hotkey, projects, settings, setup, IPC
src/sessions.js          One PTY + worker log + status file per open project
src/claude-launch.js     --settings for each session: hooks, status line wrapper, runtime choice
src/data-dirs.js         ~/Projects/.claude layout and the one-time copy from older locations
src/setup-checks.js      Setup tab: tools, install and sign-in commands
src/settings.js          Settings form validation, AGENTS.md import
src/files.js             Files pane: folder listing, open actions, Markdown lookup, VS Code links
src/browser-window.js    Built-in browser window; src/browser-url.js turns typed text into URLs
src/projects.js          Project list (scan + pinned - hidden) and initials
src/session-state.js     Reducer: per-session signals -> project dot
src/workers.js           Reducer: hook events -> worker rows
src/log-tail.js          Tails the hook event log
src/footer.js            Status footer formatting
src/git-status.js        Git branch and changes for the footer
src/md-links.js          Finds Markdown paths in terminal text
src/preload.js           Bridge exposed to the main window as window.widget
src/renderer/            Main window UI: terminals, project rail, files pane
src/editor/              Editor window (Monaco)
src/settings/            Settings window
src/browser/             Browser toolbar
src/md/                  Markdown popout window
hooks/                   workers-hook.js and statusline-tee.js, run by Claude Code
scripts/build-linux.sh   Builds the Linux packages
scripts/install-linux.sh Installs the latest release on Linux
test/                    Unit tests (npm test)
assets/                  App and tray icons
backup/                  Source before the progress-bar patch, and a snapshot of a working config
```

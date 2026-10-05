# Claude Code customizations: usage guide

User-level setup in `C:\Users\jacob\.claude`. Applies to every project. Original settings backed up at `settings.json.bak`.

> **Widget sessions use their own copy.** Since widget 0.3.0, sessions started inside Claude Widget use `C:\Users\jacob\Projects\.claude` (copied once from `~\.claude`). To change something for widget sessions, edit the file there (e.g. `Projects\.claude\settings.json`, `Projects\.claude\commands\`). The Claude desktop app and plain terminals keep using `~\.claude`.

## Claude Widget tools (0.4.0)

The title bar has these buttons after the folder and globe: **▶ Run**, **⛨ shield** (admin and system) and **grid** (Workbench, `Ctrl+Shift+G`).

### Coding

| To… | Do this |
|---|---|
| Run a script, test, build or package | **▶** → the dropdown for the toolchain (**npm**, **SPFx**, **C# / .NET**, **Python**, and others the project uses) → **Run**, **Test**, **Package** or **Setup**. E.g. SPFx → Package → *bundle + package-solution (ship)*; C# → Package → *publish (Release)*; Python → Setup → *create .venv*. It runs in a tab above the terminal. A dev server's `localhost` URL opens in the built-in browser by itself |
| See two terminals at once | Drag a tab onto the lower half of the terminal (or `Ctrl+Shift+\`, or the ⬓ button right of the tabs). Drag tabs between the two zones, or `Ctrl+Shift+M` to move the focused one. Drag the bar between them to resize. **▶** → *New terminal below* opens a shell straight into the lower zone |
| Show a mockup or demo | Ask Claude for it; the global `AGENTS.md` tells Claude to open it in the built-in browser with `widget-open <file-or-url>`. You can run `widget-open` yourself in any widget tab too |
| Have Claude check a page | Ask e.g. *"check the login page on mobile and fix any console errors"*. Claude uses `widget-browser` to open it, take screenshots it can look at, switch the viewport, click and type, read the console and failed requests, and send DevTools Protocol commands. Try `widget-browser help` in a widget tab. Off switch: Settings → General → *Let Claude drive the built-in browser* |
| Follow a long job | The right panel shows Claude's task list (*3/7* and the current task), a running benchmark, and each Run task (orange = running, green = passed, red = failed; click to see it) |
| Watch your usage limits | Right panel, bottom: **5h** and **7d** bars, and **time** = how far through the 5-hour window you are. If 5h runs ahead of time, you'll hit the limit before it resets |
| Open a plain terminal in the project | **▶** → New terminal |
| Switch between Claude and the other tabs | Click the tab, or `Ctrl+PageUp` / `Ctrl+PageDown`. Close with × (or middle-click). After a task exits, Enter runs it again |
| See what changed in git | The files pane marks changed files: **M** modified, **N** new, **A** added, **D** deleted, **R** renamed, **U** conflict, a dot on folders with changes |
| Review, stage and commit | Workbench → **Git**: click a file for a side-by-side diff (tick *Inline* for one column). **+** stage, **−** unstage, **↺** discard. Write a message (or **✨ Suggest**, which has Claude write it from the diff) and **Commit** (`Ctrl+Enter`). With nothing staged, Commit takes all changes. **Push** / **Pull** at the top |
| Search the project | `Ctrl+Shift+F`, or the box at the top of the files pane. `.*` = regex, `Aa` = match case. Click a hit to open the editor at that line; `Esc` clears |
| Run two Claude sessions on one repo | Right-click the project → **New worktree session…**, type a branch name (new or existing). A second checkout appears in the list as `⑂ project--branch` with its own session. Merge the branch as usual when done, then right-click it → **Remove this worktree…** (the branch is kept) |
| Start a new project | Workbench → **New project**: name, template (Empty, Node.js tool, Vite web app, Electron, Python), git + first commit, install dependencies, optional private GitHub repo. It opens in the widget, with `AGENTS.md` ready for project instructions |
| See token use and cost | Workbench → **Usage**: today, last 30 days, all time, a daily chart and every session with its project (from ccusage). Tick *Include ~/.claude* to count Claude used outside the widget too |

### Tuning the system

**The safety net.** When Claude in a widget session runs a command that changes the system (registry, services, power plans, boot settings, Windows features, Defender/firewall, environment variables, `C:\Windows` / hosts file; on Arch: sudo, pacman, systemctl, sysctl, `/etc`, bootloader…), Claude Code **asks you first**, even in auto-accept mode. The prompt says how many undo steps were recorded. Before asking, the widget saved the old values.

Suggested routine:

1. **Snapshot first:** shield → *Create snapshot…* → **Create snapshot** (approve the UAC prompt). That makes a Windows restore point; on Arch it uses Timeshift or Snapper (`sudo pacman -S timeshift`).
2. **Benchmark:** Workbench → **Monitor & snapshots** → label it "before", **Run benchmark** (about 10 s, close heavy apps first).
3. Ask Claude for the tweak, e.g. *"Switch to the High performance power plan and disable SysMain"*. Approve each system change when asked.
4. **Benchmark again** labelled "after". The table shows the change in % against the baseline (green better, red worse; under 3% is noise).
5. Didn't help? Workbench → **Changes & undo** → **Undo** on that change. It runs the recorded steps in a terminal window (as administrator when needed), newest first. **Copy undo script** gives you the commands instead. Changes with no automatic undo say so; use the snapshot.

| To… | Do this |
|---|---|
| Change how the safety net behaves | Shield menu → *Before system changes*: **Ask first** (default), **Only log them** (no prompt, undo still recorded), **Off**. Also in Settings → General. Restart a session (↻) to apply it there |
| Watch CPU, memory, GPU | The side panel shows CPU, temperature (when available), memory, GPU, VRAM and disk live; click it (or Workbench → **Monitor & snapshots**) for graphs, per-core load, VRAM, GPU power and disk space. For CPU temperature on Windows, run [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) |
| Run something as administrator | Shield → **Admin terminal (UAC)**: a red tab with an elevated PowerShell. **Claude as administrator** runs Claude itself elevated, with the safety net still on. On Arch the shield gives a `sudo -s` root shell |
| Find out what's going wrong | Workbench → **Logs**: errors (or warnings, or critical only) from the Event Log / journal for the last hour, day or week. Click a row to expand it. **Ask Claude** pastes it into the session as a question; review and press Enter. Tick *Follow* to refresh every 10 s |
| Find the backups | Workbench → Changes → **Backups folder** (`Projects\.claude\widget\changes`): the change log, exported registry keys and copies of system files |

### Shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Shift+G` | Workbench |
| `Ctrl+Shift+F` | Search the project |
| `Ctrl+PageUp` / `Ctrl+PageDown` | Previous / next terminal tab (in the focused zone) |
| `Ctrl+Shift+\` | Split into two zones / join them |
| `Ctrl+Shift+M` | Move the focused tab to the other zone |
| `Ctrl+Shift+E` | Files pane |
| `Ctrl+Shift+B` | Project list |
| `Ctrl+Shift+W` | Right panel |

## Status line (ccstatusline)

A bar at the bottom of Claude Code showing the model, git branch, and more.

- Configure widgets, colors, and layout (interactive TUI): `npx ccstatusline@latest`
- Its config file: `C:\Users\jacob\.config\ccstatusline\settings.json`
- To add usage/cost to the bar, add a **Custom Command** widget running `npx -y ccusage@latest statusline`. This may slow the bar down.

> Note: the Claude Desktop Widget wraps this command with its own `statusline-tee.js`. Leave that wrapper in place.

## Usage and cost reports (ccusage)

Run in any terminal:

| Command | Shows |
|---|---|
| `npx -y ccusage@latest daily` | Tokens and cost per day |
| `npx -y ccusage@latest monthly` | Per month |
| `npx -y ccusage@latest session` | Per conversation |
| `npx -y ccusage@latest blocks --live` | Live view of the current 5-hour billing block |

Add `--since 20261001` to filter by date, or `--json` for raw output.

## Windows toast notifications

The script `hooks\notify.ps1` runs from two hooks in `settings.json`:

- **Notification:** the toast says "Claude needs your input" when Claude is waiting on you (e.g. a permission prompt).
- **Stop:** the toast says "Claude finished" when Claude ends a reply.

To test, run in PowerShell:
```powershell
'{}' | powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\hooks\notify.ps1" -Event Stop
```
If toasts don't appear, check **Windows Settings → System → Notifications** (PowerShell must be allowed, and Do Not Disturb off). To silence the "finished" toast, delete the `notify.ps1` entry under `"Stop"` in `settings.json`.

## Plugins

Manage plugins with `/plugin` inside Claude Code, or with `claude plugin list | update | disable <name>` in a terminal.

### Context7: up-to-date library docs
Claude pulls current docs automatically when you ask about a library. To force it, add "use context7" to your prompt:
> How do I set up routing in Next.js 15? use context7

### Superpowers: structured dev workflow skills
These skills trigger automatically, or you can name them in your prompt:
- **brainstorming:** refines an idea into a design before coding
- **writing-plans / executing-plans:** step-by-step implementation plans
- **test-driven-development:** writes tests first
- **systematic-debugging:** root-cause debugging instead of guess-and-check
- **requesting-code-review:** reviews the work before you merge
- **verification-before-completion:** proves something works before calling it done

Example: *"Let's brainstorm a settings panel for the widget."*

### GitHub: repos, issues, PRs
Requires the `GITHUB_PERSONAL_ACCESS_TOKEN` user environment variable (already set). Restart Claude Code after changing the token.
> List my open PRs · Create an issue for the login bug · Review PR #12

## Custom slash command: `/commit`

File: `commands\commit.md`

1. Stage your changes: `git add …`
2. Type `/commit` in Claude Code. Optionally add extra instructions, e.g. `/commit and push`.

Claude reviews the staged diff, flags problems (secrets, debug leftovers), and commits with a Conventional Commits message like `fix(widget): handle empty usage data`.

## Custom skill: explain-file

File: `skills\explain-file\SKILL.md`

Ask naturally, e.g. *"explain src/main.js"* or *"what does this file do?"*. You get its purpose, key functions with line links, and gotchas, in about 15 lines.

## Adding your own

- **Slash command:** create `commands\<name>.md`. The file is the prompt and `$ARGUMENTS` holds whatever you type after the command. It becomes `/<name>`.
- **Skill:** create `skills\<name>\SKILL.md` with `name` and `description` frontmatter. Claude uses it when the description matches your request.

Restart Claude Code (or start a new session) to pick up new files.

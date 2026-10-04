# Claude Code customizations: usage guide

User-level setup in `C:\Users\jacob\.claude`. Applies to every project. Original settings backed up at `settings.json.bak`.

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

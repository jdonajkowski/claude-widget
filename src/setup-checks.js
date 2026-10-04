// First-run setup: the tools a widget session relies on, how to find them and how to install or sign in.
// Commands come only from this table; the settings page asks for them by id, never sends a command.

// Package managers by platform. Linux picks the first one present (Arch first: pacman).
const LINUX_PMS = [
  { id: 'pacman', bin: 'pacman', install: (pkgs) => `sudo pacman -S --needed ${pkgs.join(' ')}` },
  { id: 'apt', bin: 'apt-get', install: (pkgs) => `sudo apt-get install -y ${pkgs.join(' ')}` },
  { id: 'dnf', bin: 'dnf', install: (pkgs) => `sudo dnf install -y ${pkgs.join(' ')}` }
];

const TOOLS = [
  {
    id: 'claude',
    name: 'Claude Code',
    why: 'Runs in every widget session.',
    required: true,
    bins: { win: ['claude.exe', 'claude.cmd'], linux: ['claude'] },
    extraPaths: { win: ['.local/bin/claude.exe'], linux: ['.local/bin/claude'] },
    install: { win: 'irm https://claude.ai/install.ps1 | iex', linux: 'curl -fsSL https://claude.ai/install.sh | bash' }
  },
  {
    id: 'git',
    name: 'Git',
    why: 'Claude Code uses it for diffs, commits and branches.',
    required: true,
    bins: { win: ['git.exe'], linux: ['git'] },
    install: { win: 'winget install --id Git.Git -e --source winget', pkgs: { pacman: ['git'], apt: ['git'], dnf: ['git'] } }
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    why: 'Lets Claude open pull requests and read issues.',
    bins: { win: ['gh.exe'], linux: ['gh'] },
    install: { win: 'winget install --id GitHub.cli -e --source winget', pkgs: { pacman: ['github-cli'], apt: ['gh'], dnf: ['gh'] } }
  },
  {
    id: 'node',
    name: 'Node.js',
    why: 'Optional: npx tools such as ccstatusline and many MCP servers need it. The widget itself does not.',
    bins: { win: ['node.exe'], linux: ['node'] },
    install: { win: 'winget install --id OpenJS.NodeJS.LTS -e --source winget', pkgs: { pacman: ['nodejs', 'npm'], apt: ['nodejs', 'npm'], dnf: ['nodejs', 'npm'] } }
  },
  {
    id: 'code',
    name: 'VS Code',
    why: 'Optional: "Open in VS Code" in the files pane and editor.',
    bins: { win: ['code.cmd', 'code'], linux: ['code', 'codium'] },
    install: { win: 'winget install --id Microsoft.VisualStudioCode -e --source winget', pkgs: { pacman: ['code'], dnf: ['code'] } }
  }
];

// Sign-in steps that run in a terminal (interactive prompts and browser logins).
const SIGN_IN = {
  claude: { win: 'claude', linux: 'claude' }, // first run asks to sign in; /login switches accounts
  gh: { win: 'gh auth login', linux: 'gh auth login' }
};

const plat = (isWin) => (isWin ? 'win' : 'linux');

function installCommand(tool, { isWin, pm }) {
  if (isWin) return tool.install.win || null;
  if (tool.install.linux) return tool.install.linux;
  const pkgs = tool.install.pkgs && pm && tool.install.pkgs[pm.id];
  return pkgs ? pm.install(pkgs) : null;
}

const signInCommand = (id, isWin) => (SIGN_IN[id] ? SIGN_IN[id][plat(isWin)] : null);

// git config values are free text; keep them on one line and reasonably short.
function cleanIdentity(value) {
  return String(value || '').replace(/[\r\n\0]/g, ' ').trim().slice(0, 200);
}

const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+$/.test(v);

module.exports = { LINUX_PMS, TOOLS, installCommand, signInCommand, cleanIdentity, looksLikeEmail, plat };

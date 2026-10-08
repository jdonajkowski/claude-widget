// Linux has no login-item API in Electron, so "Start Gremlin when I sign in" writes (or removes) a freedesktop
// autostart entry. Plain CommonJS so tests can load it.
const path = require('path');

const FILE = 'gremlin-desk.desktop';

const entryPath = (home, env = {}) => path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', FILE);

// Exec values are quoted so a path with spaces survives; backslashes and quotes are escaped as the spec asks.
const quote = (s) => `"${String(s).replace(/(["`$\\])/g, '\\$1')}"`;

// exec: the AppImage when running from one (process.env.APPIMAGE), else the installed binary.
function desktopEntry(exec) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Gremlin',
    'Comment=Desktop workspace for Claude Code sessions',
    `Exec=${quote(exec)}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n');
}

module.exports = { FILE, entryPath, desktopEntry };

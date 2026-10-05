// Built-in browser: turns what was typed in its address bar into a URL it may load.
// Only http, https and file URLs load; anything else (javascript:, data:, ...) is refused.
const path = require('path');
const { pathToFileURL } = require('url');

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

function toUrl(input, { home = '', isWin = process.platform === 'win32' } = {}) {
  let t = String(input || '').trim();
  if (!t) return null;
  if (/^(https?|file):/i.test(t)) return allowed(t);
  if (/^[a-z][\w+.-]*:\/\//i.test(t)) return null; // some other scheme
  // Local paths: C:\..., \\server\share, /..., ~/...
  if (t.startsWith('~') && home) t = path.join(home, t.slice(1));
  if ((isWin && (/^[a-z]:[\\/]/i.test(t) || t.startsWith('\\\\'))) || (!isWin && t.startsWith('/'))) {
    return pathToFileURL(t).href;
  }
  if (/^[a-z]+:/i.test(t) && !/^[\w.-]+:\d+/.test(t)) return null; // javascript:, mailto:, ...
  if (LOCAL_HOST.test(t)) return `http://${t}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(t)) return `https://${t}`;
  if (/^[\w-]+:\d+(\/|$)/.test(t)) return `http://${t}`; // host:port on the LAN
  return null;
}

function allowed(u) {
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:' || p === 'file:' ? new URL(u).href : null;
  } catch {
    return null;
  }
}

// Links Claude prints to a local dev server open in the built-in browser; the rest go to the default browser.
const isLocalUrl = (u) => {
  try {
    const { protocol, hostname } = new URL(u);
    return (protocol === 'http:' || protocol === 'https:') && /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i.test(hostname);
  } catch {
    return false;
  }
};

// What `widget-open <target>` (bin/) asked for: --open=<target> in a second instance's argv (one token,
// since Chromium reorders switches and their separate values). URLs pass through; a relative file path is
// taken from the folder the command ran in.
function openTarget(argv, cwd) {
  const arg = (argv || []).find((a) => String(a).startsWith('--open='));
  const t = arg ? String(arg).slice('--open='.length).trim() : '';
  if (!t) return null;
  if (/^[a-z][\w+.-]*:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) return t; // a URL or host:port (but not C:\...)
  if (LOCAL_HOST.test(t)) return t;
  return cwd ? path.resolve(cwd, t) : t;
}

// env with dir put first on PATH, keeping the variable's own spelling (Windows has "Path").
function prependPath(env, dir, isWin = process.platform === 'win32') {
  const key = Object.keys(env).find((k) => (isWin ? k.toUpperCase() === 'PATH' : k === 'PATH')) || 'PATH';
  return { [key]: env[key] ? `${dir}${isWin ? ';' : ':'}${env[key]}` : dir };
}

module.exports = { toUrl, isLocalUrl, openTarget, prependPath };

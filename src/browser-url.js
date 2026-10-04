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

module.exports = { toUrl, isLocalUrl };

// gremlin-browser: drives Gremlin's built-in browser from a Gremlin session (see src/browser-control.js).
// Runs on Node or Gremlin's own runtime (ELECTRON_RUN_AS_NODE); the sh/.cmd/.ps1 wrappers pick one.
const fs = require('fs');
const http = require('http');

const HELP = `gremlin-browser <command> [arguments]   Drives Gremlin's built-in browser.

  open <file-or-url>             Load a page and wait for it (relative paths are fine)
  status                         URL, title, viewport
  reload | back
  viewport <full|desktop|laptop|tablet|mobile>
  screenshot [--out f.png] [--full] [--selector css]
                                 Save a PNG and print its path (read it to see the page)
  text [css] | html [css]        Visible text / HTML of the page or one element
  click <css>                    Real mouse click on the element
  type <css> <text>              Replace the field's value with text
  press <key>                    Enter, Tab, Escape, ArrowDown, a, ...
  wait <css> [--timeout s]       Wait until an element exists (default 10 s)
  eval <js> | eval --file f.js | eval -
                                 Run JavaScript in the page and print the result (await works)
  console [--errors] [--clear]   Console messages and uncaught errors since the page opened
  network [--failed] [--clear]   Requests with status
  cdp <Domain.method> [json | - | --file f.json]
                                 Any Chrome DevTools Protocol command on the page,
                                 e.g. cdp Emulation.setEmulatedMedia '{"media":"print"}'

  Windows PowerShell 5.1 drops double quotes inside arguments: pipe JSON or JavaScript in with -,
  e.g. '{"media":"print"}' | gremlin-browser cdp Emulation.setEmulatedMedia -`;

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m) { pos.push(a); continue; }
    if (m[2] !== undefined) flags[m[1]] = m[2];
    else if (['out', 'selector', 'timeout', 'file'].includes(m[1]) && i + 1 < argv.length) flags[m[1]] = argv[++i];
    else flags[m[1]] = true;
  }
  return { cmd: pos.shift(), pos, flags };
}

// Request body for a command, from its arguments.
function body(cmd, pos, flags, { cwd, readFile, readStdin }) {
  switch (cmd) {
    case 'open': return { target: pos.join(' '), cwd };
    case 'viewport': return { name: pos[0] };
    case 'screenshot': return { out: flags.out, full: !!flags.full, selector: flags.selector, cwd };
    case 'text': case 'html': case 'click': case 'wait': return { selector: pos.join(' ') || flags.selector, timeout: flags.timeout };
    case 'type': return { selector: pos[0], text: pos.slice(1).join(' ') };
    case 'press': return { key: pos[0] };
    case 'console': return { errors: !!flags.errors, clear: !!flags.clear };
    case 'network': return { failed: !!flags.failed, clear: !!flags.clear };
    case 'eval': return { js: flags.file ? readFile(flags.file) : pos[0] === '-' ? readStdin() : pos.join(' ') };
    case 'cdp': {
      let params = {};
      const raw = pos[1] === '-' ? readStdin() : flags.file ? readFile(flags.file) : pos.slice(1).join(' ');
      if (raw.trim()) {
        try { params = JSON.parse(raw); } catch { throw new Error('cdp params must be JSON, e.g. \'{"media":"print"}\' (in PowerShell 5.1 pipe it in: \'{"media":"print"}\' | gremlin-browser cdp Emulation.setEmulatedMedia -)'); }
      }
      return { method: pos[0], params };
    }
    default: return {};
  }
}

function format(cmd, r) {
  if (r.error) return null;
  if (cmd === 'text') return r.text;
  if (cmd === 'html') return r.html;
  if (cmd === 'screenshot') return r.file;
  if (cmd === 'console') return r.entries.length ? r.entries.join('\n') : '(no console messages)';
  if (cmd === 'network') return r.requests.length ? r.requests.join('\n') : '(no requests)';
  if (cmd === 'eval') return typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2) ?? 'undefined';
  if (cmd === 'cdp') return JSON.stringify(r.result, null, 2);
  return JSON.stringify(r, null, 2);
}

function post(base, token, cmd, payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const req = http.request(`${base}/${encodeURIComponent(cmd)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: `Bearer ${token}` }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (raw += d));
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error(`Bad answer (${res.statusCode})`)); } });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Timed out after 60 s')));
    req.end(data);
  });
}

async function main(argv) {
  const { cmd, pos, flags } = parse(argv);
  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return 0; }
  const base = process.env.GREMLIN_BROWSER;
  const token = process.env.GREMLIN_BROWSER_TOKEN;
  if (!base || !token) {
    console.error('gremlin-browser: only works in sessions and tabs started by Gremlin (with "Let Claude drive the built-in browser" on in Settings).');
    return 1;
  }
  const payload = body(cmd, pos, flags, {
    cwd: process.cwd(),
    readFile: (f) => fs.readFileSync(f, 'utf8'),
    readStdin: () => fs.readFileSync(0, 'utf8')
  });
  const r = await post(base, token, cmd, payload);
  if (r.error) { console.error(`gremlin-browser: ${r.error}`); return 1; }
  console.log(format(cmd, r));
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.error(`gremlin-browser: ${err.code === 'ECONNREFUSED' ? 'Gremlin is not running (restart this session after starting it)' : err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parse, body, format };

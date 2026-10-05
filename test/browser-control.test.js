const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createControl, authorized, cdpAllowed, createPageLog } = require('../src/browser-control');
const cli = require('../bin/widget-browser.js');

const req = (headers) => ({ headers });

test('only token-bearing loopback requests without an Origin are authorized', () => {
  const ok = { host: '127.0.0.1:5000', authorization: 'Bearer abc' };
  assert.equal(authorized(req(ok), 'abc'), true);
  assert.equal(authorized(req({ ...ok, authorization: 'Bearer abd' }), 'abc'), false);
  assert.equal(authorized(req({ ...ok, authorization: undefined }), 'abc'), false);
  assert.equal(authorized(req({ ...ok, origin: 'https://evil.example' }), 'abc'), false);
  assert.equal(authorized(req({ ...ok, host: 'evil.example:5000' }), 'abc'), false);
});

test('raw CDP is limited to the page\'s own domains', () => {
  for (const m of ['Page.captureScreenshot', 'Runtime.evaluate', 'Emulation.setDeviceMetricsOverride', 'Network.getResponseBody']) assert.equal(cdpAllowed(m), true, m);
  for (const m of ['Target.attachToTarget', 'Browser.close', 'SystemInfo.getInfo', 'Page', 'Page.x.y', 42]) assert.equal(cdpAllowed(m), false, String(m));
});

test('the page log keeps console messages, uncaught errors and requests', () => {
  const log = createPageLog();
  log.onConsole('warning', 'careful', 'a.js:3');
  log.onConsole('error', 'Uncaught TypeError: x', 'b.js:10');
  log.onConsole('warning', '%cElectron Security Warning (Insecure Content-Security-Policy)', '');
  log.onCdp('Network.requestWillBeSent', { requestId: '1', request: { method: 'GET', url: 'http://x/a' }, type: 'Fetch' });
  log.onCdp('Network.responseReceived', { requestId: '1', response: { status: 404, mimeType: 'text/html' } });
  assert.deepEqual(log.console.map((e) => [e.level, e.message, e.source]), [['warning', 'careful', 'a.js:3'], ['error', 'Uncaught TypeError: x', 'b.js:10']]);
  assert.equal(log.network.get('1').status, 404);
});

// A browser with a fake page whose debugger answers a few CDP calls.
function fakeBrowser() {
  const wc = new EventEmitter();
  const sent = [];
  let attached = false;
  wc.debugger = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: () => { attached = true; },
    sendCommand: async (method, params) => {
      sent.push([method, params]);
      if (method === 'Runtime.evaluate') return { result: { value: params.expression.startsWith('(') ? 'from-page' : 6 } };
      if (method === 'Page.captureScreenshot') return { data: Buffer.from('png').toString('base64') };
      return {};
    }
  });
  wc.getURL = () => 'http://localhost:5173/';
  wc.getTitle = () => 'App';
  wc.isLoading = () => false;
  const listeners = [];
  return {
    wc,
    sent,
    onPage: (fn) => listeners.push(fn),
    page: () => wc,
    load: async (target) => ({ url: target, title: 'App' }),
    setDevice: (n) => n === 'mobile',
    device: () => 'full',
    fire: () => listeners.forEach((fn) => fn(wc))
  };
}

test('commands run on the page through the debugger', async () => {
  const b = fakeBrowser();
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'));
  const c = createControl({ browser: b, token: 't', shotsDir: shots });
  b.fire();
  assert.deepEqual(await c.run('eval', { js: '1+5' }), { value: 6 });
  assert.deepEqual(await c.run('open', { target: 'mock/index.html', cwd: '/p' }), { url: path.resolve('/p', 'mock/index.html'), title: 'App' });
  assert.deepEqual(await c.run('open', { target: 'http://localhost:3000', cwd: '/p' }), { url: 'http://localhost:3000', title: 'App' });
  const { file } = await c.run('screenshot', {});
  assert.equal(fs.readFileSync(file, 'utf8'), 'png');
  await assert.rejects(c.run('cdp', { method: 'Target.getTargets' }), /Not allowed/);
  await c.run('cdp', { method: 'Emulation.setEmulatedMedia', params: { media: 'print' } });
  assert.deepEqual(b.sent.at(-1), ['Emulation.setEmulatedMedia', { media: 'print' }]);
  await assert.rejects(c.run('viewport', { name: 'huge' }), /Viewport/);
  await assert.rejects(c.run('nope', {}), /Unknown command/);
  await assert.rejects(c.run('__proto__', {}), /Unknown command/);
  fs.rmSync(shots, { recursive: true, force: true });
});

test('the HTTP endpoint refuses requests without the token', async () => {
  const c = createControl({ browser: fakeBrowser(), token: 'secret' });
  const port = await c.start();
  const call = (headers) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/status', method: 'POST', headers }, (res) => { let d = ''; res.on('data', (x) => (d += x)); res.on('end', () => resolve([res.statusCode, JSON.parse(d)])); });
    r.end('{}');
  });
  assert.deepEqual(await call({}), [403, { error: 'Forbidden' }]);
  const [code, body] = await call({ Authorization: 'Bearer secret' });
  assert.equal(code, 200);
  assert.equal(body.url, 'http://localhost:5173/');
  c.stop();
});

test('widget-browser parses its arguments', () => {
  const ctx = { cwd: '/p', readFile: () => 'FILE', readStdin: () => 'STDIN' };
  const b = (argv) => { const p = cli.parse(argv); return [p.cmd, cli.body(p.cmd, p.pos, p.flags, ctx)]; };
  assert.deepEqual(b(['open', 'mock/a b.html']), ['open', { target: 'mock/a b.html', cwd: '/p' }]);
  assert.deepEqual(b(['screenshot', '--full', '--out', 'x.png']), ['screenshot', { out: 'x.png', full: true, selector: undefined, cwd: '/p' }]);
  assert.deepEqual(b(['type', '#name', 'Ada', 'Lovelace']), ['type', { selector: '#name', text: 'Ada Lovelace' }]);
  assert.deepEqual(b(['eval', '--file', 'x.js']), ['eval', { js: 'FILE' }]);
  assert.deepEqual(b(['eval', '-']), ['eval', { js: 'STDIN' }]);
  assert.deepEqual(b(['cdp', 'Page.reload', '{"ignoreCache":true}']), ['cdp', { method: 'Page.reload', params: { ignoreCache: true } }]);
  assert.throws(() => b(['cdp', 'Page.reload', '{bad']), /JSON/);
  const piped = { ...ctx, readStdin: () => '{"media":"print"}' };
  const p = cli.parse(['cdp', 'Emulation.setEmulatedMedia', '-']);
  assert.deepEqual(cli.body(p.cmd, p.pos, p.flags, piped), { method: 'Emulation.setEmulatedMedia', params: { media: 'print' } });
  assert.deepEqual(b(['cdp', 'Performance.getMetrics']), ['cdp', { method: 'Performance.getMetrics', params: {} }]);
  assert.equal(cli.format('console', { entries: [] }), '(no console messages)');
  assert.equal(cli.format('eval', { value: { a: 1 } }), '{\n  "a": 1\n}');
});

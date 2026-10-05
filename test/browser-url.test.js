const test = require('node:test');
const assert = require('node:assert/strict');
const { toUrl, isLocalUrl } = require('../src/browser-url');

const win = { isWin: true, home: 'C:\\Users\\me' };

test('keeps http, https and file URLs', () => {
  assert.equal(toUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(toUrl('HTTP://localhost:3000'), 'http://localhost:3000/');
  assert.equal(toUrl('file:///C:/x/index.html'), 'file:///C:/x/index.html');
});

test('refuses other schemes', () => {
  assert.equal(toUrl('javascript:alert(1)'), null);
  assert.equal(toUrl('data:text/html,hi'), null);
  assert.equal(toUrl('ftp://host/x'), null);
  assert.equal(toUrl(''), null);
});

test('adds http to local servers and https to domains', () => {
  assert.equal(toUrl('localhost:5173'), 'http://localhost:5173');
  assert.equal(toUrl('127.0.0.1:8080/app'), 'http://127.0.0.1:8080/app');
  assert.equal(toUrl('example.com'), 'https://example.com');
  assert.equal(toUrl('devbox:3000'), 'http://devbox:3000');
});

test('turns Windows paths into file URLs', () => {
  assert.equal(toUrl('C:\\Users\\me\\mock up\\index.html', win), 'file:///C:/Users/me/mock%20up/index.html');
  assert.equal(toUrl('~\\site\\a.html', win), 'file:///C:/Users/me/site/a.html');
});

test('isLocalUrl spots dev servers', () => {
  assert.equal(isLocalUrl('http://localhost:3000/x'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:8000'), true);
  assert.equal(isLocalUrl('https://example.com'), false);
  assert.equal(isLocalUrl('not a url'), false);
});

test('openTarget reads --open from a second instance argv', () => {
  const { openTarget } = require('../src/browser-url');
  const exe = ['/opt/w/claude-widget', '--allow-file-access'];
  assert.equal(openTarget([...exe, '--open=http://localhost:5173/?a=b'], '/p'), 'http://localhost:5173/?a=b');
  assert.equal(openTarget(['--open=localhost:3000', ...exe], '/p'), 'localhost:3000');
  assert.equal(openTarget([...exe, '--open=mock/index.html'], '/p'), require('path').resolve('/p', 'mock/index.html'));
  assert.equal(openTarget(['/opt/w/claude-widget'], '/p'), null);
  assert.equal(openTarget([...exe, '--open='], '/p'), null);
});

test('prependPath keeps the PATH variable spelling', () => {
  const { prependPath } = require('../src/browser-url');
  assert.deepEqual(prependPath({ Path: 'C:/x' }, 'C:/bin', true), { Path: 'C:/bin;C:/x' });
  assert.deepEqual(prependPath({ PATH: '/usr/bin' }, '/b', false), { PATH: '/b:/usr/bin' });
  assert.deepEqual(prependPath({}, '/b', false), { PATH: '/b' });
});

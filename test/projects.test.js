const test = require('node:test');
const assert = require('node:assert/strict');
const { normId, initials, buildList } = require('../src/projects');

const yes = () => true;

test('normId resolves and lowercases on Windows only', () => {
  assert.equal(normId('C:\\Users\\Me\\Projects\\Foo\\', true), 'c:\\users\\me\\projects\\foo');
  assert.equal(normId('/home/Me/Foo/', false), '/home/Me/Foo');
});

test('initials', () => {
  assert.equal(initials('Claude Widget'), 'CW');
  assert.equal(initials('api-server'), 'AS');
  assert.equal(initials('my_tool.v2'), 'MT');
  assert.equal(initials('myProject'), 'MP');
  assert.equal(initials('notes'), 'NO');
  assert.equal(initials('x'), 'X');
  assert.equal(initials('--'), '?');
});

test('scanned folders sorted case-insensitively, ties by path', () => {
  const list = buildList({ scanned: ['C:\\p\\beta', 'C:\\p\\Alpha', 'C:\\p\\gamma'], pinned: ['D:\\x\\alpha'], hidden: [], exists: yes, isWin: true });
  assert.deepEqual(list.map((p) => p.path), ['C:\\p\\Alpha', 'D:\\x\\alpha', 'C:\\p\\beta', 'C:\\p\\gamma']);
  assert.equal(list[1].pinned, true);
  assert.equal(list[0].pinned, false);
  assert.equal(list[0].name, 'Alpha');
  assert.equal(list[0].id, 'c:\\p\\alpha');
});

test('hidden removes scanned projects but never pinned ones', () => {
  const list = buildList({ scanned: ['C:\\p\\a', 'C:\\p\\b'], pinned: ['D:\\c'], hidden: ['c:\\p\\a', 'd:\\c'], exists: yes, isWin: true });
  assert.deepEqual(list.map((p) => p.name), ['b', 'c']);
});

test('a pinned path that is also scanned appears once, as a scanned row', () => {
  const list = buildList({ scanned: ['C:\\p\\Foo'], pinned: ['c:\\P\\foo\\'], hidden: [], exists: yes, isWin: true });
  assert.equal(list.length, 1);
  assert.equal(list[0].pinned, false);
});

test('duplicate pinned entries collapse; missing pinned folders are flagged', () => {
  const list = buildList({ scanned: [], pinned: ['D:\\gone', 'd:\\GONE', 'D:\\here'], hidden: [], exists: (p) => !/gone/i.test(p), isWin: true });
  assert.deepEqual(list.map((p) => [p.name, p.missing]), [['gone', true], ['here', false]]);
});

test('garbage input does not throw', () => {
  assert.deepEqual(buildList({ scanned: null, pinned: [null, 3, ''], hidden: 'x', exists: yes, isWin: true }), []);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../src/zones');

const tabs = ['p', 'aux:1', 'aux:2'];

test('one zone until a tab is moved to the bottom', () => {
  const st = Z.initial();
  assert.deepEqual(Z.layout(st, tabs), { split: false, zones: [tabs, []], front: ['p', null], focus: 0, focused: 'p' });
  const s2 = Z.moveTo(st, tabs, 'aux:1', 1);
  assert.deepEqual(Z.layout(s2, tabs), { split: true, zones: [['p', 'aux:2'], ['aux:1']], front: ['p', 'aux:1'], focus: 1, focused: 'aux:1' });
});

test('show focuses the zone of the tab', () => {
  let st = Z.moveTo(Z.initial(), tabs, 'aux:1', 1);
  st = Z.show(st, tabs, 'aux:2');
  assert.deepEqual(Z.layout(st, tabs).front, ['aux:2', 'aux:1']);
  assert.equal(Z.layout(st, tabs).focused, 'aux:2');
  st = Z.show(st, tabs, 'aux:1');
  assert.equal(Z.layout(st, tabs).focused, 'aux:1');
});

test('moving the last tab out of a zone, or closing it, merges the zones', () => {
  let st = Z.moveTo(Z.initial(), tabs, 'aux:1', 1);
  st = Z.moveTo(st, tabs, 'aux:1', 0);
  assert.equal(Z.layout(st, tabs).split, false);
  assert.equal(Z.layout(st, tabs).focused, 'aux:1');
  st = Z.moveTo(Z.initial(), tabs, 'aux:1', 1);
  const closed = ['p', 'aux:2'];
  assert.deepEqual(Z.layout(st, closed), { split: false, zones: [closed, []], front: ['p', null], focus: 0, focused: 'p' });
});

test('the Claude session can move to the bottom too', () => {
  const st = Z.moveTo(Z.initial(), tabs, 'p', 1);
  assert.deepEqual(Z.layout(st, tabs).zones, [['aux:1', 'aux:2'], ['p']]);
  assert.equal(Z.layout(st, tabs).front[0], 'aux:1');
});

test('splitCandidate picks the focused tab, else the newest, else none', () => {
  assert.equal(Z.splitCandidate(Z.show(Z.initial(), tabs, 'aux:1'), tabs), 'aux:1');
  assert.equal(Z.splitCandidate(Z.initial(), tabs), 'aux:2');
  assert.equal(Z.splitCandidate(Z.initial(), ['p']), null);
});

test('unsplit keeps the focused tab in front', () => {
  const st = Z.unsplit(Z.moveTo(Z.initial(), tabs, 'aux:1', 1), tabs);
  assert.deepEqual(Z.layout(st, tabs).front, ['aux:1', null]);
  assert.equal(Z.layout(st, tabs).split, false);
});

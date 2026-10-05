const test = require('node:test');
const assert = require('node:assert/strict');
const { applyTool, running, mood } = require('../src/mascot-state');

const feed = (events) => events.reduce(applyTool, new Map());

test('tool calls count as running from start to end', () => {
  const tools = feed([{ t: 'tool', phase: 'start', id: 'a' }, { t: 'tool', phase: 'start', id: 'b' }, { t: 'tool', phase: 'end', id: 'a' }]);
  assert.equal(running(tools), 1);
  assert.equal(running(applyTool(tools, { t: 'tool', phase: 'end', id: 'b' })), 0);
});

test('an end logged before its start cancels it out', () => {
  const tools = feed([{ t: 'tool', phase: 'end', id: 'a' }, { t: 'tool', phase: 'start', id: 'a' }]);
  assert.equal(running(tools), 0);
  assert.equal(tools.size, 0);
});

test('other events and garbage leave the map alone', () => {
  const tools = feed([{ t: 'tool', phase: 'start', id: 'a' }]);
  for (const ev of [null, 'x', { t: 'start', id: 'b' }, { t: 'tool', phase: 'start' }]) assert.equal(applyTool(tools, ev), tools);
});

test('mood: a question wins, then working, thinking, idle', () => {
  assert.equal(mood({ question: true, turn: true, tools: 2, agents: 0 }), 'question');
  assert.equal(mood({ question: false, turn: true, tools: 1, agents: 0 }), 'working');
  assert.equal(mood({ question: false, turn: true, tools: 0, agents: 1 }), 'working');
  assert.equal(mood({ question: false, turn: true, tools: 0, agents: 0 }), 'thinking');
  assert.equal(mood({ question: false, turn: false, tools: 3, agents: 0 }), 'idle');
});

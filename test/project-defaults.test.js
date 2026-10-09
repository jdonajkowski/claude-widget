const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/project-defaults');

test('parseText reads model, permission and env lines; comments and blanks are ignored', () => {
  const r = D.parseText('# note\n\nmodel: opus\npermission: plan\nenv: NODE_ENV=development\nenv: A=b=c');
  assert.deepEqual(r.defaults, { model: 'opus', permission: 'plan', env: { NODE_ENV: 'development', A: 'b=c' } });
});

test('parseText names the line that is wrong', () => {
  assert.match(D.parseText('colour: red').error, /Line 1/);
  assert.match(D.parseText('model: opus\npermission: yolo').error, /Line 2/);
  assert.match(D.parseText('env: 1BAD=x').error, /Line 1/);
  assert.match(D.parseText('env: GREMLIN_STATUS=x').error, /Line 1/);
  assert.match(D.parseText('model: a b; rm').error, /Line 1/);
});

test('formatText and parseText round-trip; an empty project shows the hint as comments', () => {
  const d = { model: 'sonnet', permission: 'acceptEdits', env: { X: '1' } };
  assert.deepEqual(D.parseText(D.formatText(d)).defaults, d);
  assert.deepEqual(D.parseText(D.formatText(null)).defaults, { model: '', permission: '', env: {} });
});

test('flags builds the claude arguments, only from valid values', () => {
  assert.equal(D.flags({ model: 'opus', permission: 'plan' }), " --model 'opus' --permission-mode 'plan'");
  assert.equal(D.flags({ model: "x'; echo", permission: 'nope' }), '');
  assert.equal(D.flags(undefined), '');
});

test('normalize drops bad fields; isEmpty', () => {
  assert.deepEqual(D.normalize({ model: 5, permission: 'plan', env: { OK: 'v', 'bad key': 'v', N: 3 } }), { model: '', permission: 'plan', env: { OK: 'v' } });
  assert.ok(D.isEmpty({ model: '', permission: '', env: {} }));
  assert.ok(!D.isEmpty({ model: 'opus' }));
});

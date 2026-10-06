const test = require('node:test');
const assert = require('node:assert/strict');
const { initial, advance, canDeploy, stepMarch } = require('../src/guard-routine');

// A small seeded generator so runs are reproducible.
const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const run = (n, rand) => {
  let state = initial(rand);
  const steps = [];
  for (let i = 0; i < n; i++) { const out = advance(state, rand); steps.push(out.step); state = out.state; }
  return steps;
};
const zero = () => 0;

test('it opens with the climb, the spear pull and a stand, in that order', () => {
  const poses = run(6, zero).map((s) => [s.type, s.pose, s.ms]);
  assert.deepEqual(poses, [
    ['pose', 'climb_out_1', 700], ['pose', 'climb_out_2', 800],
    ['pose', 'pull_1', 1100], ['pose', 'pull_2', 1100], ['pose', 'pull_3', 1300],
    ['pose', 'stand', 1500]
  ]);
});

test('after the opening it marches in legs of 20 to 40 seconds', () => {
  for (const s of run(60, seeded(7)).slice(6).filter((x) => x.type === 'march')) {
    assert.ok(s.ms >= 20000 && s.ms <= 40000, `leg ${s.ms}`);
  }
});

test('a break comes only once its interval has passed, then a stand, then marching again', () => {
  // rand 0 means the first break is due after 45 s of marching and legs are 20 s: three legs, then the break.
  const after = run(13, zero).slice(6);
  assert.deepEqual(after.map((s) => s.type), ['march', 'march', 'march', 'break', 'pose', 'march', 'march']);
  assert.equal(after[3].pose, 'chew');
  assert.equal(after[3].ms, 6000);
  assert.deepEqual([after[4].pose, after[4].ms], ['stand', 600]);
});

test('breaks are chew or type, 6 to 12 seconds, and never the same twice in a row (200 breaks)', () => {
  const breaks = run(3000, seeded(11)).filter((s) => s.type === 'break');
  assert.ok(breaks.length >= 200, `only ${breaks.length} breaks`);
  for (let i = 0; i < breaks.length; i++) {
    assert.ok(['chew', 'type'].includes(breaks[i].pose));
    assert.ok(breaks[i].ms >= 6000 && breaks[i].ms <= 12000, `break ${breaks[i].ms}`);
    if (i > 0) assert.notEqual(breaks[i].pose, breaks[i - 1].pose);
  }
});

test('breaks come every 45 to 90 seconds of marching, so about one a minute', () => {
  const steps = run(3000, seeded(5));
  let march = 0;
  const gaps = [];
  for (const s of steps.slice(6)) {
    if (s.type === 'march') march += s.ms;
    if (s.type === 'break') { gaps.push(march); march = 0; }
  }
  assert.ok(gaps.length > 100);
  for (const g of gaps) assert.ok(g >= 45000 && g < 90000 + 40000, `gap ${g}`); // a leg can overshoot the interval by up to one leg
});

test('advance leaves its input state untouched and gives the same result for the same randomness', () => {
  const state = initial(seeded(3));
  const frozen = JSON.stringify(state);
  Object.freeze(state); Object.freeze(state.pending);
  const a = advance(state, seeded(9));
  const b = advance(state, seeded(9));
  assert.equal(JSON.stringify(state), frozen);
  assert.deepEqual(a, b);
});

const idle = { guarding: false, deploying: false, guardMs: 300000, lastActive: 0, now: 300000, mood: 'idle', hidden: false, modalOpen: false };

test('canDeploy: only when idle long enough and nothing blocks it', () => {
  assert.equal(canDeploy(idle), true);
  assert.equal(canDeploy({ ...idle, now: 299999 }), false, 'not idle long enough');
  assert.equal(canDeploy({ ...idle, lastActive: 100000 }), false, 'activity during the wait (e.g. while poses load)');
  assert.equal(canDeploy({ ...idle, guarding: true }), false);
  assert.equal(canDeploy({ ...idle, deploying: true }), false);
  assert.equal(canDeploy({ ...idle, guardMs: 0 }), false, '0 minutes turns guarding off');
  assert.equal(canDeploy({ ...idle, mood: 'working' }), false);
  assert.equal(canDeploy({ ...idle, hidden: true }), false);
  assert.equal(canDeploy({ ...idle, modalOpen: true }), false);
});

test('stepMarch walks at 70 px/s and turns at both ends', () => {
  const base = { dtMs: 1000, w: 100, boxW: 800 };
  assert.deepEqual(stepMarch({ ...base, cx: 400, dir: 1 }), { cx: 470, dir: 1, turned: false, blocked: false });
  assert.deepEqual(stepMarch({ ...base, cx: 400, dir: -1 }), { cx: 330, dir: -1, turned: false, blocked: false });
  const right = stepMarch({ ...base, cx: 720, dir: 1 }); // right limit is 800 - 16 - 50 = 734
  assert.deepEqual(right, { cx: 734, dir: -1, turned: true, blocked: false });
  const left = stepMarch({ ...base, cx: 80, dir: -1 }); // left limit is 16 + 50 = 66
  assert.deepEqual(left, { cx: 66, dir: 1, turned: true, blocked: false });
});

test('stepMarch clamps a start position that is out of range', () => {
  const r = stepMarch({ cx: 5000, dir: 1, dtMs: 16, w: 100, boxW: 800 });
  assert.equal(r.cx, 734);
  assert.equal(r.dir, -1);
  assert.equal(stepMarch({ cx: -50, dir: -1, dtMs: 16, w: 100, boxW: 800 }).cx, 66);
});

test('stepMarch reports blocked when the box is too narrow to walk', () => {
  const r = stepMarch({ cx: 100, dir: 1, dtMs: 1000, w: 100, boxW: 160 });
  assert.equal(r.blocked, true);
  assert.equal(r.cx, 80, 'stands in the middle');
  assert.equal(r.dir, 1, 'direction unchanged');
});

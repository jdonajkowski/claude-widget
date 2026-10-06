// What Glitch does while guarding, as plain data: climb out, pull the spear up from below the window edge,
// stand, then march in legs of 20 to 40 s with a break (chew a cable or type) every 45 to 90 s of marching.
// Pure: no DOM, no timers; randomness is passed in. The DOM side is renderer/guard-actor.js.
// Loaded by the renderer as a plain <script> (window.WidgetGuardRoutine) and by tests via require.
(function (root) {
  const OPENING = [
    { pose: 'climb_out_1', ms: 700 }, { pose: 'climb_out_2', ms: 800 },
    { pose: 'pull_1', ms: 1100 }, { pose: 'pull_2', ms: 1100 }, { pose: 'pull_3', ms: 1300 },
    { pose: 'stand', ms: 1500 }
  ];
  const BREAKS = ['chew', 'type'];
  const between = (rand, min, max) => Math.round(min + rand() * (max - min));

  function initial(rand) {
    return { phase: 'opening', index: 0, sinceBreak: 0, breakDue: between(rand, 45000, 90000), lastBreak: null, pending: [] };
  }

  // The next step and the state after it. The state is never mutated.
  function advance(state, rand) {
    if (state.phase === 'opening') {
      const o = OPENING[state.index];
      const done = state.index + 1 >= OPENING.length;
      return { step: { type: 'pose', pose: o.pose, ms: o.ms }, state: { ...state, index: state.index + 1, phase: done ? 'patrol' : 'opening' } };
    }
    if (state.pending.length) {
      const [step, ...rest] = state.pending;
      return { step, state: { ...state, pending: rest } };
    }
    if (state.sinceBreak >= state.breakDue) {
      const choices = BREAKS.filter((p) => p !== state.lastBreak);
      const pose = choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))];
      return {
        step: { type: 'break', pose, ms: between(rand, 6000, 12000) },
        state: { ...state, lastBreak: pose, sinceBreak: 0, breakDue: between(rand, 45000, 90000), pending: [{ type: 'pose', pose: 'stand', ms: 600 }] }
      };
    }
    const ms = between(rand, 20000, 40000);
    return { step: { type: 'march', ms }, state: { ...state, sinceBreak: state.sinceBreak + ms } };
  }

  // Whether Glitch should climb out now: idle for guardMs with Claude idle, nothing else going on.
  function canDeploy({ guarding, deploying, guardMs, lastActive, now, mood, hidden, modalOpen }) {
    return !guarding && !deploying && guardMs > 0 && mood === 'idle' && !hidden && !modalOpen && now - lastActive >= guardMs;
  }

  // One frame of walking along a box boxW wide: the figure is w wide and cx is its centre. Turns at the ends
  // (16 px margin) and clamps a position outside them. blocked: the box is too narrow to walk, so he stands in the middle.
  function stepMarch({ cx, dir, dtMs, w, boxW, speed = 70, margin = 16 }) {
    const lo = margin + w / 2;
    const hi = boxW - margin - w / 2;
    if (hi - lo < 40) return { cx: boxW / 2, dir, turned: false, blocked: true };
    let next = cx + (dir * speed * dtMs) / 1000;
    if (next <= lo) return { cx: lo, dir: 1, turned: true, blocked: false };
    if (next >= hi) return { cx: hi, dir: -1, turned: true, blocked: false };
    return { cx: next, dir, turned: false, blocked: false };
  }

  const api = { initial, advance, canDeploy, stepMarch };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetGuardRoutine = api;
})(this);

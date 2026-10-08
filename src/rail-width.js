// Width of the project rail when it is expanded: the user drags its edge (renderer.js), main.js keeps it.
// Plain CommonJS so tests can load it.
const DEFAULT = 170;
const MIN = 120;
const MAX = 400;

// Any value (a saved setting, a drag position) to a whole width in MIN..MAX; junk gives the default.
const clamp = (w) => Math.min(MAX, Math.max(MIN, Math.round(Number(w)) || DEFAULT));

// The rail may not squeeze the terminal below minTerminal in a window windowWidth wide (never below MIN).
const cap = (w, windowWidth, minTerminal) => Math.min(clamp(w), Math.max(MIN, windowWidth - minTerminal));

module.exports = { DEFAULT, MIN, MAX, clamp, cap };

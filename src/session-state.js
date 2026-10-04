// Per-session state behind each project row's dot: working, needs you, finished while away, idle.
// Loaded by the renderer as a plain <script> (window.WidgetSessionState) and by tests via require.
(function (root) {
  const initial = () => ({ working: false, attention: false, finished: false, exited: false });

  // ev: {t:'progress', state} (OSC 9;4), {t:'attention'}, {t:'input'}, {t:'activate'}, {t:'start'}, {t:'exit'}
  function apply(s, ev, isActive) {
    if (!ev || typeof ev !== 'object') return s;
    switch (ev.t) {
      case 'progress':
        if (ev.state >= 1 && ev.state <= 4) return { ...s, working: true, attention: false, finished: false };
        if (ev.state === 0 && s.working) return { ...s, working: false, finished: !isActive };
        return s;
      case 'attention': return { ...s, attention: true };
      case 'input': return s.attention ? { ...s, attention: false } : s;
      case 'activate': return s.finished ? { ...s, finished: false } : s;
      case 'exit': return { ...s, working: false, attention: false, exited: true };
      case 'start': return initial();
      default: return s;
    }
  }

  // Priority: Needs you > Working > Finished > Idle.
  function dot(s) {
    if (s.attention) return 'attention';
    if (s.working) return 'working';
    if (s.finished) return 'finished';
    return 'idle';
  }

  const api = { initial, apply, dot };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetSessionState = api;
})(this);

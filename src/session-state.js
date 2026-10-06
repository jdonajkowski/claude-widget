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
        // A turn that ended has nothing left waiting (also covers a prompt answered with the mouse).
        if (ev.state === 0 && s.working) return { ...s, working: false, attention: false, finished: !isActive };
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

  // Bytes the terminal sends by itself rather than the user typing: focus in/out, mouse reports, and replies to
  // terminal queries (XTVERSION and other DCS, OSC colours, kitty keyboard flags, device attributes, cursor
  // position, colour scheme). Interactive Claude Code 2.1.289 turns on focus and all-motion mouse reporting
  // (?1004, ?1003), so without this, moving the mouse over the terminal counted as answering a question.
  const AUTOMATIC = /\x1b\[[IO]|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3}|\x1bP[\s\S]*?\x1b\\|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[\?[\d;]*[uc]|\x1b\[>[\d;]*c|\x1b\[\d+;\d+R|\x1b\[\?\d+;\d+n/g;
  const isTyping = (data) => String(data).replace(AUTOMATIC, '') !== '';

  const api = { initial, apply, dot, isTyping };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetSessionState = api;
})(this);

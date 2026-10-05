// What the Gremlin at the bottom of the project list acts out: a question waiting (thought bubble with a ?),
// working (drumming its fingers), thinking (thought bubble with dots) or idle (blinks, the odd wave).
// Loaded by the renderer as a plain <script> (window.WidgetMascotState) and by tests via require.
(function (root) {
  // Tool calls in flight, from the hook's {t:'tool', phase:'start'|'end', id} events. The tool hooks run in
  // the background, so a quick call's end can reach the log before its start: an early end waits for it.
  function applyTool(tools, ev) {
    if (!ev || ev.t !== 'tool' || typeof ev.id !== 'string') return tools;
    const next = new Map(tools);
    const cur = next.get(ev.id);
    if (ev.phase === 'start') {
      if (cur === 'ended') next.delete(ev.id);
      else next.set(ev.id, 'running');
    } else if (ev.phase === 'end') {
      if (cur === 'running') next.delete(ev.id);
      else next.set(ev.id, 'ended');
    }
    return next;
  }

  const running = (tools) => [...tools.values()].filter((v) => v === 'running').length;

  // question: a session (any open one) waits on a permission prompt or question; turn: the shown session's
  // turn is running; tools / agents: tool calls and subagents running in it.
  function mood({ question, turn, tools, agents }) {
    if (question) return 'question';
    if (!turn) return 'idle';
    return tools > 0 || agents > 0 ? 'working' : 'thinking';
  }

  const api = { applyTool, running, mood };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetMascotState = api;
})(this);

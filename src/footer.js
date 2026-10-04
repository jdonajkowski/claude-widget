// Formats the side panel footer: model, cost, context, rate limits, git and the turn timer.
// Loaded by the renderer as a plain <script> (window.WidgetFooter) and by tests via require.
(function (root) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const get = (obj, keys) => keys.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

  function fmtTokens(n) {
    if (n === null) return '?';
    if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
    return String(n);
  }

  function fmtDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  // Context tokens in use right now: the last request's input side (cached + uncached).
  function contextTokens(cw) {
    const u = get(cw, ['current_usage']);
    if (!u || typeof u !== 'object') return null;
    return (num(u.input_tokens) || 0) + (num(u.cache_creation_input_tokens) || 0) + (num(u.cache_read_input_tokens) || 0);
  }

  // Claude Code statusLine JSON (checked against 2.1.289) -> plain values, null where missing.
  function summarize(s) {
    if (!s || typeof s !== 'object') return null;
    const cw = s.context_window;
    const used = num(get(cw, ['used_percentage']));
    return {
      model: get(s, ['model', 'display_name']) || get(s, ['model', 'id']) || null,
      effort: get(s, ['effort', 'level']) || null,
      cost: num(get(s, ['cost', 'total_cost_usd'])),
      ctxPct: used === null ? null : Math.min(100, Math.max(0, used)),
      ctxTokens: contextTokens(cw),
      ctxSize: num(get(cw, ['context_window_size'])),
      fiveHour: num(get(s, ['rate_limits', 'five_hour', 'used_percentage'])),
      sevenDay: num(get(s, ['rate_limits', 'seven_day', 'used_percentage'])),
      fiveHourResets: num(get(s, ['rate_limits', 'five_hour', 'resets_at'])),
      cwd: get(s, ['workspace', 'current_dir']) || s.cwd || null
    };
  }

  // Warn colors share thresholds so the footer reads as one scale.
  function level(pct) {
    if (pct === null) return '';
    return pct >= 85 ? 'hot' : pct >= 60 ? 'warm' : '';
  }

  function fmtResets(epochSec, now) {
    if (epochSec === null) return '';
    const mins = Math.round((epochSec * 1000 - now) / 60000);
    if (mins <= 0) return '';
    return mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${mins}m`;
  }

  function fmtGit(g) {
    if (!g || !g.branch) return null;
    const parts = [g.branch];
    if (g.changed) parts.push(`●${g.changed}`);
    if (g.upstream && g.ahead) parts.push(`↑${g.ahead}`);
    if (g.upstream && g.behind) parts.push(`↓${g.behind}`);
    if (!g.changed && !(g.upstream && (g.ahead || g.behind))) parts.push('✓');
    return parts.join(' ');
  }

  const api = { summarize, fmtTokens, fmtDuration, fmtResets, fmtGit, level };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetFooter = api;
})(this);

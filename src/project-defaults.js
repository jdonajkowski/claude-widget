// Per-project session defaults: the model, permission mode and environment variables a project's Claude
// session starts with. Stored by main.js as project-defaults.json: { [projectId]: { model, permission, env } }.
// Edited as text, one setting per line:
//   model: opus
//   permission: plan
//   env: NODE_ENV=development
// Pure; loaded by main.js and tests via require.
const PERMISSIONS = ['default', 'acceptEdits', 'plan', 'auto'];
const MODEL = /^[\w.:/[\]-]{1,80}$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const empty = () => ({ model: '', permission: '', env: {} });

// Text -> { defaults } or { error }. Blank lines and lines starting with # are ignored.
function parseText(text) {
  const d = empty();
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(model|permission|env)\s*[:=]\s*(.*)$/i.exec(line);
    if (!m) return { error: `Line ${i + 1}: start with model:, permission: or env:` };
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'model') {
      if (value && !MODEL.test(value)) return { error: `Line ${i + 1}: not a model name` };
      d.model = value;
    } else if (key === 'permission') {
      if (value && !PERMISSIONS.includes(value)) return { error: `Line ${i + 1}: permission is one of ${PERMISSIONS.join(', ')}` };
      d.permission = value;
    } else {
      const eq = value.indexOf('=');
      const name = eq < 0 ? '' : value.slice(0, eq).trim();
      if (!ENV_KEY.test(name) || /^GREMLIN_/i.test(name)) return { error: `Line ${i + 1}: write env: NAME=value (not GREMLIN_*)` };
      d.env[name] = value.slice(eq + 1).trim().slice(0, 500);
    }
  }
  return { defaults: d };
}

// Defaults -> the text shown in the editor (with a hint when nothing is set yet).
function formatText(d) {
  const x = normalize(d);
  const lines = [];
  if (x.model) lines.push(`model: ${x.model}`);
  if (x.permission) lines.push(`permission: ${x.permission}`);
  for (const [k, v] of Object.entries(x.env)) lines.push(`env: ${k}=${v}`);
  return lines.length ? lines.join('\n') : '# model: opus\n# permission: plan   (default, acceptEdits, plan or auto)\n# env: NAME=value';
}

// Anything stored on disk -> a valid defaults object (bad fields dropped).
function normalize(d) {
  const out = empty();
  if (!d || typeof d !== 'object') return out;
  if (typeof d.model === 'string' && MODEL.test(d.model.trim())) out.model = d.model.trim();
  if (PERMISSIONS.includes(d.permission)) out.permission = d.permission;
  if (d.env && typeof d.env === 'object') {
    for (const [k, v] of Object.entries(d.env)) if (ENV_KEY.test(k) && !/^GREMLIN_/i.test(k) && typeof v === 'string') out.env[k] = v.slice(0, 500);
  }
  return out;
}

const isEmpty = (d) => !d || (!d.model && !d.permission && !Object.keys(d.env || {}).length);

// Extra claude flags for the launch command, e.g. " --model 'opus' --permission-mode 'plan'". The values are
// already validated, and are quoted with single quotes for PowerShell and POSIX shells alike.
function flags(d) {
  const x = normalize(d);
  let out = '';
  if (x.model) out += ` --model '${x.model}'`;
  if (x.permission) out += ` --permission-mode '${x.permission}'`;
  return out;
}

module.exports = { PERMISSIONS, parseText, formatText, normalize, isEmpty, flags };

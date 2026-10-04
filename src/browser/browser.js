// Built-in browser toolbar. Navigation happens in the main process, which reports back the page state.
(() => {
  const host = window.browserHost;
  const $ = (id) => document.getElementById(id);
  const urlEl = $('url');
  let statusTimer;

  const status = (msg, ms = 2500) => {
    $('status').textContent = msg;
    $('status').classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => $('status').classList.remove('show'), ms);
  };

  host.onState((s) => {
    if (document.activeElement !== urlEl) urlEl.value = s.url || '';
    document.title = s.title ? `${s.title} — Browser` : 'Browser';
    $('btn-back').disabled = !s.canGoBack;
    $('btn-fwd').disabled = !s.canGoForward;
    document.body.classList.toggle('loading', !!s.loading);
    if (s.device) $('device').value = s.device;
  });
  host.onStatus((msg) => status(msg, 4000));

  $('nav').addEventListener('submit', (e) => {
    e.preventDefault();
    host.go(urlEl.value);
    urlEl.blur();
  });
  urlEl.addEventListener('focus', () => urlEl.select());
  $('btn-back').onclick = () => host.back();
  $('btn-fwd').onclick = () => host.forward();
  $('btn-reload').onclick = (e) => host.reload(e.shiftKey);
  $('btn-devtools').onclick = () => host.devtools();
  $('btn-external').onclick = () => host.external();
  $('device').onchange = (e) => host.device(e.target.value);
  $('btn-shot').onclick = async () => {
    const res = await host.screenshot();
    if (res && res.file) status(`Saved ${res.file}`, 5000);
    else if (res && res.error) status(`Screenshot failed: ${res.error}`);
  };

  // Shortcuts while the toolbar has focus (main.js handles them while the page has focus).
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'l') { e.preventDefault(); urlEl.focus(); }
    else if (k === 'f5' || (e.ctrlKey && k === 'r')) { e.preventDefault(); host.reload(e.shiftKey); }
    else if (k === 'f12') { e.preventDefault(); host.devtools(); }
    else if (e.altKey && k === 'arrowleft') host.back();
    else if (e.altKey && k === 'arrowright') host.forward();
  });
})();

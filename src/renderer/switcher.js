// Project switcher (Ctrl+Shift+P): type to filter the projects, Enter to open one, Ctrl+Enter to open it as a tab.
// Also the base of the prompt palette: items without a `dot` get no state dot, `plain` items show their text left-aligned.
// Loaded as a plain script (window.WidgetSwitcher).
(function (root) {
  const MAX_ROWS = 50;

  // items(): [{id, name, path, open, active, dot}]; pick(id, {inTab}); canTab(id): may it open as a tab?
  function createSwitcher({ el, items, pick, canTab = () => false, onClose, onKey = () => false, emptyText = 'No project matches' }) {
    const input = el.querySelector('.sw-input');
    const listEl = el.querySelector('.sw-list');
    let shown = [];
    let sel = 0;

    function render() {
      const all = items();
      const query = input.value;
      // With nothing typed: the open projects first (the ones waiting for you on top), then the rest, in sidebar order.
      const urgency = (p) => (p.dot === 'attention' ? 0 : p.dot === 'finished' ? 1 : 2);
      const open = all.filter((p) => p.open).map((p, i) => ({ p, i })).sort((a, b) => urgency(a.p) - urgency(b.p) || a.i - b.i).map((x) => x.p);
      const base = query.trim() ? all : [...open, ...all.filter((p) => !p.open)];
      shown = root.WidgetFuzzy.rank(query, base).slice(0, MAX_ROWS);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      listEl.replaceChildren(...shown.map((p, i) => {
        const row = document.createElement('div');
        row.className = `sw-row${i === sel ? ' sel' : ''}`;
        const dot = document.createElement('span');
        dot.className = `pdot ${p.open ? p.dot : 'idle'}`;
        const name = document.createElement('span');
        name.className = 'sw-name';
        name.textContent = p.name;
        const path = document.createElement('span');
        path.className = p.plain ? 'sw-path plain' : 'sw-path';
        path.textContent = p.plain ? p.path : [p.git, p.active ? 'current project' : p.path].filter(Boolean).join('   ');
        if (p.dot !== undefined) row.append(dot);
        row.append(name, path);
        row.onmousedown = (e) => { e.preventDefault(); choose(i, e.ctrlKey || e.shiftKey); };
        row.onmousemove = () => { if (sel !== i) { sel = i; mark(); } };
        return row;
      }));
      if (!shown.length) {
        const none = document.createElement('div');
        none.className = 'sw-none';
        none.textContent = emptyText;
        listEl.appendChild(none);
      }
    }

    function mark() {
      [...listEl.children].forEach((row, i) => row.classList.toggle('sel', i === sel));
      const row = listEl.children[sel];
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    function choose(i, inTab) {
      const p = shown[i];
      if (!p) return;
      close();
      pick(p.id, { inTab: !!inTab && canTab(p.id) });
    }

    function open() {
      input.value = '';
      sel = 0;
      el.hidden = false;
      render();
      input.focus();
    }

    function close() {
      if (el.hidden) return;
      el.hidden = true;
      onClose();
    }

    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (onKey(e, shown[sel], { refresh: () => render(), close })) { e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (shown.length) sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
        mark();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(sel, e.ctrlKey || e.shiftKey);
      }
    });
    // Clicking outside the box closes it.
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });

    return { open, close, toggle: () => (el.hidden ? open() : close()), isOpen: () => !el.hidden };
  }

  root.WidgetSwitcher = { createSwitcher };
})(this);

// Project rail: one row per project with its state dot. Collapsed, rows show two-letter initials.
// Loaded as a plain script (window.WidgetRail).
(function (root) {
  const DOT_TITLES = { working: 'Working', attention: 'Needs you', finished: 'Finished while you were away', idle: 'Idle' };

  function createRail({ el, onOpen, onMenu, onAdd }) {
    const listEl = el.querySelector('#rail-list');
    el.querySelector('#rail-add').onclick = onAdd;
    const rows = new Map();

    function makeRow(p) {
      const row = document.createElement('div');
      row.className = 'proj';
      row.innerHTML = '<span class="pdot"></span><span class="pname"></span><span class="pinit"></span>';
      row.addEventListener('click', () => onOpen(row.dataset.id));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); onMenu(row.dataset.id); });
      return row;
    }

    // list: [{id, path, name, initials, pinned, missing}], view: {active, open:Set, dot:(id)=>string}
    function render(list, view) {
      const keep = new Set(list.map((p) => p.id));
      for (const [id, row] of rows) if (!keep.has(id)) { row.remove(); rows.delete(id); }
      list.forEach((p, i) => {
        let row = rows.get(p.id);
        if (!row) { row = makeRow(p); rows.set(p.id, row); }
        if (listEl.children[i] !== row) listEl.insertBefore(row, listEl.children[i] || null);
        row.dataset.id = p.id;
        const dot = view.open.has(p.id) ? view.dot(p.id) : 'idle';
        row.querySelector('.pdot').className = `pdot ${dot}`;
        row.querySelector('.pname').textContent = (p.pinned ? '📌 ' : '') + (p.worktreeOf ? '⑂ ' : '') + p.name + (p.missing ? ' (missing)' : '');
        row.querySelector('.pinit').textContent = p.initials;
        row.title = `${p.name}\n${p.path}${p.worktreeOf ? `\nWorktree of ${p.worktreeOf}` : ''}${view.open.has(p.id) ? ` — ${DOT_TITLES[dot]}` : ''}${i < 9 ? `  (Ctrl+${i + 1})` : ''}`;
        row.classList.toggle('active', p.id === view.active);
        row.classList.toggle('missing', !!p.missing);
        row.classList.toggle('running', view.open.has(p.id));
      });
    }

    function setCollapsed(collapsed, width) {
      document.body.classList.toggle('rail-collapsed', collapsed);
      document.documentElement.style.setProperty('--rail-w', `${width}px`);
    }

    return { render, setCollapsed };
  }

  root.WidgetRail = { createRail };
})(this);

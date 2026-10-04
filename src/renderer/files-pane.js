// Files pane: a folder tree of the active project, left of the terminal. Folders load when expanded;
// clicking a file opens it (Markdown in the viewer). Loaded as a plain script (window.WidgetFilesPane).
(function (root) {
  function createFilesPane({ el, widget, open: initial = false }) {
    const listEl = el.querySelector('#files-list');
    const headEl = el.querySelector('#files-head .title');
    el.querySelector('#files-refresh').onclick = () => refresh();

    let projectId = null;
    let cache = new Map(); // rel -> entries for the current project
    const expanded = new Map(); // project id -> Set of expanded folder rels
    let renderSeq = 0;

    const openDirs = () => {
      if (!expanded.has(projectId)) expanded.set(projectId, new Set());
      return expanded.get(projectId);
    };

    async function load(rel) {
      if (cache.has(rel)) return cache.get(rel);
      const res = await widget.files.list(projectId, rel);
      const entries = (res && res.entries) || null;
      if (rel === '' && res) {
        const name = res.root.split(/[\\/]/).filter(Boolean).pop() || res.root;
        headEl.textContent = name;
        headEl.title = res.root;
      }
      cache.set(rel, entries);
      return entries;
    }

    function row(entry, depth) {
      const r = document.createElement('div');
      r.className = entry.dir ? 'frow dir' : 'frow';
      r.style.paddingLeft = `${6 + depth * 12}px`;
      r.title = entry.rel;
      const chev = document.createElement('span');
      chev.className = 'chev';
      if (entry.dir) chev.textContent = openDirs().has(entry.rel) ? '▾' : '▸';
      const name = document.createElement('span');
      name.className = 'fname';
      name.textContent = entry.name;
      r.append(chev, name);
      r.addEventListener('click', () => {
        if (!entry.dir) return widget.files.open(projectId, entry.rel);
        const dirs = openDirs();
        if (dirs.has(entry.rel)) dirs.delete(entry.rel);
        else dirs.add(entry.rel);
        render();
      });
      r.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        widget.files.menu(projectId, entry.rel, entry.dir);
      });
      return r;
    }

    // Builds the whole visible tree off-screen, then swaps it in, so a refresh doesn't flicker.
    async function render() {
      if (el.hidden) return;
      const seq = ++renderSeq;
      const frag = document.createDocumentFragment();
      if (!projectId) {
        headEl.textContent = 'Files';
        headEl.title = '';
      } else {
        const dirs = openDirs();
        const walk = async (rel, depth) => {
          const entries = await load(rel);
          if (!entries) return;
          for (const e of entries) {
            frag.appendChild(row(e, depth));
            if (e.dir && dirs.has(e.rel)) await walk(e.rel, depth + 1);
          }
        };
        await walk('', 0);
      }
      if (seq !== renderSeq) return; // a newer render started meanwhile
      if (!frag.childNodes.length) {
        const empty = document.createElement('div');
        empty.className = 'fempty';
        empty.textContent = projectId ? 'Empty folder' : 'No project open';
        frag.appendChild(empty);
      }
      const scroll = listEl.scrollTop;
      listEl.replaceChildren(frag);
      listEl.scrollTop = scroll;
    }

    function refresh() {
      cache = new Map();
      return render();
    }

    function setProject(id) {
      if (id === projectId) return;
      projectId = id;
      listEl.scrollTop = 0;
      refresh();
    }

    function setOpen(open) {
      el.hidden = !open;
      document.getElementById('btn-files').classList.toggle('on', open);
      if (open) refresh();
    }

    setOpen(initial);

    return {
      setProject,
      refresh: () => (el.hidden ? undefined : refresh()),
      toggle: () => { setOpen(el.hidden); widget.files.setOpen(!el.hidden); },
      isOpen: () => !el.hidden
    };
  }

  root.WidgetFilesPane = { createFilesPane };
})(this);

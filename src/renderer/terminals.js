/* global Terminal, FitAddon, WebLinksAddon, WidgetMdLinks */
// One xterm per session, each in its own <div> inside #terminal. Hidden terminals keep receiving output,
// so switching back shows complete scrollback. Loaded as a plain script (window.WidgetTerminals).
(function (root) {
  function createTerminals({ widget, cfg, host, onProgress, onInput, toast }) {
    const terms = new Map();
    let activeId = null;
    let fontSize = cfg.fontSize;

    function create(id) {
      const el = document.createElement('div');
      el.className = 'term-pane';
      el.hidden = true;
      host.appendChild(el);

      const term = new Terminal({
        fontFamily: cfg.fontFamily,
        fontSize,
        cursorBlink: true,
        allowProposedApi: true,
        allowTransparency: cfg.transparent,
        scrollback: 10000,
        theme: cfg.transparent ? { ...cfg.theme, background: '#00000000' } : cfg.theme,
        // OSC 8 hyperlinks: Markdown files (file: URIs or plain paths) open in a popout, web links in the browser.
        linkHandler: {
          allowNonHttpProtocols: true,
          activate: (_e, uri) => {
            if (/^https?:\/\//i.test(uri)) return widget.openExternal(uri);
            // A scheme has 2+ letters, so a drive letter (C:\…) counts as a plain path.
            const target = uri.split(/[?#]/)[0].replace(/(?::\d+)+$/, '');
            const local = /^file:/i.test(target) || !/^[a-z][\w+.-]+:/i.test(target);
            if (local && /\.(md|markdown)$/i.test(target)) widget.md.open(target, id);
          }
        }
      });
      const fit = new FitAddon.FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, url) => widget.openExternal(url)));
      term.open(el);
      const t = { id, el, term, fit, exited: false };
      terms.set(id, t);

      term.parser.registerOscHandler(9, (data) => {
        const m = /^4;(\d)(?:;(\d{1,3}))?/.exec(data);
        if (!m) return false; // not a progress sequence; leave other OSC 9 uses alone
        onProgress(id, Number(m[1]), Number(m[2] || 0));
        return true;
      });

      term.onData((data) => {
        if (t.exited) {
          if (data === '\r') restart(id);
          return;
        }
        widget.pty.write(id, data);
        onInput(id);
      });
      term.onResize(({ cols, rows }) => { if (!t.el.hidden) widget.pty.resize(id, cols, rows); });

      // Markdown paths in the output open rendered in a popout (click).
      // Wrapped rows are joined so a long path that spans rows is still one link.
      term.registerLinkProvider({
        provideLinks(y, callback) {
          const buf = term.buffer.active;
          let first = y - 1;
          while (first > 0 && buf.getLine(first) && buf.getLine(first).isWrapped) first--;
          let last = y - 1;
          while (buf.getLine(last + 1) && buf.getLine(last + 1).isWrapped) last++;
          let text = '';
          for (let r = first; r <= last; r++) {
            const line = buf.getLine(r);
            if (line) text += line.translateToString(r === last);
          }
          const matches = WidgetMdLinks.find(text);
          if (!matches.length) return callback(undefined);
          const cols = term.cols;
          const pos = (i) => ({ x: (i % cols) + 1, y: first + Math.floor(i / cols) + 1 });
          Promise.all(matches.map((m) => widget.md.resolve(m.candidates.map((c) => c.path), id)
            .then((hit) => hit && { c: m.candidates[hit.index], file: hit.file })))
            .then((hits) => {
              const links = hits.filter(Boolean).map(({ c, file }) => ({
                range: { start: pos(c.start), end: pos(c.end - 1) },
                text: c.path,
                decorations: { underline: true, pointerCursor: true },
                activate: () => widget.md.open(file, id)
              })).filter((l) => l.range.start.y <= y && l.range.end.y >= y);
              callback(links.length ? links : undefined);
            }, () => callback(undefined));
        }
      });

      // Keyboard: copy/paste, newline, restart, font zoom.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        const key = e.key.toLowerCase();
        // Ctrl+C copies when text is selected, otherwise it is sent as SIGINT.
        if (e.ctrlKey && !e.shiftKey && key === 'c' && term.hasSelection()) {
          widget.clipboard.write(term.getSelection());
          term.clearSelection();
          return false;
        }
        if (e.ctrlKey && e.shiftKey && key === 'c') {
          if (term.hasSelection()) widget.clipboard.write(term.getSelection());
          return false;
        }
        // Ctrl+V / Ctrl+Shift+V paste (bracketed paste handled by xterm).
        if (e.ctrlKey && key === 'v') {
          widget.clipboard.read().then((text) => text && term.paste(text));
          return false;
        }
        // Shift+Enter inserts a newline in Claude Code's prompt (sent as Esc+Enter).
        if (e.shiftKey && !e.ctrlKey && !e.altKey && key === 'enter') {
          if (!t.exited) widget.pty.write(id, '\x1b\r');
          return false;
        }
        if (key === 'f11' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          widget.win.toggleFullScreen();
          return false;
        }
        if (e.ctrlKey && e.shiftKey && key === 'r') {
          restart(id);
          return false;
        }
        // Ctrl+= / Ctrl+- zoom the font of every terminal.
        if (e.ctrlKey && (key === '=' || key === '+' || key === '-')) {
          fontSize = Math.min(32, Math.max(8, fontSize + (key === '-' ? -1 : 1)));
          for (const x of terms.values()) x.term.options.fontSize = fontSize;
          fitActive();
          toast(`Font ${fontSize}px`);
          return false;
        }
        return true;
      });

      // Right-click: copy selection if any, otherwise paste (Windows Terminal style).
      el.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        if (term.hasSelection()) {
          widget.clipboard.write(term.getSelection());
          term.clearSelection();
          toast('Copied');
        } else {
          const text = await widget.clipboard.read();
          if (text) term.paste(text);
        }
      });
      return t;
    }

    // Fitting happens after showing: xterm measures 0x0 while hidden.
    function show(id) {
      const t = terms.get(id);
      if (!t) return null;
      for (const x of terms.values()) if (x !== t) x.el.hidden = true;
      t.el.hidden = false;
      activeId = id;
      try { t.fit.fit(); } catch { /* not laid out yet */ }
      widget.pty.resize(id, t.term.cols, t.term.rows);
      t.term.focus();
      return t;
    }

    function fitActive() {
      const t = terms.get(activeId);
      if (t) {
        try { t.fit.fit(); } catch { /* not visible yet */ }
      }
    }

    function restart(id) {
      const t = terms.get(id);
      if (!t) return;
      t.exited = false;
      t.term.reset();
      if (!t.el.hidden) {
        try { t.fit.fit(); } catch { /* not visible */ }
      }
      widget.pty.restart(id, t.term.cols, t.term.rows);
      onRestart(id);
    }
    let onRestart = () => {};

    function markExited(id, code) {
      const t = terms.get(id);
      if (!t) return;
      t.exited = true;
      t.term.write(`\r\n\x1b[90m[session ended (exit ${code}). Press Enter to restart]\x1b[0m\r\n`);
    }

    function destroy(id) {
      const t = terms.get(id);
      if (!t) return;
      terms.delete(id);
      t.term.dispose();
      t.el.remove();
      if (activeId === id) activeId = null;
    }

    return {
      create,
      show,
      restart,
      markExited,
      destroy,
      fitActive,
      has: (id) => terms.has(id),
      get: (id) => terms.get(id),
      write: (id, data) => { const t = terms.get(id); if (t) t.term.write(data); },
      focus: () => { const t = terms.get(activeId); if (t) t.term.focus(); },
      setOnRestart: (fn) => { onRestart = fn; }
    };
  }

  root.WidgetTerminals = { createTerminals };
})(this);

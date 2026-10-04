/* global require, monaco */
// Editor window: one file in Monaco. Ctrl+S saves through the main process, which also reports
// changes made on disk (e.g. by Claude): applied right away if there are no unsaved edits, else offered.
(() => {
  const host = window.editorHost;
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const saveBtn = $('btn-save');
  let statusTimer;

  const setStatus = (text, error = false, ms = 0) => {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', error);
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, ms);
  };

  require.config({ paths: { vs: '../../node_modules/monaco-editor/min/vs' } });
  require(['vs/editor/editor.main'], async () => {
    const doc = await host.get();
    if (!doc) return setStatus('Nothing to edit', true);
    if (doc.error) return setStatus(`Could not read the file: ${doc.error}`, true);

    document.title = doc.name;
    $('path').textContent = doc.file;
    $('path').title = doc.file;

    monaco.editor.defineTheme('widget', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1f1e1d',
        'editorCursor.foreground': '#d97757',
        'editor.selectionBackground': '#d9775755',
        'editorLineNumber.activeForeground': '#e8e6e3',
        'minimap.background': '#1f1e1d'
      }
    });

    const lower = doc.name.toLowerCase();
    const lang = monaco.languages.getLanguages().find((l) =>
      (l.filenames || []).some((f) => f.toLowerCase() === lower) ||
      (l.extensions || []).some((e) => lower.endsWith(e.toLowerCase())));
    const model = monaco.editor.createModel(doc.text, lang ? lang.id : 'plaintext', monaco.Uri.file(doc.file));

    const editor = monaco.editor.create($('editor'), {
      model,
      theme: 'widget',
      automaticLayout: true,
      fontFamily: doc.fontFamily,
      fontSize: doc.fontSize,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      fixedOverflowWidgets: true
    });
    if (doc.line) {
      editor.setPosition({ lineNumber: doc.line, column: 1 });
      editor.revealLineInCenter(doc.line);
    }
    editor.focus();

    // Undoing back to the saved text makes the file clean again.
    let savedVersion = model.getAlternativeVersionId();
    let dirty = false;
    const refreshDirty = () => {
      const now = model.getAlternativeVersionId() !== savedVersion;
      saveBtn.disabled = !now;
      if (now === dirty) return;
      dirty = now;
      document.title = `${dirty ? '● ' : ''}${doc.name}`;
      host.setDirty(dirty);
    };
    model.onDidChangeContent(refreshDirty);
    refreshDirty();

    async function save() {
      const version = model.getAlternativeVersionId();
      const res = await host.save(model.getValue());
      if (!res || res.error) {
        setStatus(`Save failed: ${res ? res.error : 'unknown error'}`, true);
        return false;
      }
      savedVersion = version;
      $('banner').hidden = true;
      refreshDirty();
      setStatus('Saved', false, 1500);
      return true;
    }

    // Replaces the text as one undoable edit, keeping the cursor and scroll position.
    function applyDisk(text) {
      const view = editor.saveViewState();
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
      savedVersion = model.getAlternativeVersionId();
      editor.restoreViewState(view);
      $('banner').hidden = true;
      refreshDirty();
    }

    let diskText = null;
    host.onChanged((text) => {
      if (text === model.getValue()) return;
      if (!dirty) {
        applyDisk(text);
        setStatus('Reloaded from disk', false, 2000);
      } else {
        diskText = text;
        $('banner').hidden = false;
      }
    });
    $('btn-reload').onclick = () => { if (diskText !== null) applyDisk(diskText); editor.focus(); };
    $('btn-keep').onclick = () => { $('banner').hidden = true; editor.focus(); };

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    saveBtn.onclick = () => { save(); editor.focus(); };
    $('btn-vscode').onclick = () => host.openInVSCode(editor.getPosition().lineNumber);
    host.onSaveAndClose(async () => { if (await save()) host.close(); });
  });
})();

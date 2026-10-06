// The guarding copy of Glitch: shows the pose cards from assets/guard/ inside a box clipped at the bottom edge of
// the terminal, so the spear really comes up from "below the window". It plays the steps from guard-routine.js
// and owns no schedule. Click-through. Loaded as a plain <script> (window.WidgetGuardActor).
(function (root) {
  const GLITCH_PX = 170;   // tall when standing
  const STAND_SRC_PX = 700; // height of stand.png
  const BOX_H = 220;
  const STRIDE_MS = 300;   // march_a / march_b swap
  const BOUNCE_PX = 4;

  function createGuardActor({ hostEl, poses, base = '../../assets/guard/' }) {
    const GR = root.WidgetGuardRoutine;
    const doc = root.document;
    const byId = new Map(poses.map((p) => [p.id, p]));
    const box = doc.createElement('div');
    box.id = 'guard';
    box.className = 'glow'; // a thin pale outline keeps the dark cable and spear shaft readable on the terminal
    box.hidden = true;
    const img = doc.createElement('img');
    img.alt = '';
    img.draggable = false;
    box.appendChild(img);
    doc.body.appendChild(box);

    let loaded = null;   // Promise from load()
    let token = 0;       // bumped by every run() and recall(): a step that finds a newer token stops
    let timer = 0;
    let raf = 0;
    let settle = null;   // resolves the running step's promise with false when it is cancelled
    let anim = null;
    let cx = 0;          // horizontal centre of the figure inside the box, px
    let dir = -1;        // walking direction: -1 left, 1 right

    const sizeOf = (id) => {
      const p = byId.get(id);
      const k = (GLITCH_PX / STAND_SRC_PX) * (p.scale || 1);
      return { w: p.width * k, h: p.height * k, p };
    };

    function load() {
      if (!loaded) {
        loaded = Promise.all(poses.map((p) => new Promise((resolve, reject) => {
          const i = new root.Image();
          i.onload = resolve;
          i.onerror = () => reject(new Error(`guard pose ${p.id} failed to load (${base}${p.file})`));
          i.src = base + p.file;
        }))).catch((e) => { loaded = null; throw e; });
      }
      return loaded;
    }

    // Puts the box over the terminal, its bottom on the terminal's bottom edge. Returns the box width.
    function layout() {
      const r = hostEl.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.bottom - BOX_H}px`, width: `${r.width}px`, height: `${BOX_H}px` });
      return r.width;
    }

    function show(id) {
      const { w, h, p } = sizeOf(id);
      if (img.dataset.pose !== id) { img.src = base + p.file; img.dataset.pose = id; }
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      img.style.left = `${cx - w / 2}px`;
      // Side-on poses face right: mirror them when walking left. Front poses are never mirrored.
      img.style.transform = p.facing === 'right' && dir === -1 ? 'scaleX(-1)' : 'none';
      img.style.visibility = '';
    }

    function cancel() {
      token++;
      clearTimeout(timer);
      root.cancelAnimationFrame(raf);
      if (anim) { anim.cancel(); anim = null; }
      img.style.translate = '';
      if (settle) { const s = settle; settle = null; s(false); }
    }

    const wait = (ms, my) => new Promise((resolve) => {
      settle = resolve;
      timer = setTimeout(() => { settle = null; resolve(token === my); }, ms);
    });

    function march(ms, my) {
      return new Promise((resolve) => {
        settle = resolve;
        const t0 = root.performance.now();
        let last = t0;
        let pauseUntil = 0;
        const tick = (now) => {
          if (token !== my) return; // cancelled: cancel() already resolved the promise with false
          if (now - t0 >= ms) { settle = null; img.style.translate = ''; return resolve(true); }
          if (now >= pauseUntil) {
            const { w } = sizeOf('march_a');
            const r = GR.stepMarch({ cx, dir, dtMs: now - last, w, boxW: box.clientWidth });
            cx = r.cx;
            if (r.blocked) { show('stand'); pauseUntil = Infinity; } // too narrow to walk: stand guard
            else if (r.turned) { dir = r.dir; show('stand'); pauseUntil = now + 400; }
            else {
              show(Math.floor((now - t0) / STRIDE_MS) % 2 ? 'march_b' : 'march_a');
              img.style.translate = `0 ${-BOUNCE_PX * Math.abs(Math.sin((Math.PI * (now - t0)) / STRIDE_MS))}px`;
            }
          }
          last = now;
          raf = root.requestAnimationFrame(tick);
        };
        raf = root.requestAnimationFrame(tick);
      });
    }

    // Shows the box at the right-hand end of the terminal. The caller runs the first step next.
    function deploy() {
      cancel();
      const w = layout();
      cx = Math.max(100, w - 160);
      dir = -1;
      img.dataset.pose = '';
      img.style.visibility = 'hidden'; // until the first step shows a pose
      box.hidden = false;
    }

    function deployStill() {
      deploy();
      show('stand');
    }

    function run(step) {
      cancel();
      const my = token;
      if (box.hidden) return Promise.resolve(false);
      if (step.type === 'march') return march(step.ms, my);
      show(step.pose);
      // Climbing up out of the window edge: rises from below the clip.
      if (step.pose === 'climb_out_1') anim = img.animate({ translate: ['0 100%', '0 0'] }, { duration: 450, easing: 'ease-out' });
      return wait(step.ms, my);
    }

    function recall() {
      cancel();
      if (box.hidden) return;
      const a = img.animate({ translate: ['0 0', '0 100%'] }, { duration: 250, easing: 'ease-in', fill: 'forwards' });
      anim = a;
      a.onfinish = () => { if (anim === a) { box.hidden = true; a.cancel(); anim = null; } };
    }

    return { load, deploy, deployStill, run, recall };
  }

  root.WidgetGuardActor = { createGuardActor };
})(this);

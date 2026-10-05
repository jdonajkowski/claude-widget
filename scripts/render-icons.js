// Builds the logo, app icons and sidebar mascot from the artwork in assets/:
//   logo-source.png -> logo.png   the logo with its empty margins trimmed (README)
//                   -> icon.png   512 px square app icon (Linux, window icons)
//                   -> icon.ico   16-256 px (Windows: taskbar, tray, installer)
//   peek-source.png -> peek.png   the gremlin peeking up at the bottom of the project list, 360 px wide
// The square icon crops the gremlin close and scales it up, over a terminal tile redrawn to match the
// logo (grey frame, dark title bar with three dots, divider, >_), so it still reads at 16 px.
// Run after changing the artwork:  npx electron scripts/render-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

// ICONDIR, one ICONDIRENTRY per image, then the PNG data (Windows Vista and later read PNG entries).
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

// Runs in the page: returns { logo, icon } as base64 PNGs (icon is 1024 px).
const COMPOSE = String.raw`(src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onerror = () => reject(new Error('Could not load the artwork'));
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;

    // Trimmed logo: the bounding box of everything visible, plus a little room.
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const pad = 12;
    const t = document.createElement('canvas'); t.width = x1 - x0 + 1 + pad * 2; t.height = y1 - y0 + 1 + pad * 2;
    t.getContext('2d').drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);

    // Square icon. Source coordinates are for the 1024 x 623 artwork: the terminal's top frame starts at
    // y 372, its title bar runs to y 431, the divider to y 446.
    const S = 1024, GREY = '#919393', DARK = '#2d2c2c';
    const sx0 = 205, sx1 = 815, sy0 = 126, sy1 = 431;
    const L = 30, R = S - 30, s = (R - L) / (sx1 - sx0), top = 10;
    const map = (y) => top + (y - sy0) * s;
    const tileTop = map(372), barTop = map(386), barBottom = map(431), divBottom = map(446), bottom = S - 18, rad = 64;
    const frame = Math.round(13 * s);
    const tilePath = (x, y, w, h, r) => {
      const p = new Path2D();
      p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
      p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
      p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); p.closePath();
      return p;
    };
    const out = document.createElement('canvas'); out.width = out.height = S;
    const o = out.getContext('2d'); o.imageSmoothingQuality = 'high';
    // 1. The tile: grey frame, dark inside, the divider and the prompt.
    o.fillStyle = GREY; o.fill(tilePath(L, tileTop, R - L, bottom - tileTop, rad));
    o.fillStyle = DARK; o.fill(tilePath(L + frame, tileTop + frame, R - L - frame * 2, bottom - tileTop - frame * 2, rad - frame));
    o.fillStyle = GREY; o.fillRect(L + frame, barBottom, R - L - frame * 2, divBottom - barBottom);
    o.strokeStyle = '#8e8e8e'; o.lineCap = 'round'; o.lineJoin = 'round'; o.lineWidth = 30;
    const py = divBottom + (bottom - divBottom) * 0.45;
    o.beginPath(); o.moveTo(120, py - 62); o.lineTo(214, py); o.lineTo(120, py + 62); o.stroke();
    o.beginPath(); o.moveTo(268, py + 66); o.lineTo(380, py + 66); o.stroke();
    // 2. The gremlin: everything above the tile, and what lies over the title bar inside the frame.
    o.save();
    const clip = new Path2D();
    clip.rect(0, 0, S, tileTop - 2);
    clip.addPath(tilePath(L + frame, tileTop - 3, R - L - frame * 2, barBottom - tileTop + 4, 0));
    o.clip(clip);
    o.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0, L, top, R - L, (sy1 - sy0) * s);
    o.restore();
    // 3. A clean title bar under the dots (the crop cuts through the artwork's own dots).
    o.fillStyle = DARK; o.fillRect(L + frame, barTop, 150, barBottom - barTop);
    // 4. Frame sides and rounded top corners over the crop edges, then the three dots.
    o.fillStyle = GREY;
    o.fillRect(L, tileTop + rad, frame, barBottom - tileTop - rad + 2);
    o.fillRect(R - frame, tileTop + rad, frame, barBottom - tileTop - rad + 2);
    o.lineWidth = frame; o.strokeStyle = GREY; o.lineCap = 'butt';
    o.beginPath(); o.moveTo(L + frame / 2, tileTop + rad); o.quadraticCurveTo(L + frame / 2, tileTop + frame / 2, L + rad, tileTop + frame / 2); o.stroke();
    o.beginPath(); o.moveTo(R - frame / 2, tileTop + rad); o.quadraticCurveTo(R - frame / 2, tileTop + frame / 2, R - rad, tileTop + frame / 2); o.stroke();
    const dy = (barTop + barBottom) / 2;
    [['#de6952', 0], ['#e2a759', 1], ['#62a098', 2]].forEach(([col, i]) => { o.fillStyle = col; o.beginPath(); o.arc(L + frame + 38 + i * 44, dy, 15, 0, Math.PI * 2); o.fill(); });
    // 5. Drop the artwork's soft shadow beside the right ear (grey, low-saturation pixels out there).
    const id = o.getImageData(0, 0, S, Math.ceil(tileTop - 14));
    for (let y = 0; y < id.height; y++) for (let x = 860; x < S; x++) {
      const i = (y * S + x) * 4, r = id.data[i], g = id.data[i + 1], b = id.data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40 && r < 200) id.data[i + 3] = 0;
    }
    o.putImageData(id, 0, 0);
    resolve({ logo: t.toDataURL('image/png').split(',')[1], icon: out.toDataURL('image/png').split(',')[1] });
  };
  img.src = src;
})`;

// Runs in the page: scales a PNG down to size by halving, so small sizes stay crisp.
const SCALE = String.raw`(src, size) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    let from = img, s = img.width;
    while (s / 2 >= size) {
      const h = document.createElement('canvas'); h.width = h.height = s / 2;
      const c = h.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(from, 0, 0, s / 2, s / 2);
      from = h; s /= 2;
    }
    const o = document.createElement('canvas'); o.width = o.height = size;
    const c = o.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(from, 0, 0, size, size);
    resolve(o.toDataURL('image/png').split(',')[1]);
  };
  img.src = src;
})`;

// Runs in the page: trims a transparent PNG to its drawing and scales it to a width.
const TRIM = String.raw`(src, width) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    let w = x1 - x0 + 1, h = y1 - y0 + 1;
    let from = document.createElement('canvas'); from.width = w; from.height = h;
    from.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
    while (w / 2 >= width) {
      const n = document.createElement('canvas'); n.width = Math.round(w / 2); n.height = Math.round(h / 2);
      const nc = n.getContext('2d'); nc.imageSmoothingQuality = 'high'; nc.drawImage(from, 0, 0, n.width, n.height);
      from = n; w = n.width; h = n.height;
    }
    const o = document.createElement('canvas'); o.width = width; o.height = Math.round(h * width / w);
    const oc = o.getContext('2d'); oc.imageSmoothingQuality = 'high'; oc.drawImage(from, 0, 0, o.width, o.height);
    resolve(o.toDataURL('image/png').split(',')[1]);
  };
  img.src = src;
})`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(', ')})`);
  const art = `data:image/png;base64,${fs.readFileSync(path.join(ASSETS, 'logo-source.png')).toString('base64')}`;
  const { logo, icon } = await run(COMPOSE, art);
  fs.writeFileSync(path.join(ASSETS, 'logo.png'), Buffer.from(logo, 'base64'));
  const iconUrl = `data:image/png;base64,${icon}`;
  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: Buffer.from(await run(SCALE, iconUrl, size), 'base64') });
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico(pngs));
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), Buffer.from(await run(SCALE, iconUrl, 512), 'base64'));
  const peek = `data:image/png;base64,${fs.readFileSync(path.join(ASSETS, 'peek-source.png')).toString('base64')}`;
  fs.writeFileSync(path.join(ASSETS, 'peek.png'), Buffer.from(await run(TRIM, peek, 360), 'base64'));
  console.log('Wrote assets/logo.png, icon.png, icon.ico and peek.png');
  app.exit(0);
}).catch((err) => { console.error(err); app.exit(1); });

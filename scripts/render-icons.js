// Renders the app icons from assets/icon.svg: assets/icon.ico (16-256 px, PNG entries) and assets/icon.png (512 px).
// Run after changing assets/icon.svg:  npx electron scripts/render-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

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

// Draws the SVG at 1024 px and halves it step by step, so small sizes come out crisp, then exports a PNG.
async function renderSvg(win, svgFile, size) {
  const url = `data:image/svg+xml;base64,${fs.readFileSync(svgFile).toString('base64')}`;
  const b64 = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Could not load the SVG'));
    img.onload = () => {
      let s = 1024;
      let src = document.createElement('canvas');
      src.width = src.height = s;
      src.getContext('2d').drawImage(img, 0, 0, s, s);
      while (s / 2 >= ${size}) {
        const half = document.createElement('canvas');
        half.width = half.height = s / 2;
        const ctx = half.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, s / 2, s / 2);
        src = half;
        s /= 2;
      }
      const out = document.createElement('canvas');
      out.width = out.height = ${size};
      const ctx = out.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, ${size}, ${size});
      resolve(out.toDataURL('image/png').split(',')[1]);
    };
    img.src = ${JSON.stringify(url)};
  })`);
  return Buffer.from(b64, 'base64');
}

app.whenReady().then(async () => {
  const assets = path.join(__dirname, '..', 'assets');
  const svg = path.join(assets, 'icon.svg');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: await renderSvg(win, svg, size) });
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico(pngs));
  fs.writeFileSync(path.join(assets, 'icon.png'), await renderSvg(win, svg, 512));
  console.log('Wrote assets/icon.ico and assets/icon.png');
  app.exit(0);
}).catch((err) => { console.error(err); app.exit(1); });

// Procedurally drawn canvas textures (no image assets).
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function speckle(g, w, h, n, cols, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.fillRect(Math.random() * w, Math.random() * h, size * Math.random() + 1, size * Math.random() + 1);
  }
}

const cache = {};
export function tex(name, opt = {}) {
  const key = name + JSON.stringify(opt);
  if (cache[key]) return cache[key];
  let t;
  switch (name) {
    case 'wall': {
      const base = opt.color || '#b8ab92';
      t = canvas(128, 96, (g, w, h) => {
        g.fillStyle = base; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 900, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)', 'rgba(80,60,40,0.08)'], 3);
        // stains
        for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(60,50,40,0.07)'; g.fillRect(Math.random() * w, 0, 6 + Math.random() * 12, h); }
        // window
        g.fillStyle = '#5a4a3a'; g.fillRect(44, 22, 40, 50);
        g.fillStyle = opt.ruined ? '#151515' : '#202830'; g.fillRect(48, 26, 32, 42);
        g.fillStyle = '#5a4a3a'; g.fillRect(63, 26, 3, 42); g.fillRect(48, 45, 32, 3);
        // shutters
        if (!opt.ruined) { g.fillStyle = opt.shutter || '#4d5f45'; g.fillRect(34, 24, 9, 46); g.fillRect(85, 24, 9, 46); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 3, w, 3);
      });
      break;
    }
    case 'roof':
      t = canvas(64, 64, (g, w, h) => {
        g.fillStyle = opt.color || '#7a3e2e'; g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, w, 2); for (let x = (y / 8) % 2 * 4; x < w; x += 8) g.fillRect(x, y, 1, 8); }
        speckle(g, w, h, 200, ['rgba(0,0,0,0.1)', 'rgba(255,255,255,0.05)']);
      });
      break;
    case 'sandbag':
      t = canvas(64, 32, (g, w, h) => {
        g.fillStyle = '#8f7f5c'; g.fillRect(0, 0, w, h);
        for (let r = 0; r < 4; r++) for (let c = -1; c < 4; c++) {
          const x = c * 20 + (r % 2) * 10, y = r * 8;
          g.fillStyle = r % 2 ? '#a39069' : '#9a8862';
          g.beginPath(); g.ellipse(x + 10, y + 4, 9.5, 3.6, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = 'rgba(40,30,20,0.4)'; g.stroke();
        }
      });
      break;
    case 'hedge':
      t = canvas(64, 64, (g, w, h) => {
        g.fillStyle = '#2f4424'; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 1400, ['#3c5a2c', '#26381c', '#4a6a34', '#1e2c16'], 4);
      });
      break;
    case 'concrete':
      t = canvas(64, 64, (g, w, h) => {
        g.fillStyle = '#8d8c86'; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 700, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.08)'], 2);
        g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 31, w, 1);
      });
      break;
    case 'wood':
      t = canvas(64, 64, (g, w, h) => {
        g.fillStyle = '#6b4f33'; g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, 0, 1, h); }
        speckle(g, w, h, 300, ['rgba(0,0,0,0.12)', 'rgba(255,220,180,0.06)'], 2);
      });
      break;
    case 'stone':
      t = canvas(64, 64, (g, w, h) => {
        g.fillStyle = '#6f6b62'; g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 11) for (let x = -10; x < w; x += 16) {
          g.fillStyle = `hsl(40,6%,${38 + Math.random() * 16}%)`;
          g.fillRect(x + (y % 22 ? 8 : 0), y, 14, 9);
        }
      });
      break;
    case 'ground':
      t = canvas(256, 256, (g, w, h) => {
        g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 9000, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.05)'], 3);
        for (let i = 0; i < 300; i++) { g.strokeStyle = 'rgba(0,0,0,0.08)'; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + Math.random() * 4 - 2, y - 6); g.stroke(); }
      });
      break;
    case 'bark':
      t = canvas(32, 64, (g, w, h) => {
        g.fillStyle = '#4a3a2a'; g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, 0, 1, h); }
      });
      break;
    case 'leaves':
      t = canvas(64, 64, (g, w, h) => {
        g.fillStyle = opt.color || '#3d5a2a'; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 900, ['rgba(0,0,0,0.25)', 'rgba(255,255,200,0.08)', 'rgba(0,0,0,0.12)'], 4);
      });
      break;
    case 'flag':
      t = canvas(64, 40, (g, w, h) => {
        g.fillStyle = opt.color; g.fillRect(0, 0, w, h);
        if (opt.emblem === 'star') {
          g.fillStyle = '#ffffff'; g.beginPath();
          for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 6 : 14; g.lineTo(32 + Math.cos(a) * r, 20 + Math.sin(a) * r); }
          g.fill();
        } else if (opt.emblem === 'cross') {
          g.fillStyle = '#fff'; g.fillRect(22, 8, 20, 24); g.fillStyle = '#111'; g.fillRect(29, 10, 6, 20); g.fillRect(24, 17, 16, 6);
        }
      });
      break;
  }
  cache[key] = t;
  return t;
}

// ---------------------------------------------------------------------------
// Photo textures (Poly Haven, CC0) with procedural fallback when unavailable.
// ---------------------------------------------------------------------------
const PHOTO = {};
const PHOTO_KEYS = ['plaster', 'brick', 'plasterstone', 'stonewall', 'roof', 'roof2', 'planks', 'concrete', 'bark', 'hessian', 'rust', 'grass', 'forest', 'dirt', 'sand', 'mud', 'snow', 'rock', 'fabric', 'leaves', 'cobble'];
let photoPromise = null;
export function loadPhotos(base = 'assets/tex/') {
  if (photoPromise) return photoPromise;
  const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  photoPromise = Promise.all(PHOTO_KEYS.map(async (k) => {
    const [diff, nor] = await Promise.all([load(`${base}${k}_diff.jpg`), load(`${base}${k}_nor.jpg`)]);
    if (diff) PHOTO[k] = { diff, nor };
  })).then(() => Object.keys(PHOTO).length);
  return photoPromise;
}
export const hasPhoto = (k) => !!PHOTO[k];

const pcache = {};
// Plain tiling photo texture. kind: 'diff' | 'nor'
export function photo(key, kind = 'diff', opt = {}) {
  const P = PHOTO[key]; if (!P || !P[kind]) return null;
  const ck = `${key}|${kind}|${JSON.stringify(opt)}`;
  if (pcache[ck]) return pcache[ck];
  let src = P[kind];
  if (opt.gray || opt.tint) {
    // grayscale/tinted copy so vertex colors can colourise it
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height); const a = d.data;
    let sum = 0; for (let i = 0; i < a.length; i += 4) sum += (a[i] + a[i + 1] + a[i + 2]) / 3;
    const mean = sum / (a.length / 4), gain = (opt.gray || 0.85) * 255 / mean, contrast = opt.contrast ?? 1;
    for (let i = 0; i < a.length; i += 4) {
      const l = (a[i] + a[i + 1] + a[i + 2]) / 3;
      const v = Math.max(0, Math.min(255, (255 * (opt.gray || 0.85)) + (l * gain - 255 * (opt.gray || 0.85)) * contrast));
      a[i] = a[i + 1] = a[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
    src = c;
  }
  const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (opt.repeat) t.repeat.set(opt.repeat, opt.repeat);
  pcache[ck] = t;
  return t;
}

// House wall bay (4 m x 3 m) from a photo surface with a window and shutters, plus matching normal map.
export function photoWall(key, opt = {}) {
  const P = PHOTO[key]; if (!P) return null;
  const ck = `wall|${key}|${JSON.stringify(opt)}`;
  if (pcache[ck]) return pcache[ck];
  const W = 512, H = 384, M = W / 4; // pixels per metre
  const scale = opt.metres || 2.5;   // metres covered by one photo tile
  const mk = (img, flat) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const s = scale * M;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) g.drawImage(img, x, y, s, s);
    return [c, g];
  };
  const [cd, gd] = mk(P.diff);
  // weathering streaks and a grimy base
  const grd = gd.createLinearGradient(0, H * 0.75, 0, H); grd.addColorStop(0, 'rgba(40,32,24,0)'); grd.addColorStop(1, 'rgba(40,32,24,0.35)');
  gd.fillStyle = grd; gd.fillRect(0, 0, W, H);
  // window: frame, recess, glass, glazing bars, shutters, sill
  const wx = 168, wy = 86, ww = 176, wh = 190;
  const ruined = opt.ruined;
  gd.fillStyle = 'rgba(0,0,0,0.35)'; gd.fillRect(wx - 6, wy - 6, ww + 12, wh + 14);             // recess shadow
  gd.fillStyle = '#5b4a38'; gd.fillRect(wx, wy, ww, wh);
  const glass = gd.createLinearGradient(wx, wy, wx + ww, wy + wh);
  glass.addColorStop(0, ruined ? '#0c0c0c' : '#3a4650'); glass.addColorStop(0.5, ruined ? '#141210' : '#1c252c'); glass.addColorStop(1, ruined ? '#0a0a0a' : '#2c3640');
  gd.fillStyle = glass; gd.fillRect(wx + 10, wy + 10, ww - 20, wh - 20);
  gd.fillStyle = '#4a3c2e'; gd.fillRect(wx + ww / 2 - 4, wy + 10, 8, wh - 20); gd.fillRect(wx + 10, wy + wh / 2 - 4, ww - 20, 8);
  if (!ruined) { gd.fillStyle = 'rgba(255,255,255,0.08)'; gd.beginPath(); gd.moveTo(wx + 14, wy + 14); gd.lineTo(wx + 60, wy + 14); gd.lineTo(wx + 14, wy + 80); gd.fill(); }
  gd.fillStyle = '#8a8378'; gd.fillRect(wx - 12, wy + wh, ww + 24, 12);                             // sill
  if (!ruined && PHOTO.planks) {
    for (const sx of [wx - 50, wx + ww + 4]) {
      gd.save(); gd.beginPath(); gd.rect(sx, wy, 46, wh); gd.clip();
      gd.drawImage(PHOTO.planks.diff, sx, wy, 46, wh);
      gd.fillStyle = opt.shutter || 'rgba(70,95,60,0.6)'; gd.globalAlpha = 0.65; gd.fillRect(sx, wy, 46, wh);
      gd.restore();
    }
  }
  const [cn, gn] = mk(P.nor);
  gn.fillStyle = 'rgb(128,128,255)'; gn.fillRect(wx + 10, wy + 10, ww - 20, wh - 20);               // flat glass
  gn.fillStyle = 'rgb(70,128,225)'; gn.fillRect(wx, wy, 10, wh);                                     // frame bevels
  gn.fillStyle = 'rgb(186,128,225)'; gn.fillRect(wx + ww - 10, wy, 10, wh);
  gn.fillStyle = 'rgb(128,186,225)'; gn.fillRect(wx, wy, ww, 10);
  gn.fillStyle = 'rgb(128,70,225)'; gn.fillRect(wx - 12, wy + wh, ww + 24, 12);
  const out = { map: new THREE.CanvasTexture(cd), normalMap: new THREE.CanvasTexture(cn) };
  for (const t of [out.map, out.normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  out.map.colorSpace = THREE.SRGBColorSpace;
  pcache[ck] = out;
  return out;
}

// Soft, lumpy smoke puff for particles.
export function puffTexture() {
  if (pcache.puff) return pcache.puff;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 26;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, s = 14 + Math.random() * 24;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    grd.addColorStop(0, 'rgba(255,255,255,0.11)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  pcache.puff = t;
  return t;
}

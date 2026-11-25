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

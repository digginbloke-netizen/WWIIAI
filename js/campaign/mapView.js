// Canvas renderer for the strategic map.
import { MAP_W, MAP_H, REGIONS, TERRAIN_INFO } from './data.js';
import { getGeo, CELL, GW, GH } from './geo.js';
import { makeNoise2D } from '../util.js';

const COL = {
  sea: [78, 104, 118],
  allies: [122, 140, 88],
  axis: [134, 128, 124],
  reich: [118, 110, 108],
  eng: [110, 128, 80],
};

export class MapView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = MAP_W; this.base.height = MAP_H;
    this.baseKey = '';
    this.hover = -1;
    this.selected = -1;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.t = 0;
    this.paper = this._makePaper();
  }

  _makePaper() {
    const c = document.createElement('canvas'); c.width = MAP_W; c.height = MAP_H;
    const x = c.getContext('2d');
    const img = x.createImageData(MAP_W, MAP_H);
    const n = makeNoise2D(7);
    for (let y = 0; y < MAP_H; y++) for (let i = 0; i < MAP_W; i++) {
      const v = n.fbm(i * 0.02, y * 0.02, 4) * 18 + (Math.random() - 0.5) * 10;
      const k = (y * MAP_W + i) * 4;
      img.data[k] = 128 + v; img.data[k + 1] = 128 + v; img.data[k + 2] = 128 + v; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  _rebuildBase(state, supply) {
    const geo = getGeo();
    const key = state.regions.map((r) => r.owner[1]).join('') + supply.map((v) => (v ? 1 : 0)).join('');
    if (key === this.baseKey) return;
    this.baseKey = key;
    const ctx = this.base.getContext('2d');
    const img = ctx.createImageData(MAP_W, MAP_H);
    const d = img.data;
    const g = geo.grid;
    for (let y = 0; y < MAP_H; y++) {
      const gy = Math.min(GH - 1, Math.floor(y / CELL));
      for (let x = 0; x < MAP_W; x++) {
        const gx = Math.min(GW - 1, Math.floor(x / CELL));
        const id = g[gy * GW + gx];
        let c;
        if (id < 0) c = COL.sea;
        else if (REGIONS[id].hq) c = COL.eng;
        else c = state.regions[id].owner === 'allies' ? COL.allies : (REGIONS[id].homeland ? COL.reich : COL.axis);
        let shade = 1;
        if (id >= 0) {
          // borders
          const right = gx + 1 < GW ? g[gy * GW + gx + 1] : id;
          const down = gy + 1 < GH ? g[(gy + 1) * GW + gx] : id;
          const left = gx > 0 ? g[gy * GW + gx - 1] : id;
          const up = gy > 0 ? g[(gy - 1) * GW + gx] : id;
          const edge = (x % CELL === CELL - 1 && right !== id) || (y % CELL === CELL - 1 && down !== id) || (x % CELL === 0 && left !== id) || (y % CELL === 0 && up !== id);
          if (edge) {
            const other = [right, down, left, up].find((o) => o !== id);
            const front = other >= 0 && state.regions[other].owner !== state.regions[id].owner && !REGIONS[other].hq && !REGIONS[id].hq;
            shade = front ? 0.35 : (other < 0 ? 0.6 : 0.75);
          }
          if (!supply[id] && !REGIONS[id].hq && ((x + y) % 10 < 2)) shade *= 0.8; // hatch unsupplied
        } else {
          // sea wave texture
          if ((x * 3 + y * 7) % 23 === 0) shade = 1.08;
        }
        const k = (y * MAP_W + x) * 4;
        d[k] = c[0] * shade; d[k + 1] = c[1] * shade; d[k + 2] = c[2] * shade; d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // front line: every grid edge where Allied and German land meet
    this.frontSegs = [];
    const own = (id) => (id < 0 || REGIONS[id].hq ? null : state.regions[id].owner);
    for (let gy = 0; gy < GH - 1; gy++) for (let gx = 0; gx < GW - 1; gx++) {
      const a0 = own(g[gy * GW + gx]); if (!a0) continue;
      const ar = own(g[gy * GW + gx + 1]), ad = own(g[(gy + 1) * GW + gx]);
      if (ar && ar !== a0) this.frontSegs.push([(gx + 1) * CELL, gy * CELL, (gx + 1) * CELL, (gy + 1) * CELL]);
      if (ad && ad !== a0) this.frontSegs.push([gx * CELL, (gy + 1) * CELL, (gx + 1) * CELL, (gy + 1) * CELL]);
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.35;
    ctx.drawImage(this.paper, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.dpr = dpr;
    this.scale = Math.min(this.canvas.width / MAP_W, this.canvas.height / MAP_H);
    this.ox = (this.canvas.width - MAP_W * this.scale) / 2;
    this.oy = (this.canvas.height - MAP_H * this.scale) / 2;
  }

  toMap(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) * this.dpr - this.ox) / this.scale;
    const y = ((clientY - r.top) * this.dpr - this.oy) / this.scale;
    return [x, y];
  }

  regionAt(clientX, clientY) {
    const [x, y] = this.toMap(clientX, clientY);
    // prefer marker hit
    for (let i = 0; i < REGIONS.length; i++) if (Math.hypot(REGIONS[i].x - x, REGIONS[i].y - y) < 16) return i;
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return -1;
    return getGeo().grid[gy * GW + gx];
  }

  draw(state, supply, extra = {}) {
    this._rebuildBase(state, supply);
    this.t += 1 / 60;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2b2a25';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    ctx.drawImage(this.base, 0, 0);
    const geo = getGeo();

    // highlight selected / hover region outline via cell fill
    const hl = (id, color) => {
      if (id < 0) return;
      ctx.fillStyle = color;
      const g = geo.grid;
      for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) if (g[gy * GW + gx] === id) ctx.fillRect(gx * CELL, gy * CELL, CELL, CELL);
    };
    if (this.hover >= 0 && this.hover !== this.selected) hl(this.hover, 'rgba(255,255,220,0.12)');
    if (this.selected >= 0) hl(this.selected, `rgba(255,230,120,${0.2 + 0.08 * Math.sin(this.t * 4)})`);
    if (extra.targets && extra.targets.length) {
      // one pass over the grid for every highlighted sector
      const set = new Set(extra.targets), g = geo.grid;
      ctx.fillStyle = `rgba(220,60,40,${0.14 + 0.05 * Math.sin(this.t * 3)})`;
      for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) if (set.has(g[gy * GW + gx])) ctx.fillRect(gx * CELL, gy * CELL, CELL, CELL);
    }

    // sea lanes
    ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(230,230,210,0.5)';
    for (const [a, b] of geo.seaLinks) {
      ctx.beginPath(); ctx.moveTo(REGIONS[a].x, REGIONS[a].y); ctx.lineTo(REGIONS[b].x, REGIONS[b].y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // the front line
    if (this.frontSegs && this.frontSegs.length) {
      for (const [w, col] of [[5, 'rgba(255,230,200,0.35)'], [2.4, 'rgba(150,25,20,0.95)']]) {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath();
        for (const [x1, y1, x2, y2] of this.frontSegs) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
        ctx.stroke();
      }
    }
    // board missions and strategic targets
    if (extra.board) extra.board.forEach((m, k) => {
      const R = REGIONS[m.region];
      const x = R.x + 16, y = R.y - 16 - (k % 2) * 3;
      ctx.fillStyle = 'rgba(255,208,74,0.95)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#2a2010'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k + 1), x, y + 0.5);
    });
    if (extra.strategic) for (const t of extra.strategic) {
      if (state.regions[t.region].owner !== 'axis') continue;
      const R = REGIONS[t.region], off = t.type === 'factory' ? -14 : t.type === 'railyard' ? 0 : 14;
      const x = R.x + off, y = R.y + 22;
      ctx.fillStyle = t.status === 'ok' ? 'rgba(60,55,50,0.85)' : 'rgba(150,40,30,0.9)';
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = '#eee'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.status === 'ok' ? (t.type === 'factory' ? 'F' : t.type === 'railyard' ? 'R' : 'P') : '✕', x, y + 0.5);
    }
    // arrows: planned orders & battles
    const arrow = (a, b, color, w = 5, dash = false) => {
      const A = REGIONS[a], B = REGIONS[b];
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L;
      const sx = A.x + ux * 14, sy = A.y + uy * 14, ex = B.x - ux * 18, ey = B.y - uy * 18;
      const mx = (sx + ex) / 2 - uy * L * 0.12, my = (sy + ey) / 2 + ux * L * 0.12;
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
      if (dash) ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(ey - my, ex - mx);
      ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ang) * 8, ey + Math.sin(ang) * 8);
      ctx.lineTo(ex + Math.cos(ang + 2.4) * 11, ey + Math.sin(ang + 2.4) * 11);
      ctx.lineTo(ex + Math.cos(ang - 2.4) * 11, ey + Math.sin(ang - 2.4) * 11);
      ctx.fill();
    };
    for (const o of state.orders) arrow(o.from, o.to, 'rgba(40,90,170,0.9)');
    for (const b of state.battles) {
      if (b.resolved) continue;
      arrow(b.from, b.to, b.attacker === 'allies' ? 'rgba(40,90,170,0.9)' : 'rgba(170,30,30,0.9)', 5, true);
    }

    // markers
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    REGIONS.forEach((r, i) => {
      const st = state.regions[i];
      const ally = st.owner === 'allies';
      const R = r.capital ? 13 : 11;
      // unit counter: infantry symbol box with strength
      const w = 24, h = 16;
      ctx.fillStyle = ally ? '#2f4f8a' : '#4a3c36';
      ctx.fillRect(r.x - w / 2, r.y - h / 2, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(r.x - w / 2, r.y - h / 2); ctx.lineTo(r.x + w / 2, r.y + h / 2); ctx.moveTo(r.x + w / 2, r.y - h / 2); ctx.lineTo(r.x - w / 2, r.y + h / 2); ctx.stroke();
      ctx.lineWidth = i === this.selected ? 3 : 1.5;
      ctx.strokeStyle = i === this.selected ? '#ffd76a' : (ally ? '#c9d8ff' : '#d9c8b8');
      ctx.strokeRect(r.x - w / 2, r.y - h / 2, w, h);
      if (r.capital) { ctx.strokeStyle = '#d8b14a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(r.x, r.y, R + 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#f3ecd8';
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillText(String(st.troops), r.x, r.y + 0.5);
      // fort pips
      for (let k = 0; k < st.fort; k++) { ctx.fillStyle = '#e0c070'; ctx.fillRect(r.x - 7 + k * 5, r.y + R + 2, 4, 3); }
      // name
      ctx.font = '600 10px Georgia, serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(30,28,22,0.75)';
      const ny = r.y - R - 8;
      ctx.strokeText(r.name, r.x, ny); ctx.fillStyle = '#f1e6c8'; ctx.fillText(r.name, r.x, ny);
      ctx.font = '11px serif'; ctx.fillStyle = 'rgba(30,25,20,0.8)';
      ctx.fillText(TERRAIN_INFO[r.terrain].icon, r.x + R + 7, r.y + 1);
      if (r.port) { ctx.fillStyle = 'rgba(20,40,70,0.8)'; ctx.fillText('⚓', r.x - R - 7, r.y + 1); }
    });
    // compass / legend
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

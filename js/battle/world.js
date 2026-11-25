// Procedural battlefield: terrain, structures, collision, line of sight and navigation.
import * as THREE from 'three';
import { mulberry32, makeNoise2D, clamp } from '../util.js';
import { tex } from './textures.js';
import * as M from './models.js';

export const HALF = 118;      // playable half-extent (m)
const EXT = 200;              // terrain half-extent
const HS = 2;                 // height grid spacing
const HN = (EXT * 2) / HS + 1;
const CS = 8;                 // spatial hash cell
const CN = Math.ceil((EXT * 2) / CS);
export const NAV = 2;         // nav cell size
export const NN = Math.ceil((HALF * 2) / NAV);

// --- geometry batching (one draw call per material) ---
class Batch {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; this.n = 0; }
  quad(a, b, c, d, n, uvs) {
    const s = this.n;
    for (const p of [a, b, c, d]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); }
    for (const u of uvs) this.uv.push(u[0], u[1]);
    this.idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
    this.n += 4;
  }
  tri(a, b, c, uvs) {
    const s = this.n;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const l = Math.hypot(...n) || 1;
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0] / l, n[1] / l, n[2] / l); }
    for (const u of uvs) this.uv.push(u[0], u[1]);
    this.idx.push(s, s + 1, s + 2);
    this.n += 3;
  }
  // world-scaled UV box; us = horizontal meters per texture repeat, vs = vertical
  box(x0, y0, z0, x1, y1, z1, us = 4, vs = 3, top = true) {
    const W = (x1 - x0) / us, D = (z1 - z0) / us, H = (y1 - y0) / vs;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[0, 0], [W, 0], [W, H], [0, H]]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[0, 0], [W, 0], [W, H], [0, H]]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[0, 0], [D, 0], [D, H], [0, H]]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[0, 0], [D, 0], [D, H], [0, H]]);
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[0, 0], [W, 0], [W, D], [0, D]]);
  }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

export class World {
  constructor(scene, cfg) {
    this.scene = scene;
    this.cfg = cfg;
    this.rng = mulberry32(cfg.seed || 1);
    this.noise = makeNoise2D(cfg.seed || 1);
    this.obstacles = [];
    this.cells = Array.from({ length: CN * CN }, () => []);
    this.stamp = 1;
    this.coverPts = [];
    this.batches = {};
    this.trees = [];
    this.bushes = [];
    this.clear = [];
    this.water = cfg.terrain === 'beach';
    this.attSign = 1; // attacker spawns at +z
    this._buildHeights();
    this._layout();
    this._buildTerrainMesh();
    this._buildMeshes();
    this._buildNav();
  }

  // ---------- height ----------
  _rawH(x, z) {
    const t = this.cfg.terrain, n = this.noise;
    let h = n.fbm(x * 0.011, z * 0.011, 4) * 3.2 + n(x * 0.05, z * 0.05) * 0.4;
    if (t === 'hills') h = n.fbm(x * 0.009, z * 0.009, 5) * 11 + n(x * 0.04, z * 0.04) * 0.8 + 3;
    if (t === 'forest') h = n.fbm(x * 0.012, z * 0.012, 4) * 5;
    if (t === 'city' || t === 'town') h *= 0.4;
    if (t === 'beach') {
      // inland plateau at -z, bluff around z=25, sand to waterline at z=92
      const inland = n.fbm(x * 0.012, z * 0.012, 3) * 2 + 7;
      const s = clamp((z - 15) / 25, 0, 1);
      const bluff = inland * (1 - s * s * (3 - 2 * s));
      const sand = clamp((92 - z) / 60, 0, 1) * 1.6 - 0.6;
      h = Math.max(bluff, sand) + n(x * 0.06, z * 0.06) * 0.25;
      if (z > 92) h = -0.7 - (z - 92) * 0.02;
    }
    // edges rise slightly to frame the battlefield
    const e = Math.max(Math.abs(x), Math.abs(z)) - HALF;
    if (e > 0 && !(t === 'beach' && z > 0)) h += e * 0.12;
    return h;
  }
  _buildHeights() {
    this.hgrid = new Float32Array(HN * HN);
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) this.hgrid[j * HN + i] = this._rawH(-EXT + i * HS, -EXT + j * HS);
  }
  H(x, z) {
    const fx = (x + EXT) / HS, fz = (z + EXT) / HS;
    const i = clamp(Math.floor(fx), 0, HN - 2), j = clamp(Math.floor(fz), 0, HN - 2);
    const u = clamp(fx - i, 0, 1), v = clamp(fz - j, 0, 1);
    const g = this.hgrid;
    const a = g[j * HN + i], b = g[j * HN + i + 1], c = g[(j + 1) * HN + i], d = g[(j + 1) * HN + i + 1];
    // match PlaneGeometry triangle split
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  flatten(x, z, r, y) {
    const r2 = (r + 6) * (r + 6);
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
      const px = -EXT + i * HS, pz = -EXT + j * HS;
      const d = Math.sqrt((px - x) ** 2 + (pz - z) ** 2);
      if (d * d > r2) continue;
      const t = clamp((d - r) / 6, 0, 1);
      const k = j * HN + i;
      this.hgrid[k] = y + (this.hgrid[k] - y) * t;
    }
  }

  // ---------- obstacles ----------
  addObstacle(o) {
    o.id = this.obstacles.length;
    o.st = 0;
    this.obstacles.push(o);
    let x0, x1, z0, z1;
    if (o.type === 'box') { x0 = o.x0; x1 = o.x1; z0 = o.z0; z1 = o.z1; }
    else { x0 = o.x - o.r; x1 = o.x + o.r; z0 = o.z - o.r; z1 = o.z + o.r; }
    const ci0 = clamp(Math.floor((x0 + EXT) / CS), 0, CN - 1), ci1 = clamp(Math.floor((x1 + EXT) / CS), 0, CN - 1);
    const cj0 = clamp(Math.floor((z0 + EXT) / CS), 0, CN - 1), cj1 = clamp(Math.floor((z1 + EXT) / CS), 0, CN - 1);
    for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) this.cells[j * CN + i].push(o);
    return o;
  }
  isClear(x, z, r) {
    for (const c of this.clear) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + r) ** 2) return false;
    return true;
  }
  boxFree(x0, z0, x1, z1, pad = 0.5) {
    const ci0 = clamp(Math.floor((x0 - pad + EXT) / CS), 0, CN - 1), ci1 = clamp(Math.floor((x1 + pad + EXT) / CS), 0, CN - 1);
    const cj0 = clamp(Math.floor((z0 - pad + EXT) / CS), 0, CN - 1), cj1 = clamp(Math.floor((z1 + pad + EXT) / CS), 0, CN - 1);
    for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) for (const o of this.cells[j * CN + i]) {
      if (o.type === 'box') { if (o.x0 < x1 + pad && o.x1 > x0 - pad && o.z0 < z1 + pad && o.z1 > z0 - pad) return false; }
      else if (o.x + o.r > x0 - pad && o.x - o.r < x1 + pad && o.z + o.r > z0 - pad && o.z - o.r < z1 + pad) return false;
    }
    return true;
  }
  batch(name) { return this.batches[name] || (this.batches[name] = new Batch()); }

  // Solid axis-aligned box sitting on terrain. Returns obstacle.
  solid(mat, x0, z0, x1, z1, height, opt = {}) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const hs = [this.H(x0, z0), this.H(x1, z0), this.H(x0, z1), this.H(x1, z1), this.H((x0 + x1) / 2, (z0 + z1) / 2)];
    const base = opt.base !== undefined ? opt.base : Math.min(...hs) - 0.4;
    const top = (opt.top !== undefined ? opt.top : Math.max(...hs) + height);
    this.batch(mat).box(x0, base, z0, x1, top, z1, opt.us || 4, opt.vs || 3);
    const o = this.addObstacle({ type: 'box', x0, x1, z0, z1, y0: base, y1: top, mat });
    if (opt.cover !== false) this._coverAround(o);
    return o;
  }
  _coverAround(o) {
    const h = o.y1 - Math.max(this.H(o.x0, o.z0), this.H(o.x1, o.z1));
    if (h < 0.8) return;
    const off = 0.75;
    const push = (x, z, nx, nz) => { if (Math.abs(x) < HALF && Math.abs(z) < HALF) this.coverPts.push({ x, z, nx, nz, low: h < 1.6, occ: null }); };
    for (let x = o.x0 + 0.8; x <= o.x1 - 0.8; x += 3) { push(x, o.z0 - off, 0, -1); push(x, o.z1 + off, 0, 1); }
    for (let z = o.z0 + 0.8; z <= o.z1 - 0.8; z += 3) { push(o.x0 - off, z, -1, 0); push(o.x1 + off, z, 1, 0); }
  }

  // ---------- structures ----------
  house(cx, cz, w, d, floors, style = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    if (!this.boxFree(x0, z0, x1, z1, 1.5)) return false;
    const hs = [this.H(x0, z0), this.H(x1, z0), this.H(x0, z1), this.H(x1, z1)];
    const floor = Math.max(...hs), base = Math.min(...hs) - 0.6;
    const ruined = style.ruined;
    const wallMat = style.wall || 'wall';
    if (ruined) {
      // broken shell: irregular wall heights + rubble
      const top = floor + floors * 3 * (0.45 + this.rng() * 0.4);
      this.batch(wallMat).box(x0, base, z0, x1, top, z1, 4, 3);
      this._coverAround(this.addObstacle({ type: 'box', x0, x1, z0, z1, y0: base, y1: top }));
      this.batch('rubble').box(x0 + 0.5, top, z0 + 0.5, x1 - 0.5, top + 0.4, z1 - 0.5, 4, 4);
      const tall = this.rng() < 0.5;
      if (tall) {
        const sx = this.rng() < 0.5 ? x0 : x1 - 1;
        this.batch(wallMat).box(sx, top, z0, sx + 1, top + 2 + this.rng() * 3, z0 + d * 0.6, 4, 3);
      }
      for (let k = 0; k < 3; k++) {
        const rx = cx + (this.rng() - 0.5) * (w + 4), rz = cz + (this.rng() < 0.5 ? -1 : 1) * (d / 2 + 1.5);
        if (this.boxFree(rx - 1, rz - 0.8, rx + 1, rz + 0.8, 0.2)) this.solid('rubble', rx - 1.2, rz - 0.8, rx + 1.2, rz + 0.8, 0.9 + this.rng() * 0.5, { us: 3, vs: 2 });
      }
    } else {
      const top = floor + floors * 3;
      this.batch(wallMat).box(x0, base, z0, x1, top, z1, 4, 3, !style.gable);
      this._coverAround(this.addObstacle({ type: 'box', x0, x1, z0, z1, y0: base, y1: top + (style.gable === false ? 0 : 2.2) }));
      if (style.gable !== false) {
        const rb = this.batch(style.roof || 'roof');
        const rh = 2.2, ov = 0.4;
        if (w >= d) {
          const zm = cz;
          const a = [x0 - ov, top, z0 - ov], b = [x1 + ov, top, z0 - ov], c = [x1 + ov, top + rh, zm], dd = [x0 - ov, top + rh, zm];
          const e = [x0 - ov, top, z1 + ov], f = [x1 + ov, top, z1 + ov];
          rb.quad(a, dd, c, b, [0, 0.7, -0.7], [[0, 0], [0, 2], [w / 2, 2], [w / 2, 0]]);
          rb.quad(f, c, dd, e, [0, 0.7, 0.7], [[0, 0], [0, 2], [w / 2, 2], [w / 2, 0]]);
          this.batch(wallMat).tri([x0, top, z1], [x0, top + rh, zm], [x0, top, z0], [[0, 0], [d / 8, 0.7], [d / 4, 0]]);
          this.batch(wallMat).tri([x1, top, z0], [x1, top + rh, zm], [x1, top, z1], [[0, 0], [d / 8, 0.7], [d / 4, 0]]);
        } else {
          const xm = cx;
          const a = [x0 - ov, top, z1 + ov], b = [x0 - ov, top, z0 - ov], c = [xm, top + rh, z0 - ov], dd = [xm, top + rh, z1 + ov];
          const e = [x1 + ov, top, z0 - ov], f = [x1 + ov, top, z1 + ov];
          rb.quad(a, dd, c, b, [-0.7, 0.7, 0], [[0, 0], [0, 2], [d / 2, 2], [d / 2, 0]]);
          rb.quad(e, c, dd, f, [0.7, 0.7, 0], [[0, 0], [0, 2], [d / 2, 2], [d / 2, 0]]);
          this.batch(wallMat).tri([x0, top, z0], [xm, top + rh, z0], [x1, top, z0], [[0, 0], [w / 8, 0.7], [w / 4, 0]]);
          this.batch(wallMat).tri([x1, top, z1], [xm, top + rh, z1], [x0, top, z1], [[0, 0], [w / 8, 0.7], [w / 4, 0]]);
        }
      }
    }
    return true;
  }

  sandbagWall(x, z, len, alongX, height = 1.1) {
    const hw = 0.35;
    if (alongX) return this.boxFree(x - len / 2, z - hw, x + len / 2, z + hw, 0.2) && this.solid('sandbag', x - len / 2, z - hw, x + len / 2, z + hw, height, { us: 2, vs: 1 });
    return this.boxFree(x - hw, z - len / 2, x + hw, z + len / 2, 0.2) && this.solid('sandbag', x - hw, z - len / 2, x + hw, z + len / 2, height, { us: 2, vs: 1 });
  }
  // ring of sandbags with gaps (foxhole / strongpoint)
  strongpoint(x, z, r) {
    const L = r * 1.1;
    this.sandbagWall(x, z - r, L, true);
    this.sandbagWall(x, z + r, L, true);
    this.sandbagWall(x - r, z, L, false);
    this.sandbagWall(x + r, z, L, false);
  }
  bunker(x, z, faceSign) {
    const w = 7, d = 5;
    if (!this.boxFree(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 1)) return;
    const g = this.H(x, z);
    // two halves leaving an embrasure slit
    this.solid('concrete', x - w / 2, z - d / 2, x + w / 2, z + d / 2, 1.2, { top: g + 1.25, us: 3, vs: 3 });
    this.batch('concrete').box(x - w / 2, g + 1.9, z - d / 2, x + w / 2, g + 2.8, z + d / 2, 3, 3);
    this.addObstacle({ type: 'box', x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: g + 1.9, y1: g + 2.8 });
    this.batch('concrete').box(x - w / 2, g + 1.2, z - d / 2 - faceSign * 0, x - w / 2 + 0.6, g + 1.9, z + d / 2, 3, 3);
    this.batch('concrete').box(x + w / 2 - 0.6, g + 1.2, z - d / 2, x + w / 2, g + 1.9, z + d / 2, 3, 3);
    this.addObstacle({ type: 'box', x0: x - w / 2, x1: x - w / 2 + 0.6, z0: z - d / 2, z1: z + d / 2, y0: g + 1.2, y1: g + 1.9 });
    this.addObstacle({ type: 'box', x0: x + w / 2 - 0.6, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: g + 1.2, y1: g + 1.9 });
  }
  hedgehog(x, z) {
    if (!this.boxFree(x - 0.8, z - 0.8, x + 0.8, z + 0.8, 0.5)) return;
    const y = this.H(x, z);
    this.hedgehogs.push([x, y, z, this.rng() * Math.PI]);
    this.addObstacle({ type: 'box', x0: x - 0.7, x1: x + 0.7, z0: z - 0.7, z1: z + 0.7, y0: y - 0.2, y1: y + 1.2 });
  }
  wreck(x, z) {
    if (!this.boxFree(x - 3.5, z - 3.5, x + 3.5, z + 3.5, 0.8) || !this.isClear(x, z, 4)) return;
    const along = this.rng() < 0.5;
    const L = 3.2, W = 1.6;
    const o = along ? this.solid('wreck', x - L, z - W, x + L, z + W, 1.4, { us: 3, vs: 3 }) : this.solid('wreck', x - W, z - L, x + W, z + L, 1.4, { us: 3, vs: 3 });
    this.wrecks.push({ x, z, along, y: this.H(x, z) });
    o.y1 += 0.6;
  }
  tree(x, z, kind, scale = 1) {
    if (!this.isClear(x, z, 2)) return;
    const y = this.H(x, z);
    this.trees.push({ x, y, z, kind, s: scale * (0.8 + this.rng() * 0.5), rot: this.rng() * 6 });
    this.addObstacle({ type: 'cyl', x, z, r: 0.3 * scale, y0: y - 1, y1: y + 6 * scale });
  }

  // ---------- layout per terrain ----------
  _layout() {
    const r = this.rng, t = this.cfg.terrain;
    this.hedgehogs = []; this.barrels = []; this.wrecks = [];
    const A = this.attSign;
    // flags (A nearest attacker)
    const fx = () => (r() - 0.5) * 60;
    this.flags = [
      { letter: 'A', x: fx(), z: 42 * A },
      { letter: 'B', x: fx() * 0.7, z: 0 },
      { letter: 'C', x: fx(), z: -45 * A },
    ];
    if (t === 'beach') { this.flags[0].z = 32; this.flags[0].x = fx() * 0.5; this.flags[1].z = -8; }
    this.spawns = {
      att: { x: (r() - 0.5) * 30, z: 106 * A },
      def: { x: (r() - 0.5) * 30, z: -106 * A },
    };
    for (const f of this.flags) {
      f.radius = 11;
      this.clear.push({ x: f.x, z: f.z, r: 7 });
      if (t !== 'beach' || f.letter !== 'A') this.flatten(f.x, f.z, 9, this.H(f.x, f.z));
    }
    this.clear.push({ x: this.spawns.att.x, z: this.spawns.att.z, r: 14 }, { x: this.spawns.def.x, z: this.spawns.def.z, r: 14 });

    const gen = { town: () => this._town(false), city: () => this._town(true), farmland: () => this._farm(), forest: () => this._forest(), hills: () => this._hills(), beach: () => this._beach() }[t];
    (gen || (() => this._farm()))();

    // flag strongpoints (defender fortifications scale with fort level)
    const fort = this.cfg.fort || 0;
    this.flags.forEach((f, i) => {
      const s = (r() < 0.5 ? 1 : -1);
      this.sandbagWall(f.x + 5 * s, f.z + 6 * A, 5, true);
      this.sandbagWall(f.x - 6 * s, f.z - 2, 4, false);
      if (fort >= 1) this.sandbagWall(f.x - 3 * s, f.z + 9 * A, 6, true);
      if (fort >= 2 && i > 0) this.strongpoint(f.x + 14 * s, f.z + 6 * A, 3);
      if (fort >= 3 && i > 0) this.bunker(f.x - 12 * s, f.z + 12 * A, A);
    });
    // scattered wrecks and cover in the open
    const nw = 3 + Math.floor(r() * 4);
    for (let k = 0; k < nw; k++) this.wreck((r() - 0.5) * 180, (r() - 0.5) * 180);
    for (let k = 0; k < 30; k++) {
      const x = (r() - 0.5) * 220, z = (r() - 0.5) * 200;
      if (this.isClear(x, z, 3)) this.sandbagWall(x, z, 3 + r() * 3, r() < 0.5, 1.0);
    }
    // perimeter forest for the horizon
    for (let k = 0; k < 500; k++) {
      const a = r() * Math.PI * 2, d = 128 + r() * 60;
      const x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d * 1.1;
      if (Math.abs(x) < HALF + 6 && Math.abs(z) < HALF + 6) continue;
      if (t === 'beach' && z > 80) continue;
      this.tree(clamp(x, -EXT + 5, EXT - 5), clamp(z, -EXT + 5, EXT - 5), r() < 0.5 ? 'pine' : 'oak', 1.1);
    }
  }

  _town(city) {
    const r = this.rng;
    const block = city ? 26 : 30;
    const ruinP = city ? 0.45 : 0.2;
    const wallCols = ['wall', 'wall2', 'wall3'];
    for (let bx = -HALF + 10; bx < HALF - 10; bx += block) {
      for (let bz = -HALF + 16; bz < HALF - 16; bz += block) {
        // block interior has houses along its edges
        const cx = bx + block / 2, cz = bz + block / 2;
        if (!this.isClear(cx, cz, 6) && r() < 0.8) continue;
        if (r() < (city ? 0.1 : 0.25)) { // open lot / park
          for (let k = 0; k < 3; k++) this.tree(cx + (r() - 0.5) * 14, cz + (r() - 0.5) * 14, 'oak');
          continue;
        }
        const n = city ? 4 : 2 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const w = 6 + Math.floor(r() * 3) * 2, d = 6 + Math.floor(r() * 2) * 2;
          const side = k % 4;
          const inset = 3.5;
          let hx = cx, hz = cz;
          if (side === 0) { hz = bz + inset + d / 2; hx = bx + 4 + w / 2 + r() * (block - w - 8); }
          if (side === 1) { hz = bz + block - inset - d / 2; hx = bx + 4 + w / 2 + r() * (block - w - 8); }
          if (side === 2) { hx = bx + inset + w / 2; hz = bz + 4 + d / 2 + r() * (block - d - 8); }
          if (side === 3) { hx = bx + block - inset - w / 2; hz = bz + 4 + d / 2 + r() * (block - d - 8); }
          if (!this.isClear(hx, hz, Math.max(w, d) / 2 + 2)) continue;
          const floors = city ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
          this.house(hx, hz, w, d, floors, { ruined: r() < ruinP, wall: wallCols[Math.floor(r() * 3)], gable: city ? r() < 0.3 : true, roof: r() < 0.5 ? 'roof' : 'roof2' });
        }
      }
    }
    // barricades in streets
    for (let k = 0; k < (city ? 25 : 14); k++) {
      const x = (r() - 0.5) * 210, z = (r() - 0.5) * 190;
      if (this.isClear(x, z, 3)) {
        if (r() < 0.5) this.sandbagWall(x, z, 4, r() < 0.5);
        else if (this.boxFree(x - 1.5, z - 1, x + 1.5, z + 1)) this.solid('rubble', x - 1.5, z - 1, x + 1.5, z + 1, 1.2, { us: 3, vs: 2 });
      }
    }
  }

  _farm() {
    const r = this.rng;
    // bocage hedgerows on a jittered grid with gaps
    const step = 34;
    for (let z = -HALF + 20; z < HALF - 10; z += step + (r() - 0.5) * 8) {
      let x = -HALF;
      while (x < HALF) {
        const len = 12 + r() * 26;
        const x1 = Math.min(HALF, x + len);
        this._hedgeSeg(x, z, x1, z);
        x = x1 + 6 + r() * 6;
      }
    }
    for (let x = -HALF + 18; x < HALF - 10; x += step + 6 + (r() - 0.5) * 10) {
      let z = -HALF;
      while (z < HALF) {
        const len = 10 + r() * 22;
        const z1 = Math.min(HALF, z + len);
        this._hedgeSeg(x, z, x, z1);
        z = z1 + 7 + r() * 6;
      }
    }
    // farmhouses near flags
    for (const f of this.flags) {
      for (let k = 0; k < 3; k++) {
        const a = r() * Math.PI * 2, d = 16 + r() * 10;
        this.house(f.x + Math.cos(a) * d, f.z + Math.sin(a) * d, 8 + r() * 4, 6 + r() * 2, 1 + (r() < 0.3 ? 1 : 0), { wall: 'wall3', ruined: r() < 0.2 });
      }
    }
    for (let k = 0; k < 14; k++) { // haystacks / carts
      const x = (r() - 0.5) * 200, z = (r() - 0.5) * 200;
      if (this.isClear(x, z, 3) && this.boxFree(x - 1.2, z - 1.2, x + 1.2, z + 1.2)) this.solid('hay', x - 1.2, z - 1.2, x + 1.2, z + 1.2, 1.6, { us: 2, vs: 2 });
    }
    for (let k = 0; k < 40; k++) this.tree((r() - 0.5) * 230, (r() - 0.5) * 230, 'oak');
  }
  _hedgeSeg(x0, z0, x1, z1) {
    const hw = 0.8, r = this.rng;
    // split segment to avoid clear zones
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 4));
    let start = null;
    const flush = (sx, sz, ex, ez) => {
      if (Math.hypot(ex - sx, ez - sz) < 2) return;
      const bx0 = Math.min(sx, ex) - (sx === ex ? hw : 0), bx1 = Math.max(sx, ex) + (sx === ex ? hw : 0);
      const bz0 = Math.min(sz, ez) - (sz === ez ? hw : 0), bz1 = Math.max(sz, ez) + (sz === ez ? hw : 0);
      this.solid('hedge', bx0, bz0, bx1, bz1, 2.3 + r() * 0.6, { us: 3, vs: 3 });
      if (r() < 0.6) this.tree(bx0 + (bx1 - bx0) * r(), bz0 + (bz1 - bz0) * r(), 'oak', 1.1);
    };
    for (let k = 0; k <= n; k++) {
      const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n;
      const ok = this.isClear(x, z, 3) && Math.abs(x) <= HALF && Math.abs(z) <= HALF;
      if (ok && !start) start = [x, z];
      if ((!ok || k === n) && start) { flush(start[0], start[1], x, z); start = null; }
    }
  }

  _forest() {
    const r = this.rng;
    // dirt road through the middle stays clear
    this.clear.push({ x: 0, z: 0, r: 0 });
    for (let k = 0; k < 900; k++) {
      const x = (r() - 0.5) * 236, z = (r() - 0.5) * 236;
      if (Math.abs(x - this.noise(z * 0.02, 5) * 25) < 4) continue; // road
      this.tree(x, z, r() < 0.75 ? 'pine' : 'oak', 0.9 + r() * 0.5);
    }
    for (let k = 0; k < 40; k++) { // fallen logs
      const x = (r() - 0.5) * 220, z = (r() - 0.5) * 220;
      if (!this.isClear(x, z, 3)) continue;
      const along = r() < 0.5, L = 2.5 + r() * 2;
      if (along) { if (this.boxFree(x - L, z - 0.4, x + L, z + 0.4)) this.solid('log', x - L, z - 0.4, x + L, z + 0.4, 0.9, { us: 2, vs: 1 }); }
      else if (this.boxFree(x - 0.4, z - L, x + 0.4, z + L)) this.solid('log', x - 0.4, z - L, x + 0.4, z + L, 0.9, { us: 2, vs: 1 });
    }
    for (let k = 0; k < 12; k++) this.strongpoint((r() - 0.5) * 200, (r() - 0.5) * 160, 2.2);
    for (const f of this.flags) if (r() < 0.6) this.house(f.x + 14, f.z + (r() - 0.5) * 10, 7, 6, 1, { wall: 'wood', roof: 'roof2' });
  }

  _hills() {
    const r = this.rng;
    for (let k = 0; k < 45; k++) { // dry stone walls
      const x = (r() - 0.5) * 220, z = (r() - 0.5) * 220, L = 8 + r() * 20, along = r() < 0.5;
      if (!this.isClear(x, z, L / 2)) continue;
      if (along) { if (this.boxFree(x - L / 2, z - 0.4, x + L / 2, z + 0.4)) this.solid('stone', x - L / 2, z - 0.4, x + L / 2, z + 0.4, 1.2, { us: 3, vs: 2 }); }
      else if (this.boxFree(x - 0.4, z - L / 2, x + 0.4, z + L / 2)) this.solid('stone', x - 0.4, z - L / 2, x + 0.4, z + L / 2, 1.2, { us: 3, vs: 2 });
    }
    for (let k = 0; k < 60; k++) { // boulders
      const x = (r() - 0.5) * 220, z = (r() - 0.5) * 220, s = 1 + r() * 1.8;
      if (this.isClear(x, z, s + 1) && this.boxFree(x - s, z - s, x + s, z + s)) this.solid('rock', x - s, z - s * 0.8, x + s, z + s * 0.8, s * 1.1, { us: 3, vs: 3 });
    }
    for (let k = 0; k < 140; k++) this.tree((r() - 0.5) * 230, (r() - 0.5) * 230, r() < 0.6 ? 'pine' : 'oak');
    for (const f of this.flags) {
      const a = r() * 6.28;
      this.house(f.x + Math.cos(a) * 18, f.z + Math.sin(a) * 18, 8, 7, 1 + (r() < 0.5 ? 1 : 0), { wall: 'stonewall', ruined: r() < 0.4, roof: 'roof2' });
    }
    for (let k = 0; k < 8; k++) this.strongpoint((r() - 0.5) * 200, (r() - 0.5) * 160, 2.5);
  }

  _beach() {
    const r = this.rng;
    for (let k = 0; k < 90; k++) this.hedgehog((r() - 0.5) * 228, 45 + r() * 45);
    for (let k = 0; k < 10; k++) { // seawall / shingle bank
      const x = -HALF + k * 24 + r() * 6;
      this.sandbagWall(x, 38 + r() * 6, 6 + r() * 6, true, 1.1);
    }
    // bunkers on the bluff
    for (let k = 0; k < 5; k++) this.bunker(-90 + k * 45 + (r() - 0.5) * 12, 12 + r() * 8, 1);
    // trench line with sandbags
    for (let x = -HALF + 6; x < HALF - 6; x += 9 + r() * 5) this.sandbagWall(x, 5 + r() * 4, 5, true, 1.0);
    // inland village
    for (let k = 0; k < 18; k++) this.house((r() - 0.5) * 200, -30 - r() * 70, 7 + r() * 5, 6 + r() * 3, 1 + (r() < 0.4 ? 1 : 0), { wall: r() < 0.5 ? 'wall3' : 'wall', ruined: r() < 0.35 });
    for (let k = 0; k < 50; k++) this.tree((r() - 0.5) * 230, -20 - r() * 100, 'oak');
  }

  // ---------- meshes ----------
  _buildTerrainMesh() {
    const t = this.cfg.terrain, winter = this.cfg.winter || this.cfg.weather === 'snow';
    const seg = (EXT * 2) / HS;
    const geo = new THREE.PlaneGeometry(EXT * 2, EXT * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      const i = Math.round((x + EXT) / HS), j = Math.round((z + EXT) / HS);
      const y = this.hgrid[j * HN + i];
      pos.setY(k, y);
      const n = this.noise(x * 0.07, z * 0.07) * 0.5 + 0.5, n2 = this.noise(x * 0.015 + 30, z * 0.015) * 0.5 + 0.5;
      if (winter) c.setRGB(0.82 + n * 0.1, 0.84 + n * 0.1, 0.88 + n * 0.08);
      else if (t === 'beach' && z > 28) { const wet = clamp((z - 75) / 20, 0, 1); c.setRGB(0.76 - wet * 0.25, 0.68 - wet * 0.22, 0.5 - wet * 0.15); }
      else if (t === 'city' || t === 'town') c.setRGB(0.36 + n * 0.12, 0.35 + n * 0.1, 0.3 + n * 0.08);
      else if (t === 'forest') c.setRGB(0.24 + n * 0.08, 0.27 + n * 0.1, 0.15 + n * 0.05);
      else c.setRGB(0.3 + n * 0.12 + n2 * 0.08, 0.4 + n * 0.12, 0.2 + n * 0.05);
      // mud/dirt patches
      if (!winter && n2 > 0.72 && !(t === 'beach' && z > 28)) c.lerp(new THREE.Color(0.35, 0.29, 0.21), (n2 - 0.72) * 3);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const gt = tex('ground'); gt.repeat.set(EXT / 4, EXT / 4);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: gt });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    this.terrainMesh = m;
    // dirt roads drawn as darker strips (decal planes) for towns/farm
    if (this.water) {
      const wg = new THREE.PlaneGeometry(EXT * 2.5, 140, 1, 1); wg.rotateX(-Math.PI / 2);
      const wm = new THREE.MeshPhongMaterial({ color: 0x3d5a66, transparent: true, opacity: 0.62, shininess: 80, specular: 0x667788 });
      const water = new THREE.Mesh(wg, wm); water.position.set(0, -0.25, 92 + 70);
      this.scene.add(water); this.waterMesh = water;
    }
    // distant ground plane
    const far = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: winter ? 0xcfd4da : (this.water ? 0x3d5a66 : 0x4a5530) }));
    far.position.y = this.water ? -0.3 : 2; far.renderOrder = -1;
    if (!this.water) far.position.y = -3;
    this.scene.add(far);
  }

  _buildMeshes() {
    const winter = this.cfg.winter || this.cfg.weather === 'snow';
    const L = (map, color = 0xffffff) => new THREE.MeshLambertMaterial({ map, color });
    const mats = {
      wall: L(tex('wall')), wall2: L(tex('wall', { color: '#a59a8a', shutter: '#5a4535' })), wall3: L(tex('wall', { color: '#c9bda0', shutter: '#3e5560' })),
      stonewall: L(tex('wall', { color: '#8c877c', shutter: '#4a3a2a' })),
      roof: L(tex('roof')), roof2: L(tex('roof', { color: '#4e4a48' })),
      sandbag: L(tex('sandbag')), hedge: L(tex('hedge')), concrete: L(tex('concrete')), wood: L(tex('wood')),
      stone: L(tex('stone')), rock: L(tex('stone'), 0x9a968e), rubble: L(tex('stone'), 0x8f8577), log: L(tex('bark')),
      hay: L(tex('wood'), 0xd8c070), wreck: L(tex('concrete'), 0x3a3a34),
    };
    if (winter) { mats.roof.color.set(0xe8eef4); mats.roof2.color.set(0xe8eef4); mats.hedge.color.set(0xb8c4b0); }
    this.mats = mats;
    // these obstacle types are drawn as organic instanced props instead of textured boxes
    const PROP = new Set(['sandbag', 'rock', 'log', 'hay', 'wreck', 'rubble']);
    for (const [k, b] of Object.entries(this.batches)) {
      if (!b.n || PROP.has(k)) continue;
      this.scene.add(b.mesh(mats[k] || mats.concrete));
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const r = this.rng;
    // Instanced helper: items = [{x,y,z, rx,ry,rz, sx,sy,sz, c?}]
    const inst = (geo, mat, items, shadow = true) => {
      if (!items.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((it, k) => {
        e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
        p.set(it.x, it.y, it.z); s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
        m.compose(p, q, s); im.setMatrixAt(k, m);
        if (it.c !== undefined) { col.setHex(it.c); if (it.v) col.multiplyScalar(it.v); im.setColorAt(k, col); }
      });
      im.castShadow = shadow; im.receiveShadow = true;
      this.scene.add(im);
      return im;
    };
    const byMat = (name) => this.obstacles.filter((o) => o.type === 'box' && o.mat === name);
    const VC = new THREE.MeshLambertMaterial({ vertexColors: true });

    // ---- trees ----
    const pines = this.trees.filter((t) => t.kind === 'pine'), oaks = this.trees.filter((t) => t.kind === 'oak');
    const barkMat = L(tex('bark'));
    inst(M.trunkGeometry(), barkMat, this.trees.map((t) => ({ x: t.x, y: t.y - 0.3, z: t.z, ry: t.rot, sx: t.s, sy: (t.kind === 'pine' ? 3.4 : 4.2) * t.s, sz: t.s })));
    const pineMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex('leaves', { color: '#b0b0b0' }) });
    const oakMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex('leaves', { color: '#b8b8b8' }) });
    if (winter) { pineMat.color.set(0xa8b0ac); oakMat.color.set(0x8a7c66); }
    const tint = (t) => 0.85 + ((t.rot * 1000) % 1) * 0.3;
    inst(M.pineGeometry(), pineMat, pines.map((t) => ({ x: t.x, y: t.y - 0.3, z: t.z, ry: t.rot, sx: t.s, sy: t.s * (0.9 + (t.rot % 1) * 0.3), sz: t.s, c: 0xffffff, v: tint(t) })));
    inst(M.oakGeometry(), oakMat, oaks.map((t) => ({ x: t.x, y: t.y - 0.3, z: t.z, ry: t.rot, sx: t.s, sy: t.s * (0.9 + (t.rot % 1) * 0.3), sz: t.s, c: 0xffffff, v: tint(t) })));

    // ---- hedgerows: irregular foliage masses over the solid core ----
    const leafMat = new THREE.MeshLambertMaterial({ map: tex('leaves', { color: '#c0c0c0' }) });
    const blob = M.blobGeometry(1, 3, 0.3);
    const hedgeBlobs = [];
    const greens = winter ? [0x7d8577, 0x6f7768, 0x8a917f] : [0x34502a, 0x3d5c2e, 0x2e4824, 0x456632];
    for (const o of byMat('hedge')) {
      const alongX = o.x1 - o.x0 > o.z1 - o.z0;
      const L0 = alongX ? o.x0 : o.z0, L1 = alongX ? o.x1 : o.z1;
      const cA = alongX ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2;
      for (let t = L0 + 0.5; t < L1 - 0.3; t += 1.15 + r() * 0.3) {
        const off = (r() - 0.5) * 0.5;
        const g = this.H(alongX ? t : cA, alongX ? cA : t);
        const top = o.y1;
        const rad = 0.8 + r() * 0.35;
        const x = alongX ? t : cA + off, z = alongX ? cA + off : t;
        hedgeBlobs.push({ x, y: top - 0.35 + r() * 0.3, z, ry: r() * 6, sx: rad, sy: rad * (0.7 + r() * 0.3), sz: rad, c: greens[(r() * greens.length) | 0] });
        if (r() < 0.55) {
          const side = r() < 0.5 ? -1 : 1, sr = 0.55 + r() * 0.3;
          const sx = alongX ? t : cA + side * 0.75, sz = alongX ? cA + side * 0.75 : t;
          hedgeBlobs.push({ x: sx, y: g + 0.5 + r() * 0.8, z: sz, ry: r() * 6, sx: sr, sy: sr, sz: sr, c: greens[(r() * greens.length) | 0] });
        }
      }
    }
    inst(blob, leafMat, hedgeBlobs);

    // ---- sandbags: stacked pillow-shaped bags ----
    const bagGeo = M.sandbagGeometry();
    const bags = [];
    const bagCols = winter ? [0xb8b0a0, 0xa8a090] : [0xa8956a, 0x9c8a60, 0xb09d72, 0x948259];
    for (const o of byMat('sandbag')) {
      const alongX = o.x1 - o.x0 >= o.z1 - o.z0;
      const L0 = alongX ? o.x0 : o.z0, L1 = alongX ? o.x1 : o.z1;
      const cA = alongX ? (o.z0 + o.z1) / 2 : (o.x0 + o.x1) / 2;
      const g0 = this.H((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2);
      const rows = Math.max(1, Math.round((o.y1 - g0) / 0.21));
      for (let row = 0; row < rows; row++) {
        const stag = (row % 2) * 0.21;
        for (let t = L0 + 0.22 + stag; t <= L1 - 0.18; t += 0.43) {
          const x = alongX ? t : cA, z = alongX ? cA : t;
          const g = Math.max(this.H(x, z), g0 - 0.3);
          bags.push({ x: x + (r() - 0.5) * 0.04, y: g + 0.1 + row * 0.205, z: z + (r() - 0.5) * 0.04,
            ry: (alongX ? Math.PI / 2 : 0) + (r() - 0.5) * 0.15, rz: (r() - 0.5) * 0.08,
            sx: 0.21, sy: 0.115, sz: 0.36, c: bagCols[(r() * bagCols.length) | 0] });
        }
      }
    }
    inst(bagGeo, L(tex('sandbag')), bags);

    // ---- rocks and rubble ----
    const rockGeo = M.blobGeometry(1, 7, 0.35);
    const rockMat = new THREE.MeshLambertMaterial({ map: tex('stone'), flatShading: true });
    const rocks = [];
    for (const o of byMat('rock')) {
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, g = this.H(cx, cz), h = o.y1 - g;
      rocks.push({ x: cx, y: g + h * 0.3, z: cz, rx: r() * 0.4, ry: r() * 6, sx: (o.x1 - o.x0) * 0.6, sy: h * 0.75, sz: (o.z1 - o.z0) * 0.6, c: winter ? 0xd0d4d8 : 0xa09a90, v: 0.8 + r() * 0.3 });
    }
    for (const o of byMat('rubble')) {
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, g = this.H(cx, cz), h = o.y1 - g;
      for (let k = 0; k < 4; k++) {
        const sc = 0.4 + r() * 0.5;
        rocks.push({ x: cx + (r() - 0.5) * (o.x1 - o.x0) * 0.7, y: g + h * (0.15 + r() * 0.35), z: cz + (r() - 0.5) * (o.z1 - o.z0) * 0.7, rx: r() * 3, ry: r() * 6, sx: sc * 1.3, sy: sc * h * 0.8, sz: sc, c: 0x9a8c7a, v: 0.75 + r() * 0.35 });
      }
    }
    inst(rockGeo, rockMat, rocks);

    // ---- logs and hay bales ----
    const logGeo = new THREE.CylinderGeometry(1, 1, 1, 9); logGeo.rotateZ(Math.PI / 2);
    inst(logGeo, barkMat, byMat('log').map((o) => {
      const alongX = o.x1 - o.x0 > o.z1 - o.z0, cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
      return { x: cx, y: this.H(cx, cz) + 0.3, z: cz, ry: alongX ? 0 : Math.PI / 2, sx: (alongX ? o.x1 - o.x0 : o.z1 - o.z0), sy: 0.38, sz: 0.38 };
    }));
    const hayGeo = new THREE.CylinderGeometry(0.8, 0.8, 1.2, 14); hayGeo.rotateX(Math.PI / 2);
    inst(hayGeo, L(tex('hedge'), 0xf0d890), byMat('hay').flatMap((o) => {
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, g = this.H(cx, cz), ry = r() * Math.PI;
      return [{ x: cx, y: g + 0.75, z: cz, ry }, ...(r() < 0.5 ? [{ x: cx, y: g + 1.95, z: cz, ry: ry + 0.4, sx: 0.9, sy: 0.9, sz: 0.9 }] : [])];
    }));

    // ---- burnt-out tank wrecks ----
    inst(M.tankWreckGeometry(), VC, this.wrecks.map((w) => ({ x: w.x, y: w.y - 0.15, z: w.z, ry: (w.along ? 0 : Math.PI / 2) + (r() < 0.5 ? Math.PI : 0), rz: (r() - 0.5) * 0.06 })));

    // ---- hedgehogs ----
    if (this.hedgehogs.length) {
      const beam = new THREE.BoxGeometry(2.2, 0.16, 0.16);
      const hh = [];
      for (const [x, y, z, a] of this.hedgehogs) for (let b = 0; b < 3; b++) {
        hh.push({ x, y: y + 0.55, z, rx: b === 0 ? 0.6 : b === 1 ? -0.6 : 0, ry: a + b * 2.1, rz: b === 2 ? 0.7 : 0.4 });
      }
      inst(beam, new THREE.MeshLambertMaterial({ color: 0x3b3430 }), hh);
    }

    // ---- ground clutter: bushes and grass ----
    const terr = this.cfg.terrain;
    if (terr !== 'city') {
      const bushes = [];
      for (let i = 0; i < 1800 && bushes.length < 550; i++) {
        const x = (r() - 0.5) * 236, z = (r() - 0.5) * 236;
        if (this.water && z > 30) continue;
        if (!this.boxFree(x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0) || !this.isClear(x, z, 1)) continue;
        const sc = 0.45 + r() * 0.8;
        bushes.push({ x, y: this.H(x, z) + sc * 0.25, z, ry: r() * 6, sx: sc * 1.3, sy: sc * 0.85, sz: sc * 1.3, c: greens[(r() * greens.length) | 0] });
      }
      inst(blob, leafMat, bushes);
    }
    if (!winter && terr !== 'city') {
      // unlit so both sides of each blade read the same; tinted to sit with the lit ground
      const gmat = new THREE.MeshBasicMaterial({ map: M.grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, color: terr === 'forest' ? 0x7a8068 : 0xa0a486 });
      const tufts = [];
      const N = terr === 'town' ? 3000 : 7000;
      for (let i = 0; i < N * 2 && tufts.length < N; i++) {
        const x = (r() - 0.5) * 250, z = (r() - 0.5) * 250;
        if (this.water && z > 22) continue;
        if (!this.boxFree(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0)) continue;
        const sc = 0.7 + r() * 0.9;
        tufts.push({ x, y: this.H(x, z) - 0.03, z, ry: r() * 6, sx: sc, sy: sc * (0.8 + r() * 0.6), sz: sc });
      }
      inst(M.grassGeometry(), gmat, tufts, false);
    }
  }

  // ---------- spatial queries ----------
  // Ray vs world. Returns distance to first hit (obstacle or terrain), or Infinity.
  raycast(ox, oy, oz, dx, dy, dz, maxT, skipTerrain = false) {
    let best = maxT;
    let hitObj = null;
    const st = ++this.stamp;
    // traverse cells with DDA in xz
    let cx = Math.floor((ox + EXT) / CS), cz = Math.floor((oz + EXT) / CS);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? CS / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? CS / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (cx + 1) * CS - EXT - ox : ox - (cx * CS - EXT)) / Math.abs(dx)) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (cz + 1) * CS - EXT - oz : oz - (cz * CS - EXT)) / Math.abs(dz)) : Infinity;
    let tcur = 0;
    for (let guard = 0; guard < 200; guard++) {
      if (cx < 0 || cz < 0 || cx >= CN || cz >= CN || tcur > best) break;
      for (const o of this.cells[cz * CN + cx]) {
        if (o.st === st) continue; o.st = st;
        const t = o.type === 'box' ? rayBox(ox, oy, oz, dx, dy, dz, o) : rayCyl(ox, oy, oz, dx, dy, dz, o);
        if (t >= 0 && t < best) { best = t; hitObj = o; }
      }
      if (tmx < tmz) { tcur = tmx; tmx += tdx; cx += stepX; } else { tcur = tmz; tmz += tdz; cz += stepZ; }
    }
    if (!skipTerrain) {
      const step = 1.0;
      for (let t = 0.5; t < best; t += step) {
        const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
        if (y < this.H(x, z)) {
          // refine
          let a = t - step, b = t;
          for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (oy + dy * m < this.H(ox + dx * m, oz + dz * m)) b = m; else a = m; }
          if (b < best) { best = b; hitObj = 'terrain'; }
          break;
        }
        if (Math.abs(x) > EXT || Math.abs(z) > EXT) break;
      }
    }
    this.lastHit = hitObj;
    return best < maxT ? best : Infinity;
  }
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.01) return true;
    return this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.3) === Infinity;
  }

  // Ground height under a point, considering walkable obstacle tops.
  groundAt(x, z, feetY, r = 0.3) {
    let g = this.H(x, z);
    const cx = clamp(Math.floor((x + EXT) / CS), 0, CN - 1), cz = clamp(Math.floor((z + EXT) / CS), 0, CN - 1);
    for (const o of this.cells[cz * CN + cx]) {
      if (o.type !== 'box') continue;
      if (x > o.x0 - r * 0.5 && x < o.x1 + r * 0.5 && z > o.z0 - r * 0.5 && z < o.z1 + r * 0.5 && o.y1 <= feetY + 0.65 && o.y1 > g) g = o.y1;
    }
    return g;
  }

  // Push a circle out of obstacles. p: {x, y(feet), z}
  collide(p, r, height = 1.8) {
    const cx = clamp(Math.floor((p.x + EXT) / CS), 0, CN - 1), cz = clamp(Math.floor((p.z + EXT) / CS), 0, CN - 1);
    let hit = false;
    for (let j = Math.max(0, cz - 1); j <= Math.min(CN - 1, cz + 1); j++) for (let i = Math.max(0, cx - 1); i <= Math.min(CN - 1, cx + 1); i++) {
      for (const o of this.cells[j * CN + i]) {
        if (o.y1 <= p.y + 0.6 || o.y0 >= p.y + height) continue;
        if (o.type === 'box') {
          const qx = clamp(p.x, o.x0, o.x1), qz = clamp(p.z, o.z0, o.z1);
          let dx = p.x - qx, dz = p.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = qx + dx / d * r; p.z = qz + dz / d * r; }
            else { // inside: push out along smallest axis
              const pens = [p.x - o.x0, o.x1 - p.x, p.z - o.z0, o.z1 - p.z];
              const m = Math.min(...pens), k = pens.indexOf(m);
              if (k === 0) p.x = o.x0 - r; else if (k === 1) p.x = o.x1 + r; else if (k === 2) p.z = o.z0 - r; else p.z = o.z1 + r;
            }
            hit = true;
          }
        } else {
          const dx = p.x - o.x, dz = p.z - o.z, rr = r + o.r, d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); p.x = o.x + dx / d * rr; p.z = o.z + dz / d * rr; hit = true; }
        }
      }
    }
    p.x = clamp(p.x, -HALF, HALF); p.z = clamp(p.z, -HALF, HALF);
    return hit;
  }

  // ---------- navigation ----------
  _buildNav() {
    this.blocked = new Uint8Array(NN * NN);
    for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
      const x = -HALF + (i + 0.5) * NAV, z = -HALF + (j + 0.5) * NAV;
      const g = this.H(x, z);
      const cx = clamp(Math.floor((x + EXT) / CS), 0, CN - 1), cz = clamp(Math.floor((z + EXT) / CS), 0, CN - 1);
      for (const o of this.cells[cz * CN + cx]) {
        if (o.type !== 'box' || o.y1 - g < 0.7) continue;
        const pad = 0.45;
        if (x > o.x0 - pad && x < o.x1 + pad && z > o.z0 - pad && z < o.z1 + pad) { this.blocked[j * NN + i] = 1; break; }
      }
    }
    this.flow = this.flags.map((f) => this._dijkstra(f.x, f.z));
  }
  navCell(x, z) { return [clamp(Math.floor((x + HALF) / NAV), 0, NN - 1), clamp(Math.floor((z + HALF) / NAV), 0, NN - 1)]; }
  _dijkstra(gx, gz) {
    const dist = new Float32Array(NN * NN).fill(1e9);
    const [si, sj] = this.navCell(gx, gz);
    const heap = new MinHeap();
    dist[sj * NN + si] = 0; heap.push(0, sj * NN + si);
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.size) {
      const [d, k] = heap.pop();
      if (d > dist[k]) continue;
      const i = k % NN, j = (k / NN) | 0;
      for (const [di, dj, c] of nb) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= NN || nj >= NN) continue;
        const nk = nj * NN + ni;
        if (this.blocked[nk]) continue;
        if (di && dj && (this.blocked[j * NN + ni] || this.blocked[nj * NN + i])) continue;
        // slope cost
        const nd = d + c * (1 + Math.abs(this.H(-HALF + ni * NAV, -HALF + nj * NAV) - this.H(-HALF + i * NAV, -HALF + j * NAV)) * 0.5);
        if (nd < dist[nk]) { dist[nk] = nd; heap.push(nd, nk); }
      }
    }
    return dist;
  }
  // Direction (unit) to follow toward flag f from position.
  flowDir(x, z, f) {
    const dist = this.flow[f];
    const [i, j] = this.navCell(x, z);
    let best = dist[j * NN + i], bi = i, bj = j;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= NN || nj >= NN) continue;
      const d = dist[nj * NN + ni];
      if (d < best - 0.01) { best = d; bi = ni; bj = nj; }
    }
    if (bi === i && bj === j) {
      const fl = this.flags[f];
      const dx = fl.x - x, dz = fl.z - z, L = Math.hypot(dx, dz) || 1;
      return [dx / L, dz / L];
    }
    const tx = -HALF + (bi + 0.5) * NAV, tz = -HALF + (bj + 0.5) * NAV;
    const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  }
  flowDist(x, z, f) { const [i, j] = this.navCell(x, z); return this.flow[f][j * NN + i]; }

  findCover(x, z, tx, tz, maxD = 14, self = null) {
    let best = null, bs = Infinity;
    for (const c of this.coverPts) {
      const d2 = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d2 > maxD * maxD) continue;
      if (c.occ && c.occ !== self && c.occ.alive) continue;
      // threat must be on the far side of the obstacle
      const ex = tx - c.x, ez = tz - c.z, el = Math.hypot(ex, ez) || 1;
      const dot = (ex * c.nx + ez * c.nz) / el;
      if (dot > -0.5) continue;
      const s = Math.sqrt(d2) + dot * 4;
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; this.size = 0; }
  push(key, val) {
    let i = this.size++; this.k[i] = key; this.v[i] = val;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= this.k[i]) break; this._sw(i, p); i = p; }
  }
  pop() {
    const r = [this.k[0], this.v[0]];
    this.size--; this.k[0] = this.k[this.size]; this.v[0] = this.v[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, rr = l + 1; let m = i;
      if (l < this.size && this.k[l] < this.k[m]) m = l;
      if (rr < this.size && this.k[rr] < this.k[m]) m = rr;
      if (m === i) break; this._sw(i, m); i = m;
    }
    return r;
  }
  _sw(a, b) { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.v[a], this.v[b]] = [this.v[b], this.v[a]]; }
}

function rayBox(ox, oy, oz, dx, dy, dz, o) {
  let tmin = -Infinity, tmax = Infinity;
  const ax = [[ox, dx, o.x0, o.x1], [oy, dy, o.y0, o.y1], [oz, dz, o.z0, o.z1]];
  for (const [p, d, lo, hi] of ax) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return -1; continue; }
    let t1 = (lo - p) / d, t2 = (hi - p) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}
function rayCyl(ox, oy, oz, dx, dy, dz, o) {
  const fx = ox - o.x, fz = oz - o.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - o.r * o.r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = (-b - s) / (2 * a);
  if (t < 0) t = (-b + s) / (2 * a);
  if (t < 0) return -1;
  const y = oy + dy * t;
  if (y < o.y0 || y > o.y1) return -1;
  return t;
}

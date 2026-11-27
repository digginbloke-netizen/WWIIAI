// Procedural battlefield: terrain, structures, collision, line of sight and navigation.
import * as THREE from 'three';
import { mulberry32, makeNoise2D, clamp } from '../util.js';
import { tex, photo, photoWall, hasPhoto } from './textures.js';
import * as M from './models.js';

// World dimensions are set per map: a compact battlefield or a full 1 km mission sector.
export let HALF = 160;        // playable half-extent (m)
let EXT = 240;                // terrain half-extent
let SZ = HALF / 118;          // scale factor for content density
let HS = 2;                   // height grid spacing
let HN = (EXT * 2) / HS + 1;
const CS = 8;                 // spatial hash cell
let CN = Math.ceil((EXT * 2) / CS);
export let NAV = 2;           // nav cell size
export let NN = Math.ceil((HALF * 2) / NAV);
export const CHUNK = 128;     // render chunk size for culling
export function dims() { return { HALF, EXT, HS, HN, NAV, NN, CS, CN }; }
function setDims(half, ext, hs, nav) {
  HALF = half; EXT = ext; HS = hs; NAV = nav; SZ = HALF / 118;
  HN = (EXT * 2) / HS + 1; CN = Math.ceil((EXT * 2) / CS); NN = Math.ceil((HALF * 2) / NAV);
}

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
  // same, but UVs anchored to world coordinates so neighbouring pieces of a wall line up
  boxW(x0, y0, z0, x1, y1, z1, us = 4, vs = 3, top = true, bottom = false) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0 / us, y0 / vs], [x1 / us, y0 / vs], [x1 / us, y1 / vs], [x0 / us, y1 / vs]]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[-x1 / us, y0 / vs], [-x0 / us, y0 / vs], [-x0 / us, y1 / vs], [-x1 / us, y1 / vs]]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[-z1 / us, y0 / vs], [-z0 / us, y0 / vs], [-z0 / us, y1 / vs], [-z1 / us, y1 / vs]]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0 / us, y0 / vs], [z1 / us, y0 / vs], [z1 / us, y1 / vs], [z0 / us, y1 / vs]]);
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / us, z1 / us], [x1 / us, z1 / us], [x1 / us, z0 / us], [x0 / us, z0 / us]]);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[x0 / us, z0 / us], [x1 / us, z0 / us], [x1 / us, z1 / us], [x0 / us, z1 / us]]);
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
    if (cfg.mode === 'mission') setDims(500, 580, 4, 4); else setDims(160, 240, 2, 2);
    this.big = cfg.mode === 'mission';
    this.lod = [];
    this.scene = scene;
    this.cfg = cfg;
    this.rng = mulberry32(cfg.seed || 1);
    this.noise = makeNoise2D(cfg.seed || 1);
    this.obstacles = [];
    this.cells = Array.from({ length: CN * CN }, () => []);
    this.stamp = 1;
    this.coverPts = [];
    this.batches = {};
    this.buildings = [];
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
  _rawH(x0, z0) {
    const t = this.cfg.terrain, n = this.noise;
    // big sectors: broader landforms, and the coastline sits at the Allied (+z) edge
    const f = this.big ? 0.6 : 1;
    const x = x0 * f, z = this.big && t === 'beach' ? z0 - (HALF - 200) : z0 * f;
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
      if (z > 92) h = Math.max(-1.15, -0.7 - (z - 92) * 0.02);
    }
    if (this.big && t !== 'beach') h *= 1.5;
    // edges rise slightly to frame the battlefield
    const e = Math.max(Math.abs(x0), Math.abs(z0)) - HALF;
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
  flatten(x, z, r, y, fall = 6) {
    const R = r + fall;
    const i0 = clamp(Math.floor((x - R + EXT) / HS), 0, HN - 1), i1 = clamp(Math.ceil((x + R + EXT) / HS), 0, HN - 1);
    const j0 = clamp(Math.floor((z - R + EXT) / HS), 0, HN - 1), j1 = clamp(Math.ceil((z + R + EXT) / HS), 0, HN - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = -EXT + i * HS, pz = -EXT + j * HS;
      const d = Math.hypot(px - x, pz - z);
      if (d > R) continue;
      const t = clamp((d - r) / fall, 0, 1);
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
    if (o.type !== 'cyl') { x0 = o.x0; x1 = o.x1; z0 = o.z0; z1 = o.z1; }
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
      if (o.type !== 'cyl') { if (o.x0 < x1 + pad && o.x1 > x0 - pad && o.z0 < z1 + pad && o.z1 > z0 - pad) return false; }
      else if (o.x + o.r > x0 - pad && o.x - o.r < x1 + pad && o.z + o.r > z0 - pad && o.z - o.r < z1 + pad) return false;
    }
    return true;
  }
  // geometry batches; on big maps they are split into chunks so off-screen parts are culled
  at(x, z) { this._cx = Math.floor((x + EXT) / CHUNK); this._cz = Math.floor((z + EXT) / CHUNK); }
  batch(name) {
    const key = this.big ? `${name}#${this._cx || 0},${this._cz || 0}` : name;
    return this.batches[key] || (this.batches[key] = new Batch());
  }

  // Solid axis-aligned box sitting on terrain. Returns obstacle.
  solid(mat, x0, z0, x1, z1, height, opt = {}) {
    this.at((x0 + x1) / 2, (z0 + z1) / 2);
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
  // Walk-in house: walls with real door and window openings, a floor, a staircase to the first
  // floor, a ceiling and roof. Collision is one compound obstacle (bounding box + parts), and the
  // AI gets a record of doors, stairs and firing posts at the windows.
  house(cx, cz, w, d, floors, style = {}) {
    this.at(cx, cz);
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    if (!this.boxFree(x0, z0, x1, z1, 1.5)) return false;
    const r = this.rng;
    const hs = [this.H(x0, z0), this.H(x1, z0), this.H(x0, z1), this.H(x1, z1), this.H(cx, cz)];
    const floor = Math.max(...hs) + 0.12, base = Math.min(...hs) - 0.6;
    const ruined = !!style.ruined;
    const wallMat = style.wall || 'wall', plain = wallMat === 'wood' ? 'wood' : wallMat + '_p';
    const T = 0.3;
    const ix0 = x0 + T, ix1 = x1 - T, iz0 = z0 + T, iz1 = z1 - T;
    const parts = [];
    const part = (bx0, by0, bz0, bx1, by1, bz1, mat, us = 4, vs = 3, top = true, bottom = false) => {
      if (bx1 - bx0 < 0.01 || by1 - by0 < 0.01 || bz1 - bz0 < 0.01) return;
      parts.push({ type: 'box', x0: bx0, x1: bx1, z0: bz0, z1: bz1, y0: by0, y1: by1 });
      if (mat) this.batch(mat).boxW(bx0, by0, bz0, bx1, by1, bz1, us, vs, top, bottom);
    };
    const deco = (mat, bx0, by0, bz0, bx1, by1, bz1, us = 2, vs = 2) => this.batch(mat).boxW(bx0, by0, bz0, bx1, by1, bz1, us, vs, true, true);

    // ---- door side: a wall with open ground in front of it (long walls preferred) ----
    const wallDef = (s) => s === 0 ? { s, A: 'x', a0: x0, a1: x1, c0: z0, c1: z0 + T, n: -1 }
      : s === 1 ? { s, A: 'x', a0: x0, a1: x1, c0: z1 - T, c1: z1, n: 1 }
        : s === 2 ? { s, A: 'z', a0: iz0, a1: iz1, c0: x0, c1: x0 + T, n: -1 }
          : { s, A: 'z', a0: iz0, a1: iz1, c0: x1 - T, c1: x1, n: 1 };
    const walls = [0, 1, 2, 3].map(wallDef);
    for (const W of walls) { W.outer = W.n < 0 ? W.c0 : W.c1; W.inner = W.n < 0 ? W.c1 : W.c0; W.cols = []; }
    const wpt = (W, a, off) => (W.A === 'x' ? { x: a, z: W.outer + W.n * off } : { x: W.outer + W.n * off, z: a });
    const doorPos = (W) => { const m = (W.a0 + W.a1) / 2, L = W.a1 - W.a0; return clamp(m + (r() - 0.5) * L * 0.4, W.a0 + 1.1, W.a1 - 1.1); };
    let best = null;
    for (const W of walls) {
      const pd = doorPos(W), o = wpt(W, pd, 1.8);
      const free = this.boxFree(o.x - 1, o.z - 1, o.x + 1, o.z + 1, 0.2) && Math.abs(o.x) < HALF - 4 && Math.abs(o.z) < HALF - 4;
      const long = W.a1 - W.a0 >= (W.A === 'x' ? d : w) - 0.01;
      const s = (free ? 10 : 0) + (long ? 3 : 0) + r() * 4;
      if (!best || s > best.s) best = { s, W, pd };
    }
    const DW = best.W, back = walls[DW.s ^ 1];
    const doors = [];
    const addDoor = (W, pd) => {
      W.cols.push({ c: pd, wd: 1.2, door: true });
      doors.push({ W, c: pd, o: wpt(W, pd, 1.4), d: wpt(W, pd, -T - 0.8), ok: true });
    };
    addDoor(DW, best.pd);

    // ---- stairs along the back wall, at the end away from the door ----
    let lv = ruined ? 1 : Math.min(floors, 2);
    const A = DW.A;
    const ia0 = A === 'x' ? ix0 : iz0, ia1 = A === 'x' ? ix1 : iz1;
    const depth = A === 'x' ? iz1 - iz0 : ix1 - ix0;
    const bi = back.inner, sg = -back.n; // across coordinate: distance from the back wall's inner face
    const P = (a, c) => (A === 'x' ? { x: a, z: bi + sg * c } : { x: bi + sg * c, z: a });
    const R = (a0, a1, c0, c1) => { const p = P(a0, c0), q = P(a1, c1); return { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), z0: Math.min(p.z, q.z), z1: Math.max(p.z, q.z) }; };
    let stair = null;
    if (lv === 2 && ia1 - ia0 >= 5.0 && depth >= 3.2) {
      const low = best.pd >= (ia0 + ia1) / 2;
      const sa0 = low ? ia0 : ia1 - 3.0, sa1 = sa0 + 3.0;
      const footA = low ? sa1 + 0.6 : sa0 - 0.6, topA = low ? sa0 + 0.2 : sa1 - 0.2, landA = low ? sa0 + 0.5 : sa1 - 0.5;
      stair = { sa0, sa1, low, rect: R(sa0, sa1, 0, 1.0), hole: R(sa0 - 0.05, sa1 + 0.05, 0, 1.05),
        F: { ...P(footA, 0.5), direct: true }, S: { ...P(topA, 0.5), direct: true }, T: { ...P(landA, 1.65), direct: true } };
    } else if (lv === 2) lv = 1;
    // a back door when it doesn't clash with the stairs
    if (r() < 0.55) {
      const pb = stair ? (stair.low ? ia1 - 1.2 : ia0 + 1.2) : doorPos(back);
      const clash = stair && (stair.low ? pb - 0.6 < stair.sa1 + 1.3 : pb + 0.6 > stair.sa0 - 1.3);
      if (!clash) addDoor(back, pb);
    }
    // ---- windows ----
    for (const W of walls) {
      const L = W.a1 - W.a0, n = Math.max(1, Math.round(L / 3));
      for (let k = 0; k < n; k++) {
        const c = W.a0 + (k + 0.5) * L / n;
        if (c - W.a0 < 1.0 || W.a1 - c < 1.0) continue;
        if (W.cols.some((o) => Math.abs(o.c - c) < 1.55)) continue;
        W.cols.push({ c, wd: 1.0 });
      }
      W.cols.sort((a, b) => a.c - b.c);
    }
    const hTop = floor + lv * 3;
    const gapsOf = (col) => {
      const g = [];
      for (let L = 0; L < lv; L++) g.push(L === 0 && col.door ? [floor, floor + 2.15] : [floor + 3 * L + 0.9, floor + 3 * L + 2.0]);
      return g;
    };
    // ruined walls: broken off at uneven heights
    const ruinTop = () => floor + 1.3 + r() * (Math.min(floors, 2) * 3 * 0.85 - 1.3);
    const wallBox = (W, aLo, aHi, yLo, yHi) => {
      if (W.A === 'x') part(aLo, yLo, W.c0, aHi, yHi, W.c1, plain, 4, 3, true, true);
      else part(W.c0, yLo, aLo, W.c1, yHi, aHi, plain, 4, 3, true, true);
    };
    const across = (W, oIn, oOut) => { const a = W.outer - W.n * oIn, b = W.outer + W.n * oOut; return [Math.min(a, b), Math.max(a, b)]; };
    const dbox = (W, mat, aLo, aHi, yLo, yHi, oIn, oOut) => {
      const [c0, c1] = across(W, oIn, oOut);
      if (W.A === 'x') deco(mat, aLo, yLo, c0, aHi, yHi, c1); else deco(mat, c0, yLo, aLo, c1, yHi, aHi);
    };
    const posts = [];
    for (const W of walls) {
      let cur = W.a0;
      const pier = (a, b) => {
        if (b - a < 0.02) return;
        const pt = ruined ? ruinTop() : hTop;
        wallBox(W, a, b, base, pt);
        dbox(W, 'stone', a, b, base, floor + 0.45, 0.1, 0.05);
      };
      for (const col of W.cols) {
        const ca = col.c - col.wd / 2, cb = col.c + col.wd / 2;
        pier(cur, ca);
        const pt = ruined ? Math.max(ruinTop(), col.door ? floor + 2.5 : floor + 1.2) : hTop;
        let y = base;
        const gaps = gapsOf(col).filter((g) => g[0] < pt);
        for (const [g0, g1] of gaps) { wallBox(W, ca, cb, y, g0); y = Math.min(g1, pt); }
        if (y < pt) wallBox(W, ca, cb, y, pt);
        if (!col.door) dbox(W, 'stone', ca, cb, base, floor + 0.45, 0.1, 0.05);
        // dressing: frames, sills, shutters, the door leaf
        const nb = Math.min(...W.cols.filter((o) => o !== col).map((o) => Math.abs(o.c - col.c)), Infinity);
        gaps.forEach(([g0, g1], L) => {
          const top = Math.min(g1, pt);
          if (!ruined || top - g0 > 1.0) {
            dbox(W, 'frame', ca - 0.07, ca, g0, top, 0.04, 0.03); dbox(W, 'frame', cb, cb + 0.07, g0, top, 0.04, 0.03);
            if (top >= g1) dbox(W, 'frame', ca - 0.07, cb + 0.07, g1, g1 + 0.08, 0.04, 0.03);
          }
          if (col.door && L === 0) {
            const [c0, c1] = across(W, T + 1.05, -T);
            if (!ruined || r() < 0.4) { if (W.A === 'x') deco('frame', ca + 0.02, floor, c0, ca + 0.07, floor + 2.1, c1); else deco('frame', c0, floor, ca + 0.02, c1, floor + 2.1, ca + 0.07); }
            return;
          }
          dbox(W, 'stone', ca - 0.1, cb + 0.1, g0 - 0.07, g0, 0.12, 0.08);
          if (!ruined && nb > 2.7 && r() < 0.8) {
            dbox(W, 'shutter', ca - 0.6, ca - 0.08, g0 + 0.02, g1 - 0.02, -0.03, 0.07);
            dbox(W, 'shutter', cb + 0.08, cb + 0.6, g0 + 0.02, g1 - 0.02, -0.03, 0.07);
          }
          // firing post just inside the window
          const ip = W.A === 'x' ? { x: col.c, z: W.inner - W.n * 0.55 } : { x: W.inner - W.n * 0.55, z: col.c };
          posts.push({ x: ip.x, z: ip.z, y: floor + 3 * L, lvl: L, nx: W.A === 'x' ? 0 : W.n, nz: W.A === 'x' ? W.n : 0, yaw: W.A === 'x' ? (W.n > 0 ? 0 : Math.PI) : (W.n > 0 ? Math.PI / 2 : -Math.PI / 2), occ: null });
        });
        cur = cb;
      }
      pier(cur, W.a1);
    }
    // ---- doorsteps ----
    for (const dr of doors) {
      const o = wpt(dr.W, dr.c, 0.3), ho = this.H(o.x, o.z);
      if (floor - ho < 0.25) continue;
      const [c0, c1] = across(dr.W, 0, 0.65), yt = floor - (floor - ho) * 0.5;
      const bx = dr.W.A === 'x' ? [dr.c - 0.75, c0, dr.c + 0.75, c1] : [c0, dr.c - 0.75, c1, dr.c + 0.75];
      this.addObstacle({ type: 'box', x0: bx[0], z0: bx[1], x1: bx[2], z1: bx[3], y0: ho - 0.4, y1: yt, mat: 'step' });
      this.batch('stone').boxW(bx[0], ho - 0.4, bx[1], bx[2], yt, bx[3], 2, 2);
    }
    // ---- floors, stairs, ceiling ----
    part(ix0, base, iz0, ix1, floor, iz1, 'boards', 2, 2);
    let blockR = null; // area the AI can't walk through on the ground floor
    if (stair) {
      const s = stair;
      for (let k = 0; k < 10; k++) {
        const a0 = s.low ? s.sa1 - 0.3 * (k + 1) : s.sa0 + 0.3 * k, rr = R(a0, a0 + 0.3, 0, 1.0);
        part(rr.x0, floor, rr.z0, rr.x1, floor + 0.3 * (k + 1), rr.z1, 'boards', 2, 2);
      }
      const y0 = floor + 2.78, y1 = floor + 3.0;
      const ha0 = s.sa0 - 0.05, ha1 = s.sa1 + 0.05;
      for (const rr of [R(ia0, ha0, 0, depth), R(ha1, ia1, 0, depth), R(ha0, ha1, 1.05, depth)]) part(rr.x0, y0, rr.z0, rr.x1, y1, rr.z1, 'boards', 2, 2, true, true);
      blockR = s.rect;
    }
    if (ruined) {
      // collapsed ceiling: a rubble heap in a back corner
      const low = best.pd >= (ia0 + ia1) / 2;
      const ra0 = low ? ia0 : ia1 - 1.8, rr = R(ra0, ra0 + 1.8, 0, 1.5);
      this.solid('rubble', rr.x0, rr.z0, rr.x1, rr.z1, 0, { top: floor + 0.85, us: 3, vs: 2, cover: false });
      blockR = rr;
    }
    let roofBase = hTop;
    if (!ruined) {
      part(x0, hTop, z0, x1, hTop + 0.25, z1, plain, 4, 3, true, true);
      roofBase = hTop + 0.25;
      if (floors > lv) {
        // upper storeys nobody can reach: a solid block with painted windows
        const topB = floor + floors * 3;
        this.batch(wallMat).box(x0, roofBase, z0, x1, topB, z1, 4, 3, style.gable === false);
        parts.push({ type: 'box', x0, x1, z0, z1, y0: roofBase, y1: topB });
        roofBase = topB;
      }
    }
    // ---- roof ----
    let roofTop = roofBase;
    if (!ruined && style.gable !== false) {
      const top = roofBase;
      const rb = this.batch(style.roof || 'roof');
      const rh = 2.2, ov = 0.4;
      roofTop = top + rh;
      if (w >= d) {
        const zm = cz;
        const a = [x0 - ov, top, z0 - ov], b = [x1 + ov, top, z0 - ov], c = [x1 + ov, top + rh, zm], dd = [x0 - ov, top + rh, zm];
        const e = [x0 - ov, top, z1 + ov], f = [x1 + ov, top, z1 + ov];
        rb.quad(a, dd, c, b, [0, 0.7, -0.7], [[0, 0], [0, 2], [w / 2, 2], [w / 2, 0]]);
        rb.quad(f, c, dd, e, [0, 0.7, 0.7], [[0, 0], [0, 2], [w / 2, 2], [w / 2, 0]]);
        this.batch(plain).tri([x0, top, z1], [x0, top + rh, zm], [x0, top, z0], [[0, 0], [d / 8, 0.7], [d / 4, 0]]);
        this.batch(plain).tri([x1, top, z0], [x1, top + rh, zm], [x1, top, z1], [[0, 0], [d / 8, 0.7], [d / 4, 0]]);
        parts.push({ type: 'box', x0, x1, z0: cz - d * 0.3, z1: cz + d * 0.3, y0: top, y1: top + rh * 0.45 });
        parts.push({ type: 'box', x0, x1, z0: cz - d * 0.12, z1: cz + d * 0.12, y0: top, y1: top + rh * 0.8 });
        if (r() < 0.7) { const chx = cx + (r() < 0.5 ? -1 : 1) * w * 0.28; deco('stone', chx - 0.35, top + 0.6, zm - 0.35, chx + 0.35, top + rh + 0.8, zm + 0.35); }
      } else {
        const xm = cx;
        const a = [x0 - ov, top, z1 + ov], b = [x0 - ov, top, z0 - ov], c = [xm, top + rh, z0 - ov], dd = [xm, top + rh, z1 + ov];
        const e = [x1 + ov, top, z0 - ov], f = [x1 + ov, top, z1 + ov];
        rb.quad(a, dd, c, b, [-0.7, 0.7, 0], [[0, 0], [0, 2], [d / 2, 2], [d / 2, 0]]);
        rb.quad(e, c, dd, f, [0.7, 0.7, 0], [[0, 0], [0, 2], [d / 2, 2], [d / 2, 0]]);
        this.batch(plain).tri([x0, top, z0], [xm, top + rh, z0], [x1, top, z0], [[0, 0], [w / 8, 0.7], [w / 4, 0]]);
        this.batch(plain).tri([x1, top, z1], [xm, top + rh, z1], [x0, top, z1], [[0, 0], [w / 8, 0.7], [w / 4, 0]]);
        parts.push({ type: 'box', x0: cx - w * 0.3, x1: cx + w * 0.3, z0, z1, y0: top, y1: top + rh * 0.45 });
        parts.push({ type: 'box', x0: cx - w * 0.12, x1: cx + w * 0.12, z0, z1, y0: top, y1: top + rh * 0.8 });
        if (r() < 0.7) { const chz = cz + (r() < 0.5 ? -1 : 1) * d * 0.28; deco('stone', xm - 0.35, top + 0.6, chz - 0.35, xm + 0.35, top + rh + 0.8, chz + 0.35); }
      }
    }
    let maxY = roofTop;
    for (const q of parts) maxY = Math.max(maxY, q.y1);
    const o = this.addObstacle({ type: 'house', x0, x1, z0, z1, y0: base, y1: maxY, parts });
    this._coverAround(o);
    if (ruined) {
      for (let k = 0; k < 3; k++) {
        const rx = cx + (r() - 0.5) * (w + 4), rz = cz + (r() < 0.5 ? -1 : 1) * (d / 2 + 1.5);
        if (doors.some((dr) => Math.hypot(dr.o.x - rx, dr.o.z - rz) < 3.2)) continue;
        if (this.boxFree(rx - 1, rz - 0.8, rx + 1, rz + 0.8, 0.2)) this.solid('rubble', rx - 1.2, rz - 0.8, rx + 1.2, rz + 0.8, 0.9 + r() * 0.5, { us: 3, vs: 2 });
      }
    }
    // ---- AI record: doors, stairs, firing posts ----
    const inR = (q, x, z, m) => x > q.x0 - m && x < q.x1 + m && z > q.z0 - m && z < q.z1 + m;
    const segHits = (q, ax, az, bx, bz, m) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25); for (let i = 0; i <= n; i++) { const t = i / Math.max(1, n); if (inR(q, ax + (bx - ax) * t, az + (bz - az) * t, m)) return true; } return false; };
    const D0 = doors[0].d;
    const idx = this.buildings.length;
    const okPosts = posts.filter((p) => {
      if (p.lvl === 0) {
        if (Math.hypot(p.x - D0.x, p.z - D0.z) < 1.0) return false;
        if (blockR && (inR(blockR, p.x, p.z, 0.45) || segHits(blockR, D0.x, D0.z, p.x, p.z, 0.38))) return false;
        return true;
      }
      return stair && !inR(stair.hole, p.x, p.z, 0.45) && !segHits(stair.hole, stair.T.x, stair.T.z, p.x, p.z, 0.35);
    });
    for (const p of okPosts) p.bld = idx;
    this.buildings.push({ idx, x0, x1, z0, z1, ix0, ix1, iz0, iz1, cx, cz, floor, lv, ruined, stair, posts: okPosts, ok: false,
      doors: doors.map((dr) => ({ o: { x: dr.o.x, z: dr.o.z }, d: { x: dr.d.x, z: dr.d.z, direct: true }, ok: true })) });
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
  // Concrete bunker with a firing slit toward the enemy and a door at the back. The crew's posts
  // are at the slit. Returns the building record (also used by the AI), or null.
  bunker(x, z, faceSign) {
    this.at(x, z);
    const w = 8, d = 6, T = 0.6, f = faceSign >= 0 ? 1 : -1;
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    if (!this.boxFree(x0 - 0.9, z0 - 0.9, x1 + 0.9, z1 + 0.9, 0.6)) return null;
    const hs = [this.H(x0, z0), this.H(x1, z0), this.H(x0, z1), this.H(x1, z1), this.H(x, z)];
    const floor = Math.max(...hs) + 0.05, base = Math.min(...hs) - 0.8;
    const top = floor + 2.2, roof = top + 0.7;
    const parts = [];
    const P = (bx0, by0, bz0, bx1, by1, bz1, mat = 'concrete', us = 3, vs = 3) => {
      if (bx1 - bx0 < 0.01 || by1 - by0 < 0.01 || bz1 - bz0 < 0.01) return;
      parts.push({ type: 'box', x0: bx0, x1: bx1, z0: bz0, z1: bz1, y0: by0, y1: by1 });
      if (mat) this.batch(mat).boxW(bx0, by0, bz0, bx1, by1, bz1, us, vs, true, true);
    };
    // front (slit) and back (door) walls run along x; zF/zB are their [z0, z1] ranges
    const zF = f > 0 ? [z1 - T, z1] : [z0, z0 + T], zB = f > 0 ? [z0, z0 + T] : [z1 - T, z1];
    const sl = 1.9; // half-width of the slit
    P(x0, base, zF[0], x - sl, top, zF[1]); P(x + sl, base, zF[0], x1, top, zF[1]);
    P(x - sl, base, zF[0], x + sl, floor + 1.3, zF[1]); P(x - sl, floor + 1.78, zF[0], x + sl, top, zF[1]);
    const dx = x + (this.rng() < 0.5 ? -1 : 1) * 2.1, dw = 0.6;
    P(x0, base, zB[0], dx - dw, top, zB[1]); P(dx + dw, base, zB[0], x1, top, zB[1]);
    P(dx - dw, base, zB[0], dx + dw, floor, zB[1]); P(dx - dw, floor + 2.0, zB[0], dx + dw, top, zB[1]);
    P(x0, base, z0 + T, x0 + T, top, z1 - T); P(x1 - T, base, z0 + T, x1, top, z1 - T);
    P(x0 + T, base, z0 + T, x1 - T, floor, z1 - T, 'concrete');
    // thick roof slab with a visor over the slit
    const zr0 = f > 0 ? z0 - 0.3 : z0 - 0.9, zr1 = f > 0 ? z1 + 0.9 : z1 + 0.3;
    P(x0 - 0.3, top, zr0, x1 + 0.3, roof, zr1);
    // earth and sandbags banked against the sides
    for (const sx of [x0 - 0.9, x1]) this.batch('earth').boxW(sx, base, z0 - 0.2, sx + 0.9, floor + 1.0, z1 + 0.2, 3, 3);
    parts.push({ type: 'box', x0: x0 - 0.9, x1: x0, z0: z0 - 0.2, z1: z1 + 0.2, y0: base, y1: floor + 0.55 }, { type: 'box', x0: x1, x1: x1 + 0.9, z0: z0 - 0.2, z1: z1 + 0.2, y0: base, y1: floor + 0.55 });
    const o = this.addObstacle({ type: 'house', x0: x0 - 0.9, x1: x1 + 0.9, z0: Math.min(z0, zr0), z1: Math.max(z1, zr1), y0: base, y1: roof, parts });
    this._coverAround(o);
    // AI record
    const idx = this.buildings.length;
    const inner = f > 0 ? zF[0] : zF[1];
    const posts = [-1.15, 0, 1.15].map((ox) => ({ x: x + ox, z: inner - f * 0.5, y: floor, lvl: 0, nx: 0, nz: f, yaw: f > 0 ? 0 : Math.PI, occ: null, bld: idx, stand: true }));
    const back = f > 0 ? zB[0] : zB[1], backIn = f > 0 ? zB[1] : zB[0];
    const door = { o: { x: dx, z: back - f * 1.4 }, d: { x: dx, z: backIn + f * 0.7, direct: true }, ok: true };
    const B = { idx, x0, x1, z0, z1, ix0: x0 + T, ix1: x1 - T, iz0: z0 + T, iz1: z1 - T, cx: x, cz: z, floor, lv: 1, ruined: false, stair: null, bunker: true, face: f, posts, ok: false, doors: [door] };
    this.buildings.push(B);
    if (this.strongpoints) this.strongpoints.push({ x: dx, z: back - f * 5, r: 8, kind: 'bunker', bld: idx });
    return B;
  }
  hedgehog(x, z) {
    if (!this.boxFree(x - 0.8, z - 0.8, x + 0.8, z + 0.8, 0.5)) return;
    const y = this.H(x, z);
    this.hedgehogs.push([x, y, z, this.rng() * Math.PI]);
    this.addObstacle({ type: 'box', x0: x - 0.7, x1: x + 0.7, z0: z - 0.7, z1: z + 0.7, y0: y - 0.2, y1: y + 1.2 });
  }
  wreck(x, z) {
    this.at(x, z);
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
    if (this.big) { this._sectorLayout(); return; }
    this._battleLayout();
    const A = this.attSign;
    for (const f of this.flags) {
      f.radius = 11;
      this.clear.push({ x: f.x, z: f.z, r: 7 });
      if (t !== 'beach' || f.letter !== 'A') this.flatten(f.x, f.z, 9, this.H(f.x, f.z));
    }
    this.clear.push({ x: this.spawns.att.x, z: this.spawns.att.z, r: 14 }, { x: this.spawns.def.x, z: this.spawns.def.z, r: 14 });

    const gen = { town: () => this._town(false), city: () => this._town(true), farmland: () => this._farm(), forest: () => this._forest(), hills: () => this._hills(), beach: () => this._beach() }[t];
    (gen || (() => this._farm()))();
    if (this.assets) this._assetStructures();
    this._finishLayout(A);
  }

  _battleLayout() {
    const r = this.rng, t = this.cfg.terrain;
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
  }

  _finishLayout(A) {
    const r = this.rng, t = this.cfg.terrain;
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
    const nw = 4 + Math.floor(r() * 5);
    for (let k = 0; k < nw; k++) this.wreck((r() - 0.5) * 180 * SZ, (r() - 0.5) * 180 * SZ);
    for (let k = 0; k < 50; k++) {
      const x = (r() - 0.5) * 220 * SZ, z = (r() - 0.5) * 200 * SZ;
      if (this.isClear(x, z, 3)) this.sandbagWall(x, z, 3 + r() * 3, r() < 0.5, 1.0);
    }
    this._clutter();
    // perimeter forest for the horizon
    for (let k = 0; k < 650; k++) {
      const a = r() * Math.PI * 2, d = HALF + 10 + r() * 60;
      const x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d * 1.1;
      if (Math.abs(x) < HALF + 6 && Math.abs(z) < HALF + 6) continue;
      if (t === 'beach' && z > 80) continue;
      this.tree(clamp(x, -EXT + 5, EXT - 5), clamp(z, -EXT + 5, EXT - 5), r() < 0.5 ? 'pine' : 'oak', 1.1);
    }
  }

  // Ranger mission AO: optional live front on one flank, enemy assets, insertion/exfil, patrol routes.
  _missionLayout() {
    const r = this.rng, cfg = this.cfg;
    const front = cfg.front;
    this.attSign = front && front.attacker === 'axis' ? -1 : 1;
    const A = this.attSign;
    this.laneX = null;
    this.flags = [];
    const laneSign = r() < 0.5 ? -1 : 1;
    if (front) {
      const lx = laneSign * 92;
      this.laneX = lx;
      this.flags = [
        { letter: 'A', x: lx + (r() - 0.5) * 30, z: 45 * A },
        { letter: 'B', x: lx + (r() - 0.5) * 24, z: 0 },
        { letter: 'C', x: lx + (r() - 0.5) * 30, z: -48 * A },
      ];
    }
    this.spawns = { att: { x: this.laneX ?? 0, z: (HALF - 12) * A }, def: { x: this.laneX ?? 0, z: -(HALF - 12) * A } };
    const side = front ? -laneSign : (r() < 0.5 ? -1 : 1);
    const iz = cfg.terrain === 'beach' ? HALF - 24 : HALF - 14;
    this.insert = { x: side * (HALF - 32), z: iz };
    this.exfil = { x: this.insert.x, z: this.insert.z, radius: 12 };
    this.clear.push({ x: this.insert.x, z: this.insert.z, r: 16 });
    // assets
    this.assets = [];
    for (const a of cfg.assets || []) {
      let best = null;
      for (let k = 0; k < 400 && !best; k++) {
        const x = (r() - 0.5) * (2 * HALF - 60);
        const z = a.primary ? -HALF + 30 + r() * (HALF - 40) : -HALF + 25 + r() * (HALF + 15);
        if (Math.hypot(x - this.insert.x, z - this.insert.z) < 120) continue;
        if (this.laneX !== null && Math.abs(x - this.laneX) < 52) continue;
        if (this.assets.some((o) => Math.hypot(o.x - x, o.z - z) < 48)) continue;
        if (cfg.terrain === 'beach' && z > 15) continue;
        best = { x, z };
      }
      if (!best) best = { x: (r() - 0.5) * 100, z: -60 - r() * 60 };
      const rot = Math.floor(r() * 4) * Math.PI / 2;
      const asset = { ...a, x: best.x, z: best.z, rot, alive: true, hp: { artillery: 260, flak: 240, fuel: 120, ammo: 140, radio: 220, trucks: 140, tank: 420 }[a.type] || 200 };
      this.assets.push(asset);
      this.clear.push({ x: best.x, z: best.z, r: 14 });
      this.flatten(best.x, best.z, 11, this.H(best.x, best.z));
    }
    // patrol waypoints (validated after nav build)
    this.wpAxis = []; this.wpAllies = [];
    for (let k = 0; k < 12; k++) this.wpAxis.push({ x: (r() - 0.5) * (2 * HALF - 40), z: -HALF + 20 + r() * (HALF + 10), radius: 8 });
    for (let k = 0; k < 6; k++) this.wpAllies.push({ x: (r() - 0.5) * (2 * HALF - 40), z: 25 + r() * (HALF - 50), radius: 8 });
    if (this.laneX !== null) for (const w of this.wpAllies) if (Math.abs(w.x - this.laneX) < 40) w.x = -w.x;
    for (const w of [...this.wpAxis, ...this.wpAllies]) this.clear.push({ x: w.x, z: w.z, r: 3 });
  }

  _assetStructures() {
    const r = this.rng;
    for (const a of this.assets) {
      if (a.obs) continue; // already built
      const M2 = M.assetModel(a.type);
      a.r = M2.r;
      const c = Math.cos(a.rot), sn = Math.sin(a.rot);
      const tw = (x, z) => [a.x + x * c + z * sn, a.z - x * sn + z * c];
      const g = this.H(a.x, a.z);
      a.y = g;
      a.obs = [];
      for (const [x0, z0, x1, z1, h] of M2.boxes) {
        const p1 = tw(x0, z0), p2 = tw(x1, z1);
        const o = this.addObstacle({ type: 'box', x0: Math.min(p1[0], p2[0]), x1: Math.max(p1[0], p2[0]), z0: Math.min(p1[1], p2[1]), z1: Math.max(p1[1], p2[1]), y0: g - 0.3, y1: g + h, mat: 'asset' });
        this._coverAround(o);
        a.obs.push(o);
      }
      if (M2.mast) { const [mx, mz] = tw(...M2.mast); this.addObstacle({ type: 'cyl', x: mx, z: mz, r: 0.15, y0: g, y1: g + 15 }); }
      a.model = M2;
      // a partial sandbag ring around gun positions and dumps
      if (a.type !== 'radio' && a.type !== 'trucks' && !a.sub) {
        const R = a.r + 3;
        for (let k = 0; k < 6; k++) {
          if (k === 1 || (k === 4 && r() < 0.5)) continue; // gaps to walk through
          const ang = a.rot + k * Math.PI / 3;
          const x = a.x + Math.sin(ang) * R, z = a.z + Math.cos(ang) * R;
          this.sandbagWall(x, z, 4, Math.abs(Math.cos(ang)) > 0.5, 1.0);
        }
      }
    }
  }

  _buildAssetMeshes() {
    this.assetMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.burntMat = new THREE.MeshLambertMaterial({ color: 0x2a2724 });
    for (const a of this.assets) {
      const geo = M.mergeParts(a.model.parts);
      const mesh = new THREE.Mesh(geo, this.assetMat);
      mesh.position.set(a.x, a.y, a.z); mesh.rotation.y = a.rot;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      a.mesh = mesh;
    }
  }

  destroyAsset(a) {
    a.alive = false;
    a.mesh.material = this.burntMat;
    a.mesh.scale.y = a.type === 'radio' ? 0.55 : 0.8;
    a.mesh.rotation.z = (this.rng() - 0.5) * 0.08;
    for (const o of a.obs) o.y1 = o.y0 + (o.y1 - o.y0) * 0.7;
  }

  // Navigation targets that move (squad leader to follow, enemy hunting the Rangers).
  addDynamicTarget(x, z) {
    const t = { x, z, radius: 6, dynamic: true };
    this.targets.push(t);
    this.flow.push(this._dijkstra(x, z, this.big ? 60 : Infinity));
    return this.targets.length - 1;
  }
  updateDynamicTarget(i, x, z) {
    const t = this.targets[i];
    if (Math.hypot(t.x - x, t.z - z) < 4) return;
    t.x = x; t.z = z;
    this.flow[i] = this._dijkstra(x, z, this.big ? 60 : Infinity); // bounded: only the neighbourhood matters
  }
  // move a waypoint off blocked nav cells
  _fixPoint(p) {
    for (let k = 0; k < 40; k++) {
      const [i, j] = this.navCell(p.x, p.z);
      if (!this.blocked[j * NN + i]) return;
      p.x += (this.rng() - 0.5) * 8; p.z += (this.rng() - 0.5) * 8;
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
      const x = (r() - 0.5) * 210 * SZ, z = (r() - 0.5) * 190 * SZ;
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
    for (let k = 0; k < 20; k++) { // haystacks / carts
      const x = (r() - 0.5) * 200 * SZ, z = (r() - 0.5) * 200 * SZ;
      if (this.isClear(x, z, 3) && this.boxFree(x - 1.2, z - 1.2, x + 1.2, z + 1.2)) this.solid('hay', x - 1.2, z - 1.2, x + 1.2, z + 1.2, 1.6, { us: 2, vs: 2 });
    }
    for (let k = 0; k < 40 * SZ * SZ; k++) this.tree((r() - 0.5) * 230 * SZ, (r() - 0.5) * 230 * SZ, 'oak');
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
    for (let k = 0; k < 900 * SZ * SZ; k++) {
      const x = (r() - 0.5) * 236 * SZ, z = (r() - 0.5) * 236 * SZ;
      if (Math.abs(x - this.noise(z * 0.02, 5) * 25) < 4) continue; // road
      this.tree(x, z, r() < 0.75 ? 'pine' : 'oak', 0.9 + r() * 0.5);
    }
    for (let k = 0; k < 40; k++) { // fallen logs
      const x = (r() - 0.5) * 220 * SZ, z = (r() - 0.5) * 220 * SZ;
      if (!this.isClear(x, z, 3)) continue;
      const along = r() < 0.5, L = 2.5 + r() * 2;
      if (along) { if (this.boxFree(x - L, z - 0.4, x + L, z + 0.4)) this.solid('log', x - L, z - 0.4, x + L, z + 0.4, 0.9, { us: 2, vs: 1 }); }
      else if (this.boxFree(x - 0.4, z - L, x + 0.4, z + L)) this.solid('log', x - 0.4, z - L, x + 0.4, z + L, 0.9, { us: 2, vs: 1 });
    }
    for (let k = 0; k < 12; k++) this.strongpoint((r() - 0.5) * 200 * SZ, (r() - 0.5) * 160 * SZ, 2.2);
    for (const f of this.flags) if (r() < 0.6) this.house(f.x + 14, f.z + (r() - 0.5) * 10, 7, 6, 1, { wall: 'wood', roof: 'roof2' });
  }

  _hills() {
    const r = this.rng;
    for (let k = 0; k < 45 * SZ * SZ; k++) { // dry stone walls
      const x = (r() - 0.5) * 220 * SZ, z = (r() - 0.5) * 220 * SZ, L = 8 + r() * 20, along = r() < 0.5;
      if (!this.isClear(x, z, L / 2)) continue;
      if (along) { if (this.boxFree(x - L / 2, z - 0.4, x + L / 2, z + 0.4)) this.solid('stone', x - L / 2, z - 0.4, x + L / 2, z + 0.4, 1.2, { us: 3, vs: 2 }); }
      else if (this.boxFree(x - 0.4, z - L / 2, x + 0.4, z + L / 2)) this.solid('stone', x - 0.4, z - L / 2, x + 0.4, z + L / 2, 1.2, { us: 3, vs: 2 });
    }
    for (let k = 0; k < 60 * SZ * SZ; k++) { // boulders
      const x = (r() - 0.5) * 220 * SZ, z = (r() - 0.5) * 220 * SZ, s = 1 + r() * 1.8;
      if (this.isClear(x, z, s + 1) && this.boxFree(x - s, z - s, x + s, z + s)) this.solid('rock', x - s, z - s * 0.8, x + s, z + s * 0.8, s * 1.1, { us: 3, vs: 3 });
    }
    for (let k = 0; k < 140 * SZ * SZ; k++) this.tree((r() - 0.5) * 230 * SZ, (r() - 0.5) * 230 * SZ, r() < 0.6 ? 'pine' : 'oak');
    for (const f of this.flags) {
      const a = r() * 6.28;
      this.house(f.x + Math.cos(a) * 18, f.z + Math.sin(a) * 18, 8, 7, 1 + (r() < 0.5 ? 1 : 0), { wall: 'stonewall', ruined: r() < 0.4, roof: 'roof2' });
    }
    for (let k = 0; k < 8; k++) this.strongpoint((r() - 0.5) * 200 * SZ, (r() - 0.5) * 160 * SZ, 2.5);
  }

  _beach() {
    const r = this.rng;
    for (let k = 0; k < 90; k++) this.hedgehog((r() - 0.5) * 228 * SZ, 45 + r() * 45);
    for (let k = 0; k < 10; k++) { // seawall / shingle bank
      const x = -HALF + k * 24 + r() * 6;
      this.sandbagWall(x, 38 + r() * 6, 6 + r() * 6, true, 1.1);
    }
    // bunkers on the bluff
    for (let k = 0; k < 5; k++) this.bunker(-90 + k * 45 + (r() - 0.5) * 12, 12 + r() * 8, 1);
    // trench line with sandbags
    for (let x = -HALF + 6; x < HALF - 6; x += 9 + r() * 5) this.sandbagWall(x, 5 + r() * 4, 5, true, 1.0);
    // inland village
    for (let k = 0; k < 18; k++) this.house((r() - 0.5) * 200 * SZ, -30 - r() * 70, 7 + r() * 5, 6 + r() * 3, 1 + (r() < 0.4 ? 1 : 0), { wall: r() < 0.5 ? 'wall3' : 'wall', ruined: r() < 0.35 });
    for (let k = 0; k < 50; k++) this.tree((r() - 0.5) * 230 * SZ, -20 - r() * 100, 'oak');
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
    const mat = hasPhoto('grass') ? this._photoTerrain(geo, t, winter) : new THREE.MeshLambertMaterial({ vertexColors: true, map: Object.assign(tex('ground'), {}) });
    if (!hasPhoto('grass')) mat.map.repeat.set(EXT / 4, EXT / 4);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    this.terrainMesh = m;
    // dirt roads drawn as darker strips (decal planes) for towns/farm
    if (this.water) {
      const wg = new THREE.PlaneGeometry(EXT * 2.5, 140 + (this.big ? 200 : 0), 1, 1); wg.rotateX(-Math.PI / 2);
      const wm = new THREE.MeshPhongMaterial({ color: 0x3d5a66, transparent: true, opacity: 0.62, shininess: 80, specular: 0x667788 });
      const water = new THREE.Mesh(wg, wm); water.position.set(0, -0.25, 92 + 70 + this.waterOffset());
      this.scene.add(water); this.waterMesh = water;
    }
    // distant ground plane
    const far = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: winter ? 0xcfd4da : (this.water ? 0x3d5a66 : 0x4a5530) }));
    far.position.y = this.water ? -0.3 : 2; far.renderOrder = -1;
    if (!this.water) far.position.y = -3;
    this.scene.add(far);
  }

  // Photo-textured ground: a main surface, a second surface splatted in (mud, sand, dirt),
  // and a large-scale sample of the same texture to hide tiling.
  _photoTerrain(geo, t, winter) {
    // full sectors are mostly countryside: grass with gravel/mud on roads and in villages
    const main = winter ? 'snow' : t === 'forest' ? 'forest' : this.big ? 'grass' : t === 'city' ? 'cobble' : t === 'town' ? 'dirt' : 'grass';
    const second = winter ? 'mud' : t === 'beach' ? 'sand' : t === 'city' || t === 'town' ? 'dirt' : 'mud';
    const pos = geo.attributes.position, col = geo.attributes.color;
    const splat = new Float32Array(pos.count);
    const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      const n = this.noise(x * 0.07, z * 0.07) * 0.5 + 0.5, n2 = this.noise(x * 0.015 + 30, z * 0.015) * 0.5 + 0.5;
      let w = clamp((n2 - 0.62) * 3.2, 0, 1);
      if (winter) w *= 0.35;
      if (t === 'beach') w = Math.max(w * 0.6, clamp((z - 22 - this.waterOffset()) / 10, 0, 1));
      if (this.settlements) for (const st of this.settlements) { const d = Math.hypot(x - st.x, z - st.z); if (d < st.r) w = Math.max(w, clamp((st.r - d) / 25, 0, 1) * 0.85); }
      splat[k] = w;
      // gentle brightness / hue variation instead of painted colors
      const v = (0.82 + n * 0.26) * (main === 'forest' ? 1.45 : 1);
      // tint the photo toward a summer green on grass, keep other surfaces neutral
      const tint = main === 'grass' ? [0.7, 0.9, 0.52] : main === 'forest' ? [0.95, 1.05, 0.85] : [1, 1, 1];
      c.setRGB(v * tint[0] * (1.02 + n2 * 0.06), v * tint[1], v * tint[2] * (0.94 - n2 * 0.04));
      if (t === 'beach' && z > 75) c.multiplyScalar(1 - clamp((z - 75) / 20, 0, 1) * 0.35); // wet sand
      if (this.roadMask) { const gi = Math.round((x + EXT) / HS), gj = Math.round((z + EXT) / HS); const rm = this.roadMask[gj * HN + gi] || 0; if (rm > splat[k]) splat[k] = rm; if (rm > 0.5) c.multiplyScalar(0.92); }
      for (const cr of this.craters) {
        const d = Math.hypot(x - cr.x, z - cr.z);
        if (d < cr.R * 1.5) { const k2 = 1 - d / (cr.R * 1.5); c.multiplyScalar(1 - k2 * 0.45); if (!winter && t !== 'beach') splat[k] = Math.max(splat[k], k2 * 1.2); }
      }
      col.setXYZ(k, c.r, c.g, c.b);
    }
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 1));
    const rep = (EXT * 2) / 3.5;
    const map = photo(main, 'diff'), nor = photo(main, 'nor'), map2 = photo(second, 'diff');
    map.repeat.set(rep, rep); nor.repeat.set(rep, rep);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map, normalMap: nor });
    mat.normalScale.set(0.8, 0.8);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.map2 = { value: map2 };
      sh.vertexShader = 'attribute float splat;\nvarying float vSplat;\n' + sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n vSplat = splat;');
      sh.fragmentShader = 'uniform sampler2D map2;\nvarying float vSplat;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec3 farTone = texture2D(map, vMapUv * 0.11).rgb;
        diffuseColor.rgb *= mix(vec3(1.0), farTone / max(vec3(0.05), vec3(dot(farTone, vec3(0.333)))) * 0.5 + 0.5, 0.45);
        vec3 s2 = texture2D(map2, vMapUv * 0.8).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, s2, smoothstep(0.0, 1.0, vSplat));`);
    };
    return mat;
  }

  // Craters, telegraph lines, fences and barbed wire.
  _clutter() {
    const r = this.rng, t = this.cfg.terrain;
    this.craters = []; this.poles = []; this.fencePosts = []; this.fenceRails = []; this.wire = [];
    const nc = t === 'beach' ? 45 : t === 'city' ? 22 : 34;
    for (let k = 0; k < nc; k++) {
      const x = (r() - 0.5) * (2 * HALF - 20), z = (r() - 0.5) * (2 * HALF - 20), R = 1.8 + r() * 3.2;
      if (!this.isClear(x, z, R + 1.5) || !this.boxFree(x - R, z - R, x + R, z + R, 1.5)) continue;
      if (this.water && z > 88) continue;
      this.craters.push({ x, z, R });
      const depth = R * 0.32;
      const ext = R * 1.45;
      for (let j = 0; j < HN; j++) {
        const pz = -EXT + j * HS; if (Math.abs(pz - z) > ext) continue;
        for (let i = 0; i < HN; i++) {
          const px = -EXT + i * HS; if (Math.abs(px - x) > ext) continue;
          const d = Math.hypot(px - x, pz - z);
          if (d < R) this.hgrid[j * HN + i] -= depth * (1 - (d / R) ** 2);
          else if (d < ext) this.hgrid[j * HN + i] += 0.28 * Math.sin(((d - R) / (ext - R)) * Math.PI);
        }
      }
    }
    // telegraph line across the sector
    if (t !== 'forest' && t !== 'city') {
      const lz = (r() - 0.5) * HALF * 1.2;
      for (let x = -HALF - 30; x <= HALF + 30; x += 30 + r() * 6) {
        const z = lz + (r() - 0.5) * 4;
        if (!this.isClear(x, z, 2) || !this.boxFree(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0.5)) continue;
        const tilt = r() < 0.15 ? (r() - 0.5) * 0.5 : (r() - 0.5) * 0.06;
        this.poles.push({ x, z, tilt });
        this.addObstacle({ type: 'cyl', x, z, r: 0.14, y0: this.H(x, z) - 1, y1: this.H(x, z) + 7 });
      }
    }
    // post-and-rail fences around fields
    if (t === 'farmland' || t === 'hills' || t === 'town' || t === 'beach') {
      for (let k = 0; k < 16; k++) {
        const along = r() < 0.5, L = 10 + r() * 20;
        const x0 = (r() - 0.5) * (2 * HALF - 40), z0 = (r() - 0.5) * (2 * HALF - 40);
        if (t === 'beach' && z0 > 10) continue;
        const x1 = along ? x0 + L : x0, z1 = along ? z0 : z0 + L;
        if (!this.isClear((x0 + x1) / 2, (z0 + z1) / 2, L / 2 + 1)) continue;
        if (!this.boxFree(Math.min(x0, x1) - 0.2, Math.min(z0, z1) - 0.2, Math.max(x0, x1) + 0.2, Math.max(z0, z1) + 0.2, 0.3)) continue;
        const n = Math.round(L / 2.4);
        let gap = Math.floor(r() * n);
        for (let i = 0; i <= n; i++) {
          const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
          this.fencePosts.push({ x, z, lean: (r() - 0.5) * 0.12 });
          if (i < n && i !== gap) {
            const nx = x0 + (x1 - x0) * (i + 1) / n, nz = z0 + (z1 - z0) * (i + 1) / n;
            this.fenceRails.push({ x: (x + nx) / 2, z: (z + nz) / 2, along, len: L / n, broken: r() < 0.12 });
            const hw = 0.08;
            this.addObstacle({ type: 'box', x0: Math.min(x, nx) - (along ? 0 : hw), x1: Math.max(x, nx) + (along ? 0 : hw), z0: Math.min(z, nz) - (along ? hw : 0), z1: Math.max(z, nz) + (along ? hw : 0), y0: this.H(x, z) - 0.2, y1: this.H(x, z) + 0.75, mat: 'fence' });
          }
        }
      }
    }
    // barbed wire: obstacles on the beach, entanglements in front of defended flags
    const wireLine = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0); if (L < 2) return;
      this.wire.push({ x0, z0, x1, z1, L });
    };
    if (t === 'beach') for (let k = 0; k < 10; k++) { const x = (r() - 0.5) * (2 * HALF - 30), z = 30 + r() * 40, L = 8 + r() * 14; if (this.isClear(x, z, L / 2)) wireLine(x - L / 2, z, x + L / 2, z); }
    if ((this.cfg.fort || 0) >= 1) for (const f of this.flags.slice(1)) {
      const zz = f.z + 16 * this.attSign, L = 10 + r() * 8;
      if (this.isClear(f.x, zz, 2)) wireLine(f.x - L / 2, zz, f.x + L / 2, zz);
    }
  }

  _buildClutterMeshes(inst, mats) {
    const winter = this.cfg.winter || this.cfg.weather === 'snow';
    const wood = this.photoMats ? mats.log : new THREE.MeshLambertMaterial({ color: 0x4a3a2a });
    // telegraph poles with crossbars and sagging wires
    if (this.poles.length) {
      const pole = new THREE.CylinderGeometry(0.1, 0.14, 7.5, 7); pole.translate(0, 3.75, 0);
      inst(pole, wood, this.poles.map((p) => ({ x: p.x, y: this.H(p.x, p.z) - 0.3, z: p.z, rz: p.tilt })));
      const bar = new THREE.BoxGeometry(1.8, 0.1, 0.1);
      inst(bar, wood, this.poles.map((p) => ({ x: p.x + Math.sin(-p.tilt) * 6.7, y: this.H(p.x, p.z) - 0.3 + Math.cos(p.tilt) * 6.7, z: p.z, rz: p.tilt })));
      const pts = [];
      for (let i = 0; i + 1 < this.poles.length; i++) {
        const a = this.poles[i], b = this.poles[i + 1];
        if (Math.abs(a.tilt) > 0.2 || Math.abs(b.tilt) > 0.2) continue; // downed pole: wires cut
        for (const off of [-0.75, 0, 0.75]) {
          const ya = this.H(a.x, a.z) + 6.45, yb = this.H(b.x, b.z) + 6.45;
          const N = 10;
          for (let k = 0; k < N; k++) {
            const t0 = k / N, t1 = (k + 1) / N;
            const sag = (u) => 4 * u * (1 - u) * 0.9;
            pts.push(a.x + off + (b.x - a.x) * t0, ya + (yb - ya) * t0 - sag(t0), a.z + (b.z - a.z) * t0);
            pts.push(a.x + off + (b.x - a.x) * t1, ya + (yb - ya) * t1 - sag(t1), a.z + (b.z - a.z) * t1);
          }
        }
      }
      if (pts.length) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        this.scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1a1a1a })));
      }
    }
    // fences
    if (this.fencePosts.length) {
      const post = new THREE.CylinderGeometry(0.06, 0.07, 1.25, 6); post.translate(0, 0.55, 0);
      inst(post, wood, this.fencePosts.map((p) => ({ x: p.x, y: this.H(p.x, p.z), z: p.z, rx: p.lean, rz: -p.lean })));
      const rail = new THREE.BoxGeometry(1, 0.07, 0.05);
      const rails = [];
      for (const f of this.fenceRails) {
        const y = this.H(f.x, f.z);
        rails.push({ x: f.x, y: y + 0.85, z: f.z, ry: f.along ? 0 : Math.PI / 2, sx: f.len });
        if (!f.broken) rails.push({ x: f.x, y: y + 0.45, z: f.z, ry: f.along ? 0 : Math.PI / 2, sx: f.len });
        else rails.push({ x: f.x, y: y + 0.3, z: f.z, ry: f.along ? 0 : Math.PI / 2, rz: 0.4, sx: f.len * 0.8 });
      }
      inst(rail, wood, rails);
    }
    // railway tracks (rail yard raids)
    if (this.rails && this.rails.length) {
      const sleepers = [], rails = [];
      for (const t of this.rails) {
        for (let x = t.x0; x < t.x1; x += 0.8) sleepers.push({ x, y: this.H(x, t.z) + 0.06, z: t.z, sx: 0.25, sy: 0.12, sz: 2.6 });
        for (const o of [-0.72, 0.72]) rails.push({ x: (t.x0 + t.x1) / 2, y: this.H((t.x0 + t.x1) / 2, t.z) + 0.2, z: t.z + o, sx: t.x1 - t.x0, sy: 0.12, sz: 0.08 });
      }
      inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x3a2c20 }), sleepers, false);
      inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x55504a, metalness: 0.7, roughness: 0.4 }), rails, false);
    }
    // barbed wire coils on X-shaped stakes
    if (this.wire.length) {
      const coil = new THREE.TorusGeometry(0.42, 0.012, 3, 14);
      const items = [], stakes = [];
      for (const w of this.wire) {
        const ang = Math.atan2(w.z1 - w.z0, w.x1 - w.x0);
        for (let d = 0; d < w.L; d += 0.32) {
          const x = w.x0 + Math.cos(ang) * d, z = w.z0 + Math.sin(ang) * d;
          items.push({ x, y: this.H(x, z) + 0.42, z, ry: -ang + Math.PI / 2 + (Math.random() - 0.5) * 0.3, rx: (Math.random() - 0.5) * 0.3 });
        }
        for (let d = 0; d < w.L; d += 3) {
          const x = w.x0 + Math.cos(ang) * d, z = w.z0 + Math.sin(ang) * d;
          stakes.push({ x, y: this.H(x, z) + 0.5, z, ry: -ang, rz: 0.5 }, { x, y: this.H(x, z) + 0.5, z, ry: -ang, rz: -0.5 });
        }
      }
      const metal = new THREE.MeshLambertMaterial({ color: winter ? 0x3a3a3a : 0x2a2622 });
      inst(coil, metal, items, false);
      const stake = new THREE.BoxGeometry(0.05, 1.3, 0.05);
      inst(stake, wood, stakes);
    }
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
      wall_p: L(tex('wall', { plain: true })), wall2_p: L(tex('wall', { color: '#a59a8a', plain: true })), wall3_p: L(tex('wall', { color: '#c9bda0', plain: true })),
      stonewall_p: L(tex('wall', { color: '#8c877c', plain: true })),
      boards: L(tex('wood'), 0xb09a80), frame: L(tex('wood'), 0x7a6650), shutter: L(tex('wood'), 0x5f7a52),
      hay: L(tex('wood'), 0xd8c070), wreck: L(tex('concrete'), 0x3a3a34), earth: L(tex('ground'), 0x6a5a44), revet: L(tex('wood'), 0x8a7860), shadow: new THREE.MeshBasicMaterial({ color: 0x17140f }),
    };
    if (hasPhoto('plaster')) {
      const PW = (key, o, color = 0xffffff) => { const w = photoWall(key, o); const m = new THREE.MeshLambertMaterial({ map: w.map, normalMap: w.normalMap, color }); return m; };
      const PM = (key, color = 0xffffff, repeat, nscale = 1) => {
        const m = new THREE.MeshLambertMaterial({ map: photo(key, 'diff'), normalMap: photo(key, 'nor'), color });
        m.normalScale.set(nscale, nscale); return m;
      };
      Object.assign(mats, {
        wall: PW('plaster', { shutter: 'rgba(70,95,60,0.6)' }), wall2: PW('brick', { shutter: 'rgba(90,60,40,0.6)', metres: 2 }),
        wall3: PW('plasterstone', { shutter: 'rgba(60,85,100,0.6)' }), stonewall: PW('stonewall', { shutter: 'rgba(80,60,40,0.6)' }),
        wall_p: PW('plaster', { plain: true }), wall2_p: PW('brick', { metres: 2, plain: true }), wall3_p: PW('plasterstone', { plain: true }), stonewall_p: PW('stonewall', { plain: true }),
        boards: PM('planks', 0xc8b49a), frame: PM('planks', 0x8a7458), shutter: PM('planks', 0x6f8f60),
        roof: PM('roof'), roof2: PM('roof2'), concrete: PM('concrete'), wood: PM('planks'), stone: PM('stonewall', 0xd8d4cc),
        rock: PM('rock', 0xc8c4bc), rubble: PM('stonewall', 0xb8aea0), log: PM('bark'),
        hedge: new THREE.MeshLambertMaterial({ map: photo('leaves', 'diff', { gray: 0.8, contrast: 1.4 }), normalMap: photo('leaves', 'nor'), color: 0x55703c }),
        wreck: PM('rust', 0x8a8070), sandbag: PM('hessian', 0xd8c8a0), earth: PM('dirt', 0xc0ae94), revet: PM('planks', 0x9c8870),
      });
      this.photoMats = true;
    }
    if (winter) { mats.roof.color.set(0xe8eef4); mats.roof2.color.set(0xe8eef4); mats.hedge.color.set(0xb8c4b0); }
    // roofs are seen from below at the eaves; house interiors in shade shouldn't go pitch black
    mats.roof.side = THREE.DoubleSide; mats.roof2.side = THREE.DoubleSide;
    for (const k of ['wall_p', 'wall2_p', 'wall3_p', 'stonewall_p', 'boards']) { mats[k].emissive.set(0x2c2824); mats[k].emissiveMap = mats[k].map; }
    this.mats = mats;
    // these obstacle types are drawn as organic instanced props instead of textured boxes
    const PROP = new Set(['sandbag', 'rock', 'log', 'hay', 'wreck', 'rubble']);
    for (const [k, b] of Object.entries(this.batches)) {
      const name = k.split('#')[0];
      if (!b.n || PROP.has(name)) continue;
      this.scene.add(b.mesh(mats[name] || mats.concrete));
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const r = this.rng;
    // Instanced helper: items = [{x,y,z, rx,ry,rz, sx,sy,sz, c?}]
    const instImpl = (geo, mat, items, shadow = true, lodDist = 0) => {
      if (!items.length) return null;
      if (this.big) {
        // one instanced mesh per chunk: frustum culling and distance fading work per tile
        const groups = new Map();
        for (const it of items) {
          const key = Math.floor((it.x + EXT) / CHUNK) * 1000 + Math.floor((it.z + EXT) / CHUNK);
          (groups.get(key) || groups.set(key, []).get(key)).push(it);
        }
        for (const [key, list] of groups) {
          const im = build(list);
          im.computeBoundingSphere();
          if (lodDist) this.lod.push({ mesh: im, x: (Math.floor(key / 1000) + 0.5) * CHUNK - EXT, z: ((key % 1000) + 0.5) * CHUNK - EXT, d: lodDist });
        }
        return null;
      }
      return build(items);
    };
    const build = (items) => {
      const geo = this._instGeo, mat = this._instMat, shadow = this._instShadow;
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
    const inst = (geo, mat, items, shadow = true, lodDist = 0) => { this._instGeo = geo; this._instMat = mat; this._instShadow = shadow; return instImpl(geo, mat, items, shadow, lodDist); };
    const byMat = (name) => this.obstacles.filter((o) => o.type === 'box' && o.mat === name);
    const VC = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.photoMats ? photo('rust', 'diff', { gray: 0.8, contrast: 1.4 }) : null });

    // ---- trees ----
    const pines = this.trees.filter((t) => t.kind === 'pine'), oaks = this.trees.filter((t) => t.kind === 'oak');
    const barkMat = this.photoMats ? mats.log : L(tex('bark'));
    inst(M.trunkGeometry(), barkMat, this.trees.map((t) => ({ x: t.x, y: t.y - 0.3, z: t.z, ry: t.rot, sx: t.s, sy: (t.kind === 'pine' ? 3.4 : 4.2) * t.s, sz: t.s })));
    const leafTex = hasPhoto('leaves') ? photo('leaves', 'diff', { gray: 0.88, contrast: 1.5 }) : null;
    const pineMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: leafTex || tex('leaves', { color: '#b0b0b0' }) });
    const oakMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: leafTex || tex('leaves', { color: '#b8b8b8' }) });
    if (winter) { pineMat.color.set(0xa8b0ac); oakMat.color.set(0x8a7c66); }
    const tint = (t) => 0.85 + ((t.rot * 1000) % 1) * 0.3;
    inst(M.pineGeometry(), pineMat, pines.map((t) => ({ x: t.x, y: t.y - 0.3, z: t.z, ry: t.rot, sx: t.s, sy: t.s * (0.9 + (t.rot % 1) * 0.3), sz: t.s, c: 0xffffff, v: tint(t) })));
    inst(M.oakGeometry(), oakMat, oaks.map((t) => ({ x: t.x, y: t.y - 0.3, z: t.z, ry: t.rot, sx: t.s, sy: t.s * (0.9 + (t.rot % 1) * 0.3), sz: t.s, c: 0xffffff, v: tint(t) })));

    // ---- hedgerows: irregular foliage masses over the solid core ----
    const leafMat = new THREE.MeshLambertMaterial({ map: leafTex || tex('leaves', { color: '#c0c0c0' }) });
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
    inst(bagGeo, this.photoMats ? new THREE.MeshLambertMaterial({ map: photo('hessian', 'diff', { gray: 0.82, contrast: 1.2 }), normalMap: photo('hessian', 'nor') }) : L(tex('sandbag')), bags);

    // ---- rocks and rubble ----
    const rockGeo = M.blobGeometry(1, 7, 0.35);
    const rockMat = new THREE.MeshLambertMaterial({ map: this.photoMats ? photo('rock', 'diff', { gray: 0.75 }) : tex('stone'), normalMap: this.photoMats ? photo('rock', 'nor') : null, flatShading: true });
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
      for (let i = 0; i < 3000 && bushes.length < 550 * SZ * SZ; i++) {
        const x = (r() - 0.5) * 236 * SZ, z = (r() - 0.5) * 236 * SZ;
        if (this.water && z > 30) continue;
        if (!this.boxFree(x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0) || !this.isClear(x, z, 1)) continue;
        const sc = 0.45 + r() * 0.8;
        bushes.push({ x, y: this.H(x, z) + sc * 0.25, z, ry: r() * 6, sx: sc * 1.3, sy: sc * 0.85, sz: sc * 1.3, c: greens[(r() * greens.length) | 0] });
      }
      inst(blob, leafMat, bushes, true, 360);
    }
    if (!winter && terr !== 'city') {
      // unlit so both sides of each blade read the same; tinted to sit with the lit ground
      const gmat = new THREE.MeshBasicMaterial({ map: M.grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, color: terr === 'forest' ? 0x6e745c : 0x8c9472 });
      const tufts = [];
      const N = Math.round((terr === 'town' ? 3000 : 7000) * SZ * 1.3);
      for (let i = 0; i < N * 2 && tufts.length < N; i++) {
        const x = (r() - 0.5) * 250 * SZ, z = (r() - 0.5) * 250 * SZ;
        if (this.water && z > 22) continue;
        if (!this.boxFree(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0)) continue;
        const sc = 0.7 + r() * 0.9;
        tufts.push({ x, y: this.H(x, z) - 0.03, z, ry: r() * 6, sx: sc, sy: sc * (0.8 + r() * 0.6), sz: sc });
      }
      inst(M.grassGeometry(), gmat, tufts, false, 140);
    }
    this._buildClutterMeshes(inst, mats);
    if (this.assets) this._buildAssetMeshes();
  }

  waterOffset() { return this.big && this.cfg.terrain === 'beach' ? HALF - 200 : 0; }

  // show/hide distance-limited chunks (grass, bushes) around the camera
  updateLOD(cam) {
    for (const l of this.lod) l.mesh.visible = Math.hypot(l.x - cam.x, l.z - cam.z) < l.d + CHUNK * 0.71;
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
        if (o.type === 'house') {
          const tb = rayBox(ox, oy, oz, dx, dy, dz, o);
          if (tb < 0 || tb >= best) continue;
          for (const q of o.parts) { const t = rayBox(ox, oy, oz, dx, dy, dz, q); if (t >= 0 && t < best) { best = t; hitObj = q; } }
          continue;
        }
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
    const m = r * 0.5;
    for (const o of this.cells[cz * CN + cx]) {
      if (o.type === 'cyl') continue;
      if (!(x > o.x0 - m && x < o.x1 + m && z > o.z0 - m && z < o.z1 + m)) continue;
      if (o.type === 'house') {
        for (const q of o.parts) if (x > q.x0 - m && x < q.x1 + m && z > q.z0 - m && z < q.z1 + m && q.y1 <= feetY + 0.65 && q.y1 > g) g = q.y1;
      } else if (o.y1 <= feetY + 0.65 && o.y1 > g) g = o.y1;
    }
    return g;
  }

  // Push a circle out of obstacles. p: {x, y(feet), z}
  collide(p, r, height = 1.8) {
    const cx = clamp(Math.floor((p.x + EXT) / CS), 0, CN - 1), cz = clamp(Math.floor((p.z + EXT) / CS), 0, CN - 1);
    let hit = false;
    const st = ++this.stamp;
    for (let j = Math.max(0, cz - 1); j <= Math.min(CN - 1, cz + 1); j++) for (let i = Math.max(0, cx - 1); i <= Math.min(CN - 1, cx + 1); i++) {
      for (const o of this.cells[j * CN + i]) {
        if (o.st === st) continue; o.st = st;
        if (o.y1 <= p.y + 0.6 || o.y0 >= p.y + height) continue;
        if (o.type === 'house') {
          if (p.x < o.x0 - r || p.x > o.x1 + r || p.z < o.z0 - r || p.z > o.z1 + r) continue;
          for (const q of o.parts) if (!(q.y1 <= p.y + 0.6 || q.y0 >= p.y + height) && pushBox(p, r, q)) hit = true;
        } else if (o.type === 'box') { if (pushBox(p, r, o)) hit = true; }
        else {
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
    this.navH = new Float32Array(NN * NN);
    for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) this.navH[j * NN + i] = this.H(-HALF + i * NAV, -HALF + j * NAV);
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
    if (this.navPoints) {
      for (const p of this.navPoints) this._fixPoint(p);
      this.extraTargets = this.navPoints;
      this.navPoints.forEach((p, k) => (p.idx = this.flags.length + k));
    } else if (this.assets) {
      for (const w of [...this.wpAxis, ...this.wpAllies]) this._fixPoint(w);
      const at = this.assets.map((a) => { const t = { x: a.x, z: a.z + a.r + 4, radius: a.r + 6, asset: a }; this._fixPoint(t); return t; });
      this.extraTargets = [...at, this.exfil, ...this.wpAxis, ...this.wpAllies];
      const base = this.flags.length;
      this.assets.forEach((a, k) => (a.target = base + k));
      this.exfilIdx = base + this.assets.length;
      this.wpAxisIdx = this.wpAxis.map((w, k) => this.exfilIdx + 1 + k);
      this.wpAlliesIdx = this.wpAllies.map((w, k) => this.exfilIdx + 1 + this.wpAxis.length + k);
    }
    this.targets = [...this.flags, ...(this.extraTargets || [])];
    this.flow = this.targets.map((f) => this._dijkstra(f.x, f.z));
  }
  navCell(x, z) { return [clamp(Math.floor((x + HALF) / NAV), 0, NN - 1), clamp(Math.floor((z + HALF) / NAV), 0, NN - 1)]; }
  _dijkstra(gx, gz, maxD = Infinity) {
    const dist = new Float64Array(NN * NN).fill(1e9); // 64-bit: f32 rounding causes endless re-expansion on flat ground
    const [si, sj] = this.navCell(gx, gz);
    const heap = new MinHeap();
    dist[sj * NN + si] = 0; heap.push(0, sj * NN + si);
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let guard = 0;
    while (heap.size) {
      if (++guard > NN * NN * 12) { console.warn('nav: flow field aborted', gx, gz, heap.size); break; }
      const [d, k] = heap.pop();
      if (d > dist[k]) continue;
      if (d > maxD) break;
      const i = k % NN, j = (k / NN) | 0;
      for (const [di, dj, c] of nb) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= NN || nj >= NN) continue;
        const nk = nj * NN + ni;
        if (this.blocked[nk]) continue;
        if (di && dj && (this.blocked[j * NN + ni] || this.blocked[nj * NN + i])) continue;
        // slope cost
        const nd = d + c * (1 + Math.abs(this.navH[nk] - this.navH[k]) * 0.5);
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
      const fl = this.targets[f];
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

function pushBox(p, r, o) {
  const qx = clamp(p.x, o.x0, o.x1), qz = clamp(p.z, o.z0, o.z1);
  const dx = p.x - qx, dz = p.z - qz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = qx + dx / d * r; p.z = qz + dz / d * r; }
  else { // inside: push out along the smallest axis
    const pens = [p.x - o.x0, o.x1 - p.x, p.z - o.z0, o.z1 - p.z];
    const m = Math.min(...pens), k = pens.indexOf(m);
    if (k === 0) p.x = o.x0 - r; else if (k === 1) p.x = o.x1 + r; else if (k === 2) p.z = o.z0 - r; else p.z = o.z1 + r;
  }
  return true;
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

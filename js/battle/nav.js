// Two-level navigation for the AI.
//  - Fine grid (1 m): every wall, hedge, building, trunk and pole rasterised, padded by body width.
//  - Coarse grid (NAV m): flow fields and A* run here; moving between two coarse cells is only
//    allowed if the straight line between their centres is clear on the fine grid.
// Paths are smoothed by string-pulling against the fine grid.
import { World, dims } from './world.js';
import { clamp } from '../util.js';

const FS = 1;            // fine cell size (m)
const BODY = 0.38;       // padding: soldier radius
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

class Heap {
  constructor() { this.k = []; this.v = []; this.n = 0; }
  push(key, val) {
    let i = this.n++; this.k[i] = key; this.v[i] = val;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = key; this.v[i] = val;
  }
  pop() {
    const v = this.v[0], k = this.k[0];
    const lk = this.k[--this.n], lv = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= lk) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = lk; this.v[i] = lv;
    this.popKey = k;
    return v;
  }
}

const N = {};

N._buildNav = function () {
  const { HALF, NAV, NN, EXT, CS, CN } = dims();
  // ---- fine occupancy grid ----
  const FN = Math.ceil((HALF * 2) / FS);
  this.FN = FN;
  const fine = new Uint8Array(FN * FN);
  this.fine = fine;
  const markBox = (x0, z0, x1, z1) => {
    const i0 = clamp(Math.floor((x0 - BODY + HALF) / FS), 0, FN - 1), i1 = clamp(Math.floor((x1 + BODY + HALF) / FS), 0, FN - 1);
    const j0 = clamp(Math.floor((z0 - BODY + HALF) / FS), 0, FN - 1), j1 = clamp(Math.floor((z1 + BODY + HALF) / FS), 0, FN - 1);
    for (let j = j0; j <= j1; j++) fine.fill(1, j * FN + i0, j * FN + i1 + 1);
  };
  for (const o of this.obstacles) {
    if (o.type !== 'cyl') { // boxes and whole houses (the AI moves inside houses on its own scripted legs)
      const g = Math.min(this.H(o.x0, o.z0), this.H(o.x1, o.z1), this.H((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2));
      if (o.y1 - g < 0.7) continue; // low enough to step over
      if (o.x1 < -HALF || o.x0 > HALF || o.z1 < -HALF || o.z0 > HALF) continue;
      markBox(o.x0, o.z0, o.x1, o.z1);
    } else {
      if (Math.abs(o.x) > HALF || Math.abs(o.z) > HALF) continue;
      const R = o.r + BODY;
      const i0 = clamp(Math.floor((o.x - R + HALF) / FS), 0, FN - 1), i1 = clamp(Math.floor((o.x + R + HALF) / FS), 0, FN - 1);
      const j0 = clamp(Math.floor((o.z - R + HALF) / FS), 0, FN - 1), j1 = clamp(Math.floor((o.z + R + HALF) / FS), 0, FN - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = -HALF + (i + 0.5) * FS, cz = -HALF + (j + 0.5) * FS;
        // a cell counts as blocked if the trunk circle (plus body) covers its centre
        if ((cx - o.x) ** 2 + (cz - o.z) ** 2 < R * R) fine[j * FN + i] = 1;
      }
    }
  }
  // ---- coarse grid: height, blocked centres, crowding cost, passable edges ----
  this.blocked = new Uint8Array(NN * NN);
  this.navH = new Float32Array(NN * NN);
  this.cellCost = new Float32Array(NN * NN);
  this.edges = new Uint8Array(NN * NN);
  const per = Math.round(NAV / FS);
  for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
    const k = j * NN + i;
    const x = -HALF + (i + 0.5) * NAV, z = -HALF + (j + 0.5) * NAV;
    this.navH[k] = this.H(-HALF + i * NAV, -HALF + j * NAV);
    this.blocked[k] = this.fineBlocked(x, z) ? 1 : 0;
    // crowding: share of the cell's fine cells that are obstructed (walls, thickets)
    let c = 0;
    const fi0 = i * per, fj0 = j * per;
    for (let b = 0; b < per; b++) for (let a = 0; a < per; a++) c += fine[(fj0 + b) * FN + fi0 + a];
    this.cellCost[k] = 1 + 2.2 * (c / (per * per));
  }
  for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
    const k = j * NN + i;
    if (this.blocked[k]) continue;
    const x = -HALF + (i + 0.5) * NAV, z = -HALF + (j + 0.5) * NAV;
    let m = 0;
    DIRS.forEach(([di, dj], bit) => {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= NN || nj >= NN || this.blocked[nj * NN + ni]) return;
      if (this.lineWalk(x, z, x + di * NAV, z + dj * NAV)) m |= 1 << bit;
    });
    this.edges[k] = m;
  }
  // connected areas: every navigation point is snapped into the largest one
  const comp = new Int32Array(NN * NN).fill(-1);
  let nc = 0, bestC = 0, bestSize = 0;
  for (let k0 = 0; k0 < NN * NN; k0++) {
    if (this.blocked[k0] || comp[k0] >= 0) continue;
    const q = [k0]; comp[k0] = nc; let size = 0;
    while (q.length) {
      const k = q.pop(); size++;
      const i = k % NN, j = (k / NN) | 0, em = this.edges[k];
      for (let bit = 0; bit < 8; bit++) if (em & (1 << bit)) { const nk = (j + DIRS[bit][1]) * NN + i + DIRS[bit][0]; if (comp[nk] < 0) { comp[nk] = nc; q.push(nk); } }
    }
    if (size > bestSize) { bestSize = size; bestC = nc; }
    nc++;
  }
  this.comp = comp; this.mainComp = bestC;
  this._indexBuildings();
  // targets & flow fields (as before)
  if (this.navPoints) {
    for (const p of this.navPoints) this._snapMain(p);
    this.extraTargets = this.navPoints;
    this.navPoints.forEach((p, k) => (p.idx = this.flags.length + k));
  }
  for (const f of this.flags) this._snapMain(f);
  this.targets = [...this.flags, ...(this.extraTargets || [])];
  this.flow = this.targets.map((f) => this._dijkstra(f.x, f.z));
  this._pathQ = [];
  this._astar = null;
};

// Buildings the AI can use: a lookup grid over their footprints, and doors that open onto
// ground connected to the rest of the map.
N._indexBuildings = function () {
  const { HALF } = dims();
  const FN = this.FN;
  this.bldGrid = new Int16Array(FN * FN).fill(-1);
  for (const B of this.buildings) {
    B.ok = false;
    if (B.x0 < -HALF + 3 || B.x1 > HALF - 3 || B.z0 < -HALF + 3 || B.z1 > HALF - 3) continue;
    for (const d of B.doors) {
      d.ok = !this.fineBlocked(d.o.x, d.o.z) && this.comp[this.navStart(d.o.x, d.o.z)] === this.mainComp;
    }
    const i0 = clamp(Math.floor((B.x0 + HALF) / FS), 0, FN - 1), i1 = clamp(Math.floor((B.x1 + HALF) / FS), 0, FN - 1);
    const j0 = clamp(Math.floor((B.z0 + HALF) / FS), 0, FN - 1), j1 = clamp(Math.floor((B.z1 + HALF) / FS), 0, FN - 1);
    for (let j = j0; j <= j1; j++) this.bldGrid.fill(B.idx, j * FN + i0, j * FN + i1 + 1);
    B.ok = B.doors.some((d) => d.ok) && B.posts.length > 0;
  }
};
// index of the building whose interior contains (x, z), or -1
N.bldAt = function (x, z) {
  if (!this.bldGrid) return -1;
  const { HALF } = dims();
  const i = Math.floor((x + HALF) / FS), j = Math.floor((z + HALF) / FS);
  if (i < 0 || j < 0 || i >= this.FN || j >= this.FN) return -1;
  const k = this.bldGrid[j * this.FN + i];
  if (k < 0) return -1;
  const B = this.buildings[k];
  return x > B.ix0 && x < B.ix1 && z > B.iz0 && z < B.iz1 ? k : -1;
};
N.bldLevel = function (B, y) { return B.stair && y > B.floor + 1.6 ? 1 : 0; };
// a free firing post in a building near (x, z); ex/ez: where the enemy is expected from
N.freePost = function (x, z, R, ex, ez, self, onlyB) {
  let best = null, bs = Infinity;
  for (const B of this.buildings) {
    if (!B.ok || (onlyB !== undefined && B.idx !== onlyB)) continue;
    const dc = Math.hypot(B.cx - x, B.cz - z);
    if (dc > R) continue;
    for (const p of B.posts) {
      if (p.occ && p.occ !== self && p.occ.alive) continue;
      let s = dc * 0.5 + Math.random() * 5 - p.lvl * 2;
      if (ex !== undefined) {
        const dx = ex - p.x, dz = ez - p.z, L = Math.hypot(dx, dz) || 1, f = (dx * p.nx + dz * p.nz) / L;
        s -= f * 10; if (f < -0.3) s += 25;
      }
      if (s < bs) { bs = s; best = p; }
    }
  }
  return best;
};
N.nearestDoor = function (B, x, z) {
  let best = null, bd = Infinity;
  for (const d of B.doors) { const dd = Math.hypot(d.o.x - x, d.o.z - z) + (d.ok ? 0 : 1000); if (dd < bd) { bd = dd; best = d; } }
  return best;
};

// move a point to the nearest cell of the main connected area
N._snapMain = function (p) {
  const { HALF, NAV, NN } = dims();
  const [i, j] = this.navCell(p.x, p.z);
  if (this.comp[j * NN + i] === this.mainComp) return;
  for (let r = 1; r < 40; r++) {
    let best = null, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= NN || nj >= NN || this.comp[nj * NN + ni] !== this.mainComp) continue;
      const d = di * di + dj * dj; if (d < bd) { bd = d; best = [ni, nj]; }
    }
    if (best) { p.x = -HALF + (best[0] + 0.5) * NAV; p.z = -HALF + (best[1] + 0.5) * NAV; return; }
  }
};

N.fineBlocked = function (x, z) {
  const { HALF } = dims();
  const i = Math.floor((x + HALF) / FS), j = Math.floor((z + HALF) / FS);
  if (i < 0 || j < 0 || i >= this.FN || j >= this.FN) return true;
  return this.fine[j * this.FN + i] === 1;
};

// Can a soldier walk straight from A to B? (checked on the fine grid)
// slack: ignore the first/last metres (a soldier can stand right next to a wall)
N.lineWalk = function (x0, z0, x1, z1, slack = 0) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(L / (FS * 0.5)));
  for (let s = 0; s <= n; s++) {
    const t = s / n, d = t * L;
    if (slack && (d < slack || L - d < slack)) continue;
    if (this.fineBlocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
};

// nearest coarse cell with a free centre that can be walked to from (x, z)
N.navStart = function (x, z) {
  const { HALF, NAV, NN } = dims();
  const [i, j] = this.navCell(x, z);
  if (!this.blocked[j * NN + i]) return j * NN + i;
  let best = -1, bd = Infinity;
  for (let r = 1; r <= 3 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= NN || nj >= NN || this.blocked[nj * NN + ni]) continue;
    const cx = -HALF + (ni + 0.5) * NAV, cz = -HALF + (nj + 0.5) * NAV, d = Math.hypot(cx - x, cz - z);
    if (d < bd && (this.lineWalk(x, z, cx, cz) || r === 3)) { bd = d; best = nj * NN + ni; }
  }
  return best < 0 ? j * NN + i : best;
};

N._dijkstra = function (gx, gz, maxD = Infinity) {
  const { NN } = dims();
  const dist = new Float64Array(NN * NN).fill(1e9);
  const s = this.navStart(gx, gz);
  const heap = new Heap();
  dist[s] = 0; heap.push(0, s);
  const nav = this;
  while (heap.n) {
    const k = heap.pop(), d = heap.popKey;
    if (d > dist[k]) continue;
    if (d > maxD) break;
    const i = k % NN, j = (k / NN) | 0;
    // edges are symmetric, so the passability of k's own edges is used for k <- neighbour
    const em = nav.edges[k];
    for (let bit = 0; bit < 8; bit++) {
      if (!(em & (1 << bit))) continue;
      const [di, dj, c] = DIRS[bit];
      const nk = (j + dj) * NN + i + di;
      const nd = d + c * 0.5 * (nav.cellCost[k] + nav.cellCost[nk]) * (1 + Math.abs(nav.navH[nk] - nav.navH[k]) * 0.4);
      if (nd < dist[nk]) { dist[nk] = nd; heap.push(nd, nk); }
    }
  }
  return dist;
};

// Look-ahead flow following: walk the field's gradient a few cells ahead and head for the
// farthest of those cells that can be reached in a straight line.
N.flowTarget = function (x, z, f) {
  const { HALF, NAV, NN } = dims();
  const dist = this.flow[f];
  let k = this.navStart(x, z);
  let best = null;
  for (let step = 0; step < 7; step++) {
    const i = k % NN, j = (k / NN) | 0;
    let nk = -1, nd = dist[k];
    const em = this.edges[k];
    for (let bit = 0; bit < 8; bit++) {
      if (!(em & (1 << bit))) continue;
      const [di, dj] = DIRS[bit];
      const c = (j + dj) * NN + i + di;
      if (dist[c] < nd - 1e-6) { nd = dist[c]; nk = c; }
    }
    if (nk < 0) break;
    k = nk;
    const cx = -HALF + ((k % NN) + 0.5) * NAV, cz = -HALF + (((k / NN) | 0) + 0.5) * NAV;
    if (this.lineWalk(x, z, cx, cz, 0.9)) best = { x: cx, z: cz }; else if (best) break;
  }
  if (best) return best;
  // at the goal cell or no gradient: head for the target itself
  const t = this.targets[f];
  return { x: t.x, z: t.z, end: true };
};
// kept for older callers
N.flowDir = function (x, z, f) {
  const t = this.flowTarget(x, z, f);
  const dx = t.x - x, dz = t.z - z, L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
};

// A* between two points on the coarse grid, smoothed on the fine grid.
// Returns a list of {x, z} waypoints (excluding the start) or null.
N.findPath = function (x0, z0, x1, z1, maxExpand = 9000) {
  const { HALF, NAV, NN } = dims();
  if (this.lineWalk(x0, z0, x1, z1, 0.9)) return [{ x: x1, z: z1 }];
  if (!this._astar) this._astar = { g: new Float32Array(NN * NN), came: new Int32Array(NN * NN), stamp: new Uint32Array(NN * NN), closed: new Uint32Array(NN * NN), id: 0 };
  const A = this._astar; const id = ++A.id;
  const s = this.navStart(x0, z0), goal = this.navStart(x1, z1);
  const gi = goal % NN, gj = (goal / NN) | 0;
  const hfun = (k) => { const dx = Math.abs((k % NN) - gi), dz = Math.abs(((k / NN) | 0) - gj); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)); };
  const heap = new Heap();
  A.g[s] = 0; A.stamp[s] = id; A.came[s] = -1; heap.push(hfun(s), s);
  let bestK = s, bestH = hfun(s), n = 0, found = false;
  while (heap.n && n++ < maxExpand) {
    const k = heap.pop();
    if (A.closed[k] === id) continue;
    A.closed[k] = id;
    if (k === goal) { found = true; bestK = k; break; }
    const h = hfun(k); if (h < bestH) { bestH = h; bestK = k; }
    const i = k % NN, j = (k / NN) | 0, em = this.edges[k];
    for (let bit = 0; bit < 8; bit++) {
      if (!(em & (1 << bit))) continue;
      const [di, dj, c] = DIRS[bit];
      const nk = (j + dj) * NN + i + di;
      if (A.closed[nk] === id) continue;
      const ng = A.g[k] + c * 0.5 * (this.cellCost[k] + this.cellCost[nk]) * (1 + Math.abs(this.navH[nk] - this.navH[k]) * 0.4);
      if (A.stamp[nk] !== id || ng < A.g[nk]) { A.stamp[nk] = id; A.g[nk] = ng; A.came[nk] = k; heap.push(ng + hfun(nk), nk); }
    }
  }
  // rebuild (to the goal, or as close as we got)
  const cells = [];
  for (let k = bestK; k !== -1 && cells.length < 4000; k = A.came[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => ({ x: -HALF + ((k % NN) + 0.5) * NAV, z: -HALF + (((k / NN) | 0) + 0.5) * NAV }));
  if (found) pts.push({ x: x1, z: z1 });
  if (!pts.length) return null;
  // string pulling: from each point jump to the farthest one still in a straight walkable line
  const out = [];
  let cx = x0, cz = z0, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !this.lineWalk(cx, cz, pts[j].x, pts[j].z, 0.9)) j--;
    out.push(pts[j]); cx = pts[j].x; cz = pts[j].z; i = j + 1;
  }
  out.partial = !found;
  return out;
};

// Path requests are queued and served under a per-frame budget.
N.requestPath = function (bot, x, z) {
  if (bot._pathReq) { bot._pathReq.x = x; bot._pathReq.z = z; return; }
  bot._pathReq = { bot, x, z };
  this._pathQ.push(bot._pathReq);
};
N.servePaths = function (budget = 4) {
  for (let n = 0; n < budget && this._pathQ.length; n++) {
    const r = this._pathQ.shift();
    const b = r.bot; b._pathReq = null;
    if (!b.alive) continue;
    b.path = this.findPath(b.pos.x, b.pos.z, r.x, r.z);
    b.pathGoal = { x: r.x, z: r.z }; b.pathT = b.b.time;
  }
};

// Local steering: slide around trunks, poles and nearby bodies ahead.
N.steer = function (x, z, dx, dz) {
  const { EXT, CS, CN } = dims();
  const ci = clamp(Math.floor((x + EXT) / CS), 0, CN - 1), cj = clamp(Math.floor((z + EXT) / CS), 0, CN - 1);
  let ax = 0, az = 0;
  for (let j = Math.max(0, cj - 1); j <= Math.min(CN - 1, cj + 1); j++) for (let i = Math.max(0, ci - 1); i <= Math.min(CN - 1, ci + 1); i++) {
    for (const o of this.cells[j * CN + i]) {
      if (o.type !== 'cyl') continue;
      const ox = o.x - x, oz = o.z - z;
      const fwd = ox * dx + oz * dz;
      if (fwd <= 0 || fwd > 2.4) continue;
      const lat = ox * -dz + oz * dx; // signed lateral offset
      const need = o.r + 0.55;
      if (Math.abs(lat) > need) continue;
      const w = (1 - fwd / 2.4) * (need - Math.abs(lat)) / need;
      const side = lat > 0 ? -1 : 1; // steer away from the side the trunk is on
      ax += -dz * side * w * 1.6; az += dx * side * w * 1.6;
    }
  }
  if (!ax && !az) return [dx, dz];
  const nx = dx + ax, nz = dz + az, L = Math.hypot(nx, nz) || 1;
  return [nx / L, nz / L];
};

Object.assign(World.prototype, N);

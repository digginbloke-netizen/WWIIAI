// Full-size mission sectors (1 km x 1 km), generated fresh for every operation.
// Adds sector-generation methods to World.
import { World, dims } from './world.js';
import { clamp } from '../util.js';

const S = {};

// ---------- top level ----------
S._sectorLayout = function () {
  const r = this.rng, cfg = this.cfg, t = cfg.terrain, { HALF } = dims();
  const M = cfg.mission || {};
  this.flags = []; this.attSign = 1; this.laneX = null;
  this.spawns = { att: { x: 0, z: HALF - 20 }, def: { x: 0, z: -HALF + 20 } };
  const { HN } = dims();
  this.roadMask = new Float32Array(HN * HN);
  this.roads = []; this.settlements = []; this.strongpoints = []; this.navPoints = [];
  this.craters = []; this.poles = []; this.fencePosts = []; this.fenceRails = []; this.wire = [];
  this.hedgehogs = []; this.barrels = []; this.wrecks = [];
  const beach = t === 'beach';
  const coastZ = HALF - 108; // water begins here on beach sectors
  // insertion on the Allied (+z) side
  let ix = (r() - 0.5) * (2 * HALF - 200);
  if (cfg.landing) ix = clamp(ix, -HALF + 280, HALF - 280); // the whole landing zone and bunker line fit in the sector
  this.insert = { x: ix, z: beach ? coastZ - 30 : HALF - 25 };
  this.exfil = { x: ix, z: this.insert.z, radius: 14 };
  this.clear.push({ x: ix, z: this.insert.z, r: 22 });
  // settlements
  const want = { city: [1, 3], town: [1, 3], farmland: [0, 5], hills: [0, 3], forest: [0, 2], beach: [0, 3] }[t] || [0, 3];
  const zMax = beach ? HALF - 250 : HALF - 130;
  const place = (rad, zmax, avoidIns = 140) => {
    for (let k = 0; k < 400; k++) {
      const x = (r() - 0.5) * (2 * HALF - 2 * rad - 80), z = -HALF + rad + 40 + r() * (zmax - (-HALF + rad + 40));
      if (Math.hypot(x - this.insert.x, z - this.insert.z) < rad + avoidIns) continue;
      if (this.settlements.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + rad + 70)) continue;
      return { x, z };
    }
    return null;
  };
  if (want[0]) { const rad = t === 'city' ? 180 : 115; const p = place(rad, zMax * 0.5); if (p) this.settlements.push({ ...p, r: rad, kind: 'town' }); }
  for (let k = 0; k < want[1]; k++) { const rad = 36 + r() * 18; const p = place(rad, zMax); if (p) this.settlements.push({ ...p, r: rad, kind: 'hamlet' }); }
  for (const s of this.settlements) { this.flatten(s.x, s.z, s.r * 0.85, this.H(s.x, s.z), 30); this.clear.push({ x: s.x, z: s.z, r: s.r * 0.15 }); }
  this._placeSites(M, beach, coastZ);
  this._buildRoads(M, beach, coastZ);
  for (const s of this.settlements) s.kind === 'town' ? this._townArea(s) : this._hamlet(s);
  this._buildSites(M);
  this._fortLine(beach, coastZ);
  this._countryside(beach, coastZ);
  this._sectorClutter(beach, coastZ);
  this._navPlan();
};

// ---------- mission sites ----------
S._placeSites = function (M, beach, coastZ) {
  const r = this.rng, { HALF } = dims();
  const clampX = (x) => Math.max(-HALF + 60, Math.min(HALF - 60, x));
  const ins = this.insert;
  const free = (x, z, rad, minIns) => Math.hypot(x - ins.x, z - ins.z) > minIns && this.isClear(x, z, rad) &&
    !this.settlements.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + rad * 0.5) && Math.abs(x) < HALF - rad - 20 && z > -HALF + rad + 20 && z < (beach ? coastZ - 140 : HALF - 120);
  const spot = (rad, minIns, zBias = 0) => {
    for (let k = 0; k < 600; k++) {
      const x = (r() - 0.5) * (2 * HALF - 2 * rad - 60), z = -HALF + rad + 30 + r() * (2 * HALF - 2 * rad - 60) * (1 - zBias);
      if (free(x, z, rad, minIns)) return { x, z };
    }
    return { x: (r() - 0.5) * 300, z: -HALF * 0.6 };
  };
  // tactical assets (all mission types: secondaries; sabotage: one is primary)
  this.assets = [];
  for (const a of M.assets || []) {
    const p = spot(16, a.primary ? 420 : 260, 0.3);
    const rot = Math.floor(r() * 4) * Math.PI / 2;
    this.assets.push({ ...a, x: p.x, z: p.z, rot, alive: true, hp: { artillery: 260, flak: 240, fuel: 120, ammo: 140, radio: 220, trucks: 140, tank: 420 }[a.type] || 200 });
    this.clear.push({ x: p.x, z: p.z, r: 16 }); this.flatten(p.x, p.z, 12, this.H(p.x, p.z));
  }
  this.sites = {};
  if (M.type === 'raid') {
    const p = spot(60, 480, 0.4);
    this.sites.complex = { x: p.x, z: p.z, kind: M.complex || 'factory', rot: Math.floor(r() * 2) * Math.PI / 2 };
    this.clear.push({ x: p.x, z: p.z, r: 62 }); this.flatten(p.x, p.z, 58, this.H(p.x, p.z), 20);
  }
  if (M.type === 'capture') {
    const far = this.settlements.slice().sort((a, b) => Math.hypot(b.x - ins.x, b.z - ins.z) - Math.hypot(a.x - ins.x, a.z - ins.z))[0];
    const p = far ? { x: far.x + (r() - 0.5) * far.r * 0.4, z: far.z + (r() - 0.5) * far.r * 0.4 } : spot(20, 450, 0.4);
    this.sites.hq = p; this.clear.push({ x: p.x, z: p.z, r: 14 });
  }
  if (M.type === 'defense') {
    // the Allied position the Germans are attacking: a village on our side of the sector, or a dug-in crossroads
    const v = this.settlements.filter((s) => s.z > ins.z - 260 && s.z < ins.z - 80 && Math.abs(s.x) < HALF - 80).sort((a, b) => Math.abs(a.x - ins.x) - Math.abs(b.x - ins.x))[0];
    let p = v ? { x: v.x, z: v.z, r: Math.min(v.r, 38), village: true } : null;
    for (let k = 0; !p && k < 300; k++) {
      const x = clampX(ins.x + (r() - 0.5) * 260), z = ins.z - 140 - r() * 80;
      if (this.isClear(x, z, 24) && !this.settlements.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 30)) p = { x, z, r: 22 };
    }
    p = p || { x: ins.x, z: ins.z - 160, r: 22 };
    if (!p.village) { this.clear.push({ x: p.x, z: p.z, r: 26 }); this.flatten(p.x, p.z, 22, this.H(p.x, p.z)); }
    this.sites.defend = p;
  }
  if (M.type === 'rescue') {
    const p = spot(26, 420, 0.4);
    this.sites.pow = p; this.clear.push({ x: p.x, z: p.z, r: 28 }); this.flatten(p.x, p.z, 24, this.H(p.x, p.z));
  }
  if (M.type === 'recon') {
    // three observation points, each overlooking a German position
    const marks = [...this.settlements, ...this.assets].filter((m) => m.z < ins.z - 200).sort(() => r() - 0.5).slice(0, 3);
    while (marks.length < 3) { const p = spot(10, 300); marks.push(p); }
    this.sites.ops = marks.map((m) => {
      const dx = ins.x - m.x, dz = ins.z - m.z, L = Math.hypot(dx, dz) || 1, d = (m.r || 16) + 70;
      return { x: m.x + dx / L * d, z: m.z + dz / L * d, watch: { x: m.x, z: m.z }, done: false, t: 0 };
    });
  }
};

// ---------- roads ----------
S._stampRoad = function (pts, w = 6) {
  const { EXT, HS, HN } = dims();
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d <= L; d += 4) {
      const x = ax + (bx - ax) * d / L, z = az + (bz - az) * d / L;
      this.clear.push({ x, z, r: w * 0.5 + 0.5, road: true });
      const i0 = Math.floor((x - w + EXT) / HS), i1 = Math.ceil((x + w + EXT) / HS), j0 = Math.floor((z - w + EXT) / HS), j1 = Math.ceil((z + w + EXT) / HS);
      for (let j = Math.max(0, j0); j <= Math.min(HN - 1, j1); j++) for (let ii = Math.max(0, i0); ii <= Math.min(HN - 1, i1); ii++) {
        const px = -EXT + ii * HS, pz = -EXT + j * HS, dd = Math.hypot(px - x, pz - z);
        const v = clamp(1 - (dd - w * 0.35) / (w * 0.6), 0, 1);
        const k = j * HN + ii; if (v > this.roadMask[k]) this.roadMask[k] = v;
      }
    }
  }
  this.roads.push({ pts, w });
};
S._roadPath = function (a, b) {
  const r = this.rng;
  // gentle bends: two jittered midpoints
  const pts = [[a.x, a.z]];
  for (const f of [0.33, 0.66]) {
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, L = Math.hypot(b.x - a.x, b.z - a.z);
    pts.push([x + (r() - 0.5) * L * 0.15, z + (r() - 0.5) * L * 0.15]);
  }
  pts.push([b.x, b.z]);
  return pts;
};
S._buildRoads = function (M, beach, coastZ) {
  const r = this.rng, { HALF } = dims();
  const nodes = [...this.settlements.map((s) => ({ x: s.x, z: s.z })), ...this.assets.map((a) => ({ x: a.x, z: a.z + 22 }))];
  if (this.sites.complex) nodes.push({ x: this.sites.complex.x, z: this.sites.complex.z + 60 });
  // minimum spanning tree over the nodes
  if (nodes.length > 1) {
    const inT = [0], out = nodes.map((_, i) => i).slice(1);
    while (out.length) {
      let best = null, bd = Infinity;
      for (const i of inT) for (const j of out) { const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z); if (d < bd) { bd = d; best = [i, j]; } }
      this._stampRoad(this._roadPath(nodes[best[0]], nodes[best[1]]));
      inT.push(best[1]); out.splice(out.indexOf(best[1]), 1);
    }
  }
  // exits to the map edges
  const exits = [{ x: -HALF - 10, z: (r() - 0.5) * HALF }, { x: HALF + 10, z: (r() - 0.5) * HALF }, { x: (r() - 0.5) * HALF, z: -HALF - 10 }];
  if (!beach) exits.push({ x: this.insert.x + (r() - 0.5) * 120, z: HALF + 10 });
  for (const e of exits) {
    const n = nodes.length ? nodes.reduce((a, b) => (Math.hypot(a.x - e.x, a.z - e.z) < Math.hypot(b.x - e.x, b.z - e.z) ? a : b)) : { x: 0, z: 0 };
    this._stampRoad(this._roadPath(e, n));
  }
  // convoy route: a through-road from one side of the sector to the other
  if (M.type === 'ambush') {
    const z0 = -HALF * 0.1 + (r() - 0.5) * HALF * 0.4, z1 = -HALF * 0.3 + (r() - 0.5) * HALF * 0.4;
    const pts = [[-HALF - 30, z0], [-HALF * 0.4, z0 + (r() - 0.5) * 120], [HALF * 0.2, (z0 + z1) / 2 + (r() - 0.5) * 120], [HALF + 30, z1]];
    this._stampRoad(pts, 7);
    this.sites.convoy = pts;
  }
};

// ---------- settlements ----------
S._townArea = function (s) {
  const r = this.rng, city = this.cfg.terrain === 'city';
  const block = city ? 28 : 32;
  for (let bx = s.x - s.r; bx < s.x + s.r; bx += block) for (let bz = s.z - s.r; bz < s.z + s.r; bz += block) {
    const cx = bx + block / 2, cz = bz + block / 2;
    if (Math.hypot(cx - s.x, cz - s.z) > s.r - 8) continue;
    // main streets every block stay open (they're on the grid); place houses along block edges
    const n = city ? 4 : 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const w = 6 + Math.floor(r() * 3) * 2, d = 6 + Math.floor(r() * 2) * 2, side = k % 4, inset = 4;
      let hx = cx, hz = cz;
      if (side === 0) { hz = bz + inset + d / 2; hx = bx + 4 + w / 2 + r() * (block - w - 8); }
      if (side === 1) { hz = bz + block - inset - d / 2; hx = bx + 4 + w / 2 + r() * (block - w - 8); }
      if (side === 2) { hx = bx + inset + w / 2; hz = bz + 4 + d / 2 + r() * (block - d - 8); }
      if (side === 3) { hx = bx + block - inset - w / 2; hz = bz + 4 + d / 2 + r() * (block - d - 8); }
      if (!this.isClear(hx, hz, Math.max(w, d) / 2 + 1.5)) continue;
      const floors = city ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
      this.house(hx, hz, w, d, floors, { ruined: r() < (city ? 0.4 : 0.2), wall: ['wall', 'wall2', 'wall3'][Math.floor(r() * 3)], gable: city ? r() < 0.35 : true, roof: r() < 0.5 ? 'roof' : 'roof2' });
    }
  }
  this.strongpoints.push({ x: s.x, z: s.z, r: 22, kind: 'town' });
  for (let k = 0; k < (city ? 10 : 6); k++) {
    const a = r() * 6.28, d = r() * s.r * 0.8, x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
    if (this.isClear(x, z, 3)) this.sandbagWall(x, z, 4 + r() * 2, r() < 0.5);
  }
};
S._hamlet = function (s) {
  const r = this.rng, t = this.cfg.terrain;
  const n = 4 + Math.floor(r() * 5);
  const wall = t === 'hills' ? 'stonewall' : r() < 0.5 ? 'wall3' : 'wall';
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 6.28 + r() * 0.5, d = s.r * (0.35 + r() * 0.45);
    const w = 7 + r() * 5, dd = 6 + r() * 3;
    this.house(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, w, dd, 1 + (r() < 0.35 ? 1 : 0), { wall, ruined: r() < 0.25, roof: r() < 0.6 ? 'roof' : 'roof2' });
  }
  // farm walls / fences around the yard
  for (let k = 0; k < 3; k++) {
    const a = r() * 6.28, x = s.x + Math.cos(a) * s.r * 0.95, z = s.z + Math.sin(a) * s.r * 0.95, L = 8 + r() * 10, along = r() < 0.5;
    if (this.isClear(x, z, L / 2) && this.boxFree(x - L / 2, z - 0.4, x + L / 2, z + 0.4)) {
      if (along) this.solid('stone', x - L / 2, z - 0.35, x + L / 2, z + 0.35, 1.1, { us: 3, vs: 2 });
      else this.solid('stone', x - 0.35, z - L / 2, x + 0.35, z + L / 2, 1.1, { us: 3, vs: 2 });
    }
  }
  this.sandbagWall(s.x + (r() - 0.5) * 10, s.z + s.r * 0.5, 5, true);
  this.strongpoints.push({ x: s.x, z: s.z, r: 16, kind: 'hamlet' });
};

// ---------- mission-specific structures ----------
S._buildSites = function (M) {
  const r = this.rng;
  const D = this.sites.defend;
  if (D) {
    // field works facing the German side (-z): foxholes for the riflemen, sandbagged MG pits
    D.holdPts = [];
    for (let k = 0; k < 7; k++) {
      const a = Math.PI + (k - 3) * 0.32, rr = D.r + 4 + (k % 2) * 3;
      const x = D.x + Math.sin(a) * rr, z = D.z + Math.cos(a) * rr;
      if (k % 3 === 1) this.strongpoint(x, z, 2.0); else this.sandbagWall(x, z - 1.2, 3.5, true, 1.0);
      D.holdPts.push({ x, z: z + 1.0 });
    }
    for (let k = 0; k < 3; k++) D.holdPts.push({ x: D.x + (k - 1) * 8, z: D.z - 2 });
  }
  if (this.assets.length) this._assetStructures();
  const c = this.sites.complex;
  if (c) {
    // strategic complex: buildings for atmosphere plus three demolition points
    const sub = { factory: ['hall', 'boiler', 'generator'], railyard: ['loco', 'signal', 'loco'], fuelplant: ['storage', 'storage', 'pump'] }[c.kind] || ['hall', 'boiler', 'generator'];
    const offs = [[-26, -14], [22, -18], [0, 24]];
    if (c.kind === 'railyard') {
      for (let k = -2; k <= 2; k++) this.rails = (this.rails || []).concat([{ x0: c.x - 70, x1: c.x + 70, z: c.z + k * 5 }]);
    }
    if (c.kind === 'factory') { this.house(c.x - 30, c.z + 30, 26, 14, 2, { wall: 'wall2', gable: false }); this.house(c.x + 30, c.z + 30, 20, 12, 2, { wall: 'wall2', gable: false }); }
    if (c.kind === 'fuelplant') { this.house(c.x + 34, c.z + 30, 12, 8, 1, { wall: 'wall3' }); }
    sub.forEach((type, k) => {
      const [ox, oz] = offs[k];
      const asset = { id: `sub${k}`, type, sub: true, primary: true, x: c.x + ox, z: c.z + oz, rot: c.rot, alive: true, hp: 320 };
      this.assets.push(asset);
    });
    this._assetStructures(true);
    for (let k = 0; k < 6; k++) { const a = r() * 6.28; this.sandbagWall(c.x + Math.cos(a) * 52, c.z + Math.sin(a) * 52, 5, Math.abs(Math.sin(a)) > 0.7); }
    this.strongpoints.push({ x: c.x, z: c.z, r: 30, kind: 'complex' });
  }
  if (this.sites.hq) {
    const h = this.sites.hq;
    this.house(h.x + 8, h.z, 10, 8, 2, { wall: 'wall' });
    this.sandbagWall(h.x - 6, h.z + 7, 5, true); this.sandbagWall(h.x - 6, h.z - 7, 5, true);
    this.strongpoints.push({ x: h.x, z: h.z, r: 14, kind: 'hq' });
  }
  if (this.sites.pow) {
    const p = this.sites.pow;
    this.house(p.x, p.z - 10, 12, 7, 1, { wall: 'wood', roof: 'roof2' });
    // barbed-wire compound around the prisoners
    for (const [x0, z0, x1, z1] of [[-20, -18, 20, -18], [-20, 18, 20, 18], [-20, -18, -20, 18], [20, -18, 20, 6]]) this.wire.push({ x0: p.x + x0, z0: p.z + z0, x1: p.x + x1, z1: p.z + z1, L: Math.hypot(x1 - x0, z1 - z0) });
    this.strongpoints.push({ x: p.x, z: p.z, r: 20, kind: 'pow' });
  }
};

// ---------- fortifications ----------
// A German defensive line across front-line sectors: earth parapet with timber revetment and
// traverses, wire in front, bunkers, MG nests and dugouts behind. Scales with the region's fort level.
S._fortLine = function (beach, coastZ) {
  const r = this.rng, cfg = this.cfg, { HALF } = dims();
  const fort = cfg.fort || 0, front = cfg.depth === 0;
  if (!front && fort < 2) return;
  this.fortLine = [];
  const baseZ = beach ? (cfg.landing ? coastZ - 112 : coastZ - 185 - (cfg.defense ? 120 : 0)) : this.insert.z - (cfg.defense ? 340 : 230) - r() * 70;
  const zAt = (x) => baseZ + Math.sin(x * 0.012 + r() * 0.001) * 18;
  let x = -HALF + 25, bay = 0, gapIn = 60 + r() * 60;
  const sections = [];
  while (x < HALF - 25) {
    const L = 10, z = zAt(x) + (bay % 2 ? 1.6 : -1.6);
    gapIn -= L;
    if (gapIn <= 0) { gapIn = 70 + r() * 70; x += 7; bay++; continue; } // passage through the line
    if (this.isClear(x + L / 2, z, 3) && this.boxFree(x, z - 0.8, x + L, z + 0.8, 0.3)) {
      this._berm(x, x + L, z);
      // traverse linking to the next bay (the zigzag that stops blast and enfilade fire)
      const z2 = zAt(x + L) + (bay % 2 ? -1.6 : 1.6);
      if (this.boxFree(x + L - 0.6, Math.min(z, z2) - 0.6, x + L + 0.6, Math.max(z, z2) + 0.6, 0)) this._sandbags(x + L - 0.6, Math.min(z, z2) - 0.6, x + L + 0.6, Math.max(z, z2) + 0.6, 1.0, false);
      sections.push({ x: x + L / 2, z });
    }
    x += L; bay++;
  }
  if (!sections.length) return;
  this.fortLine = sections;
  this._stampRoad(sections.map((c) => [c.x, c.z - 1]), 7); this.roads.pop(); // trampled mud along the trench (not a road)
  for (let k = 0; k < 40; k++) {
    const cx = (r() - 0.5) * (2 * HALF - 40), cz = zAt(cx) + 25 + r() * 130;
    if (this.isClear(cx, cz, 2)) this.craters.push({ x: cx, z: cz, R: 2 + r() * 3 });
  }
  // wire belt in front of the parapet, with gaps
  for (let wx = -HALF + 30; wx < HALF - 30;) {
    const L = 18 + r() * 26, z = zAt(wx) + 15 + r() * 4;
    if (this.isClear(wx + L / 2, z, L / 2)) this.wire.push({ x0: wx, z0: z, x1: wx + L, z1: z, L });
    wx += L + 8 + r() * 8;
  }
  // bunkers, MG nests and dugouts along the line
  const nB = Math.min(5, 1 + fort + (front ? 1 : 0));
  for (let k = 0; k < nB; k++) { const sct = sections[Math.floor((k + 0.5) / nB * sections.length)]; this.bunker(sct.x + 4, sct.z - 7, 1); }
  for (let k = 0; k < 4 + fort * 2; k++) {
    const sct = sections[Math.floor(r() * sections.length)];
    this.strongpoint(sct.x, sct.z - 6, 2.2); // sandbagged MG nest just behind the parapet
  }
  this.dugouts = [];
  for (let k = 0; k < 4 + fort; k++) {
    const sct = sections[Math.floor(r() * sections.length)], dx = sct.x + (r() - 0.5) * 6, dz = sct.z - 9;
    if (!this.boxFree(dx - 3, dz - 2.4, dx + 3, dz + 2.4, 0.5)) continue;
    const g = this.H(dx, dz);
    // collision: the flat-topped core, and a low skirt under the sloping sides
    this.addObstacle({ type: 'box', x0: dx - 2.0, x1: dx + 2.0, z0: dz - 1.4, z1: dz + 1.4, y0: g - 0.5, y1: g + 1.75, mat: 'earth' });
    this.addObstacle({ type: 'box', x0: dx - 2.9, x1: dx + 2.9, z0: dz - 2.3, z1: dz + 2.3, y0: g - 0.5, y1: g + 0.6, mat: 'earth' });
    this.at(dx, dz);
    // sloped earth cover over a log frame, doorway framed in timber on the side away from the enemy
    this._mound(dx - 3.6, dx + 3.6, dz - 3.0, dz + 3.0, g, 1.75, 1.6);
    for (let lx = -1.5; lx <= 1.5; lx += 0.5) this.batch('log').box(dx + lx - 0.14, g + 1.7, dz - 1.4, dx + lx + 0.14, g + 1.95, dz + 1.4, 2, 1); // logs over the roof
    this.batch('shadow').box(dx - 0.6, g - 0.2, dz - 2.45, dx + 0.6, g + 1.25, dz - 2.4, 2, 2, false);                // dark doorway
    this.batch('log').box(dx - 0.8, g - 0.2, dz - 2.55, dx - 0.6, g + 1.4, dz - 2.35, 2, 1);
    this.batch('log').box(dx + 0.6, g - 0.2, dz - 2.55, dx + 0.8, g + 1.4, dz - 2.35, 2, 1);
    this.batch('log').box(dx - 0.9, g + 1.25, dz - 2.6, dx + 0.9, g + 1.5, dz - 2.3, 2, 1);
    this.dugouts.push({ x: dx, z: dz - 3 });
  }
  // the line is held in sections: hold points along the back of the parapet
  const per = 9;
  for (let k = 0; k < sections.length; k += per) {
    const chunk = sections.slice(k, k + per);
    const mid = chunk[Math.floor(chunk.length / 2)];
    const holdPts = chunk.flatMap((c) => [{ x: c.x - 2.5, z: c.z - 2.0 }, { x: c.x + 2.5, z: c.z - 2.0 }]);
    this.strongpoints.push({ x: mid.x, z: mid.z - 3, r: 32, kind: 'line', holdPts, face: 0 });
  }
  // Allied jump-off foxholes when the Allies are attacking here
  if (cfg.front && cfg.front.attacker === 'allies') for (let k = 0; k < 8; k++) {
    const fx = (r() - 0.5) * (2 * HALF - 100), fz = HALF - 70 - r() * 80;
    if (this.isClear(fx, fz, 3)) this.strongpoint(fx, fz, 1.8);
  }
};

// Trench parapet: earth berm with a gentle slope toward the Allies (+z), a timber revetment on the
// trench side and a row of sandbags on the crest. Collision is a box; the slope is visual.
S._berm = function (X0, X1, zc) {
  const b = this.batch('earth'), w = this.batch('revet'), sb = this.batch('sandbag');
  const zb = zc - 0.65, zt = zc + 0.35, zf = zc + 3.0, h = 1.0;
  const P = (x, g, y, z) => [x, g + y, z];
  // built in 5 m pieces so the earth, the sandbags and the collision all follow the ground
  const N = Math.max(1, Math.round((X1 - X0) / 5));
  let first = null;
  for (let k = 0; k < N; k++) {
    const x0 = X0 + (X1 - X0) * k / N, x1 = X0 + (X1 - X0) * (k + 1) / N;
    const gA = this.H(x0, zc), gB = this.H(x1, zc), lo = Math.min(gA, gB), gm = (gA + gB) / 2;
    const L = (x1 - x0) / 3, u0 = x0 / 3;
    b.quad(P(x0, gA, h, zt), P(x1, gB, h, zt), P(x1, gB, h, zb), P(x0, gA, h, zb), [0, 1, 0], [[u0, 0], [u0 + L, 0], [u0 + L, 0.3], [u0, 0.3]]);
    const ny = (zf - zt) / Math.hypot(zf - zt, h), nz = h / Math.hypot(zf - zt, h);
    b.quad(P(x0, gA, -0.15, zf), P(x1, gB, -0.15, zf), P(x1, gB, h, zt), P(x0, gA, h, zt), [0, ny, nz], [[u0, 0], [u0 + L, 0], [u0 + L, 1], [u0, 1]]);
    if (k === 0) {
      b.tri(P(x0, gA, -0.3, zb), P(x0, gA, -0.15, zf), P(x0, gA, h, zt), [[0, 0], [1, 0], [0.3, 0.4]]);
      b.tri(P(x0, gA, -0.3, zb), P(x0, gA, h, zt), P(x0, gA, h, zb), [[0, 0], [0.3, 0.4], [0, 0.4]]);
    }
    if (k === N - 1) {
      b.tri(P(x1, gB, -0.15, zf), P(x1, gB, -0.3, zb), P(x1, gB, h, zt), [[1, 0], [0, 0], [0.3, 0.4]]);
      b.tri(P(x1, gB, h, zt), P(x1, gB, -0.3, zb), P(x1, gB, h, zb), [[0.3, 0.4], [0, 0], [0, 0.4]]);
    }
    // timber revetment on the trench side, posts every 2.4 m
    w.box(x0, lo - 0.3, zb - 0.08, x1, gm + h, zb, 2, 1);
    for (let px = x0 + 0.4; px < x1; px += 2.4) this.batch('log').box(px - 0.09, lo - 0.3, zb - 0.22, px + 0.09, this.H(px, zc) + h + 0.15, zb - 0.06, 2, 1);
    // sandbags on the crest
    sb.box(x0 + 0.05, gm + h - 0.05, zb + 0.05, x1 - 0.05, gm + h + 0.32, zb + 0.65, 0.9, 0.35);
    // collision matches what you see: sandbag row, bare crest, then two low steps under the front slope
    const bags = this.addObstacle({ type: 'box', x0, x1, z0: zb - 0.1, z1: zb + 0.65, y0: lo - 0.4, y1: gm + h + 0.32, mat: 'sandbag' });
    this.addObstacle({ type: 'box', x0, x1, z0: zb + 0.65, z1: zt, y0: lo - 0.4, y1: Math.min(gA, gB) + h, mat: 'earth' });
    this.addObstacle({ type: 'box', x0, x1, z0: zt, z1: zt + 0.9, y0: lo - 0.4, y1: lo + 0.6, mat: 'earth' });
    this.addObstacle({ type: 'box', x0, x1, z0: zt + 0.9, z1: zt + 1.8, y0: lo - 0.4, y1: lo + 0.22, mat: 'earth' });
    this._coverAround(bags);
    first = first || bags;
  }
  return first;
};
// low sandbag wall (traverses between bays)
S._sandbags = function (x0, z0, x1, z1, h, cover) {
  return this.solid('sandbag', x0, z0, x1, z1, h, { us: 0.9, vs: 0.35, cover });
};
// rounded earth mound (dugout cover): flat top with sloping sides all round
S._mound = function (x0, x1, z0, z1, g, h, inset) {
  const b = this.batch('earth'), y0 = g - 0.2, y1 = g + h;
  const a0 = [x0, y0, z0], a1 = [x1, y0, z0], a2 = [x1, y0, z1], a3 = [x0, y0, z1];
  const t0 = [x0 + inset, y1, z0 + inset], t1 = [x1 - inset, y1, z0 + inset], t2 = [x1 - inset, y1, z1 - inset], t3 = [x0 + inset, y1, z1 - inset];
  const U = [[0, 0], [1.5, 0], [1.2, 0.6]], V = [[0, 0], [1.2, 0.6], [0.3, 0.6]];
  for (const [p, q, tp, tq] of [[a1, a0, t1, t0], [a2, a1, t2, t1], [a3, a2, t3, t2], [a0, a3, t0, t3]]) { b.tri(p, q, tq, U); b.tri(p, tq, tp, V); }
  b.tri(t0, t3, t2, [[0, 0], [0, 1], [1, 1]]); b.tri(t0, t2, t1, [[0, 0], [1, 1], [1, 0]]);
};

// ---------- countryside ----------
S._countryside = function (beach, coastZ) {
  const r = this.rng, t = this.cfg.terrain, { HALF } = dims();
  const forestThr = { forest: -0.25, hills: 0.22, farmland: 0.38, town: 0.42, city: 0.5, beach: 0.4 }[t] ?? 0.4;
  const fn = (x, z) => this.noise.fbm(x * 0.0045 + 17, z * 0.0045 - 9, 3) + this.noise(x * 0.03, z * 0.03) * 0.08;
  this.forestAt = (x, z) => fn(x, z) > forestThr;
  const inTown = (x, z, pad = 0) => this.settlements.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + pad);
  // woods
  const step = t === 'forest' ? 8.5 : 7.5;
  for (let z = -HALF + 4; z < HALF - 4; z += step) for (let x = -HALF + 4; x < HALF - 4; x += step) {
    const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
    if (beach && pz > coastZ - 150) continue;
    if (!this.forestAt(px, pz) || inTown(px, pz, 10)) continue;
    this.tree(px, pz, t === 'forest' || t === 'hills' ? (r() < 0.7 ? 'pine' : 'oak') : (r() < 0.25 ? 'pine' : 'oak'), 0.9 + r() * 0.4);
  }
  // fields divided by hedgerows / stone walls / fences
  const cell = t === 'farmland' ? 75 : 95;
  const kind = t === 'farmland' ? 'hedge' : t === 'hills' ? 'stone' : 'fence';
  const p = t === 'farmland' ? 0.85 : t === 'hills' ? 0.55 : 0.35;
  const field = (x, z) => !this.forestAt(x, z) && !inTown(x, z, 15) && !(beach && z > coastZ - 160);
  const jit = (v) => v + (r() - 0.5) * 16;
  for (let gz = -HALF; gz <= HALF; gz += cell) for (let gx = -HALF; gx <= HALF; gx += cell) {
    for (const [ax, az, bx, bz] of [[gx, gz, gx + cell, gz], [gx, gz, gx, gz + cell]]) {
      if (r() > p) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (!field(mx, mz)) continue;
      // leave a gate somewhere along the boundary
      const L = Math.hypot(bx - ax, bz - az), gate = 0.2 + r() * 0.6, gw = 8 / L;
      const segs = [[0, gate - gw / 2], [gate + gw / 2, 1]];
      for (const [f0, f1] of segs) {
        const x0 = ax + (bx - ax) * f0, z0 = az + (bz - az) * f0, x1 = ax + (bx - ax) * f1, z1 = az + (bz - az) * f1;
        if (kind === 'hedge') this._hedgeSeg(x0, z0, x1, z1);
        else if (kind === 'stone') { if (this.isClear(mx, mz, 2) && this.boxFree(Math.min(x0, x1) - 0.4, Math.min(z0, z1) - 0.4, Math.max(x0, x1) + 0.4, Math.max(z0, z1) + 0.4)) this.solid('stone', Math.min(x0, x1) - (az === bz ? 0 : 0.35), Math.min(z0, z1) - (az === bz ? 0.35 : 0), Math.max(x0, x1) + (az === bz ? 0 : 0.35), Math.max(z0, z1) + (az === bz ? 0.35 : 0), 1.15, { us: 3, vs: 2 }); }
        else this._fence(x0, z0, x1, z1);
      }
    }
  }
  // single trees and bushes dotted across open ground
  for (let k = 0; k < 500; k++) { const x = (r() - 0.5) * 2 * HALF, z = (r() - 0.5) * 2 * HALF; if (field(x, z)) this.tree(x, z, 'oak', 0.9 + r() * 0.5); }
  // horizon: perimeter trees
  for (let k = 0; k < 900; k++) {
    const a = r() * 6.28, d = HALF + 15 + r() * 60;
    const x = Math.cos(a) * d * 1.2, z = Math.sin(a) * d * 1.2;
    if (Math.abs(x) < HALF + 8 && Math.abs(z) < HALF + 8) continue;
    if (beach && z > coastZ - 40) continue;
    this.tree(clamp(x, -HALF - 70, HALF + 70), clamp(z, -HALF - 70, HALF + 70), r() < 0.5 ? 'pine' : 'oak', 1.1);
  }
};
S._fence = function (x0, z0, x1, z1) {
  const r = this.rng, L = Math.hypot(x1 - x0, z1 - z0); if (L < 3) return;
  const along = Math.abs(z1 - z0) < 0.01;
  const n = Math.max(1, Math.round(L / 2.4));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
    if (!this.isClear(x, z, 0.5)) continue;
    this.fencePosts.push({ x, z, lean: (r() - 0.5) * 0.12 });
    if (i < n) {
      const nx = x0 + (x1 - x0) * (i + 1) / n, nz = z0 + (z1 - z0) * (i + 1) / n;
      this.fenceRails.push({ x: (x + nx) / 2, z: (z + nz) / 2, along, len: L / n, broken: r() < 0.12 });
    }
  }
};

S._sectorClutter = function (beach, coastZ) {
  const r = this.rng, cfg = this.cfg, { HALF, HS, HN, EXT } = dims(), front = cfg.depth === 0;
  // shell craters, concentrated toward the Allied edge on front-line sectors
  const nc = front ? 110 : 40;
  for (let k = 0; k < nc; k++) {
    const x = (r() - 0.5) * (2 * HALF - 20), z = front ? HALF - Math.pow(r(), 1.6) * 2 * HALF : (r() - 0.5) * (2 * HALF - 20), R = 1.8 + r() * 3.4;
    if (!this.isClear(x, z, R + 1.5) || !this.boxFree(x - R, z - R, x + R, z + R, 1.5)) continue;
    if (beach && z > coastZ - 15) continue;
    this.craters.push({ x, z, R });
    const depth = R * 0.32, ext = R * 1.45;
    const i0 = Math.max(0, Math.floor((x - ext + EXT) / HS)), i1 = Math.min(HN - 1, Math.ceil((x + ext + EXT) / HS));
    const j0 = Math.max(0, Math.floor((z - ext + EXT) / HS)), j1 = Math.min(HN - 1, Math.ceil((z + ext + EXT) / HS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(-EXT + i * HS - x, -EXT + j * HS - z);
      if (d < R) this.hgrid[j * HN + i] -= depth * (1 - (d / R) ** 2);
      else if (d < ext) this.hgrid[j * HN + i] += 0.28 * Math.sin(((d - R) / (ext - R)) * Math.PI);
    }
  }
  // telegraph poles along the longest road
  const road = this.roads.slice().sort((a, b) => b.pts.length - a.pts.length)[0];
  if (road) for (let i = 0; i + 1 < road.pts.length; i++) {
    const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    for (let d = 15; d < L; d += 34) {
      const x = ax + (bx - ax) * d / L + 6, z = az + (bz - az) * d / L + 6;
      if (Math.abs(x) > HALF || Math.abs(z) > HALF || !this.boxFree(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0.5)) continue;
      this.poles.push({ x, z, tilt: r() < 0.12 ? (r() - 0.5) * 0.5 : (r() - 0.5) * 0.06 });
      this.addObstacle({ type: 'cyl', x, z, r: 0.14, y0: this.H(x, z) - 1, y1: this.H(x, z) + 7 });
    }
  }
  // wrecks along roads, sandbagged positions and beach defences
  for (let k = 0; k < 10; k++) {
    const rd = this.roads[Math.floor(r() * this.roads.length)]; if (!rd) break;
    const p = rd.pts[Math.floor(r() * rd.pts.length)];
    this.wreck(p[0] + 9 + r() * 4, p[1] + (r() - 0.5) * 10);
  }
  if (beach && cfg.landing) this._landingDefences(coastZ);
  if (beach) {
    for (let k = 0; k < 140; k++) this.hedgehog((r() - 0.5) * (2 * HALF - 30), coastZ - (cfg.landing ? 40 : 70) + r() * (cfg.landing ? 60 : 90));
    if (!cfg.landing) for (let k = 0; k < 8; k++) this.bunker((r() - 0.5) * (2 * HALF - 80), coastZ - 175 + r() * 20, 1);
  }
};

// The landing beach: a row of bunkers along the crest of the bluff looking down on the sand, MG
// nests between them, and wire along the foot of the bluff.
S._landingDefences = function (coastZ) {
  const r = this.rng, { HALF } = dims();
  this.bluffBunkers = [];
  const top = (x) => this.H(x, coastZ - 130);
  // the crest: the first point (coming up from the sea) that is close to the plateau height
  const crest = (x) => { const t = top(x); for (let z = coastZ - 40; z > coastZ - 140; z -= 2) if (this.H(x, z) > t - 0.7) return z; return coastZ - 90; };
  for (let k = 0; k < 5; k++) {
    let B = null;
    for (let tries = 0; tries < 8 && !B; tries++) {
      const x = clamp(this.insert.x + (k - 2) * 120 + (r() - 0.5) * 30 + tries * 9, -HALF + 30, HALF - 30);
      B = this.bunker(x, crest(x) - 5 - tries, 1);
    }
    if (B) { B.bluff = true; this.bluffBunkers.push(B); }
  }
  for (let k = 0; k < 6; k++) {
    const x = clamp(this.insert.x + (k - 2.5) * 120 + (r() - 0.5) * 20, -HALF + 30, HALF - 30), z = crest(x) - 3;
    if (this.isClear(x, z, 3)) this.strongpoint(x, z, 2.2);
  }
  for (let wx = -HALF + 30; wx < HALF - 30;) {
    const L = 16 + r() * 24, z = coastZ - 46 + r() * 8;
    if (this.isClear(wx + L / 2, z, L / 2)) this.wire.push({ x0: wx, z0: z, x1: wx + L, z1: z, L });
    wx += L + 7 + r() * 8;
  }
};

// Navigation points: guard posts, patrol waypoints, objectives.
S._navPlan = function () {
  const r = this.rng, { HALF } = dims();
  const P = this.navPoints;
  const add = (x, z, radius, tag) => { const p = { x, z, radius, tag }; P.push(p); return p; };
  for (const a of this.assets) a.nav = add(a.x, a.z + a.r + 4 || a.z + 10, (a.r || 8) + 6, 'asset');
  for (const s of this.strongpoints) { s.nav = add(s.x, s.z, s.r, 'strong'); if (s.holdPts) s.nav.holdPts = s.holdPts; }
  this.exfilNav = add(this.exfil.x, this.exfil.z, 12, 'exfil');
  // patrol waypoints: along roads and between settlements
  this.wpAxis = []; this.wpAllies = [];
  for (const rd of this.roads) for (const p of rd.pts) {
    if (Math.abs(p[0]) > HALF - 10 || Math.abs(p[1]) > HALF - 10) continue;
    if (p[1] < this.insert.z - 260) this.wpAxis.push(add(p[0], p[1], 10, 'wp'));
    else if (this.wpAllies.length < 6) this.wpAllies.push(add(p[0], p[1], 10, 'wp'));
  }
  while (this.wpAxis.length < 6) this.wpAxis.push(add((r() - 0.5) * HALF, -HALF * 0.5 + (r() - 0.5) * HALF * 0.6, 10, 'wp'));
  while (this.wpAllies.length < 3) this.wpAllies.push(add(this.insert.x + (r() - 0.5) * 300, this.insert.z - 60 - r() * 150, 10, 'wp'));
  if (this.sites.hq) this.sites.hq.nav = add(this.sites.hq.x, this.sites.hq.z, 10, 'hq');
  if (this.sites.defend) { this.sites.defend.nav = add(this.sites.defend.x, this.sites.defend.z, this.sites.defend.r, 'defend'); this.sites.defend.nav.holdPts = this.sites.defend.holdPts; }
  if (this.sites.pow) this.sites.pow.nav = add(this.sites.pow.x, this.sites.pow.z, 12, 'pow');
  if (this.sites.ops) for (const o of this.sites.ops) o.nav = add(o.x, o.z, 8, 'op');
};

Object.assign(World.prototype, S);

// Strategic map definition: a schematic Western Front, June 1944.
import { pointInPoly, makeNoise2D } from '../util.js';
// Coordinates are in a 1000 x 700 map space.

export const MAP_W = 1000;
export const MAP_H = 700;

// Sea polygon (Channel, North Sea, Bay of Biscay)
export const SEA = [
  [0, 0], [760, 0], [700, 62], [640, 48], [590, 40], [545, 62], [505, 98], [455, 128], [420, 150],
  [385, 170], [345, 238], [305, 278], [252, 300], [200, 296], [165, 282], [150, 262], [112, 262],
  [100, 300], [82, 345], [22, 375], [55, 470], [115, 560], [128, 700], [0, 700],
];
// England sits inside the sea polygon
export const ENGLAND = [
  [20, 40], [120, 18], [205, 22], [262, 92], [255, 160], [222, 200], [150, 214], [62, 220], [12, 196],
];

export const TERRAIN_INFO = {
  beach:    { label: 'Coastline',  def: 1.15, icon: '≈' },
  farmland: { label: 'Bocage',     def: 1.2,  icon: '▤' },
  town:     { label: 'Town',       def: 1.35, icon: '▣' },
  city:     { label: 'City',       def: 1.5,  icon: '▦' },
  forest:   { label: 'Forest',     def: 1.4,  icon: '♣' },
  hills:    { label: 'Hills',      def: 1.35, icon: '▲' },
};

// Provinces. The front is fought over the grid sectors inside them (see REGIONS below).
// owner: 'allies' | 'axis'. troops are abstract battalion-strength points for the whole province.
// value: supply value (income). port: Allied supply source when held.
// homeland: Axis supply source.
export const PROVINCES = [
  { id: 'eng',  name: 'Southern England', x: 140, y: 120, terrain: 'city',     owner: 'allies', troops: 0,  value: 0, hq: true },
  { id: 'nbch', name: 'Normandy Beaches', x: 200, y: 330, terrain: 'beach',    owner: 'axis',   troops: 32, value: 2, port: true },
  { id: 'cher', name: 'Cherbourg',        x: 122, y: 305, terrain: 'town',     owner: 'axis',   troops: 30, value: 3, port: true },
  { id: 'caen', name: 'Caen',             x: 268, y: 340, terrain: 'town',     owner: 'axis',   troops: 46, value: 3 },
  { id: 'brit', name: 'Brittany',         x: 70,  y: 405, terrain: 'farmland', owner: 'axis',   troops: 24, value: 2, port: true },
  { id: 'stlo', name: 'Saint-Lô',         x: 170, y: 395, terrain: 'farmland', owner: 'axis',   troops: 34, value: 2 },
  { id: 'fal',  name: 'Falaise',          x: 268, y: 420, terrain: 'farmland', owner: 'axis',   troops: 36, value: 2 },
  { id: 'lem',  name: 'Le Mans',          x: 205, y: 495, terrain: 'farmland', owner: 'axis',   troops: 22, value: 2 },
  { id: 'rou',  name: 'Rouen',            x: 345, y: 300, terrain: 'town',     owner: 'axis',   troops: 30, value: 3 },
  { id: 'cal',  name: 'Pas-de-Calais',    x: 395, y: 205, terrain: 'beach',    owner: 'axis',   troops: 48, value: 3, port: true },
  { id: 'par',  name: 'Paris',            x: 400, y: 395, terrain: 'city',     owner: 'axis',   troops: 40, value: 6 },
  { id: 'orl',  name: 'Orléans',          x: 330, y: 520, terrain: 'farmland', owner: 'axis',   troops: 20, value: 2 },
  { id: 'rei',  name: 'Reims',            x: 500, y: 360, terrain: 'farmland', owner: 'axis',   troops: 26, value: 2 },
  { id: 'bru',  name: 'Brussels',         x: 520, y: 235, terrain: 'city',     owner: 'axis',   troops: 34, value: 4 },
  { id: 'ant',  name: 'Antwerp',          x: 470, y: 168, terrain: 'town',     owner: 'axis',   troops: 30, value: 4, port: true },
  { id: 'ard',  name: 'Ardennes',         x: 585, y: 305, terrain: 'forest',   owner: 'axis',   troops: 30, value: 1 },
  { id: 'met',  name: 'Metz',             x: 595, y: 425, terrain: 'hills',    owner: 'axis',   troops: 36, value: 3 },
  { id: 'nan',  name: 'Nancy',            x: 520, y: 480, terrain: 'farmland', owner: 'axis',   troops: 22, value: 2 },
  { id: 'lyo',  name: 'Lyon',             x: 470, y: 610, terrain: 'town',     owner: 'axis',   troops: 26, value: 3 },
  { id: 'als',  name: 'Alsace',           x: 655, y: 545, terrain: 'hills',    owner: 'axis',   troops: 34, value: 2 },
  { id: 'rot',  name: 'Rotterdam',        x: 540, y: 118, terrain: 'town',     owner: 'axis',   troops: 28, value: 3, port: true },
  { id: 'arn',  name: 'Arnhem',           x: 625, y: 135, terrain: 'town',     owner: 'axis',   troops: 32, value: 2 },
  { id: 'aac',  name: 'Aachen',           x: 650, y: 240, terrain: 'town',     owner: 'axis',   troops: 33, value: 3, homeland: true },
  { id: 'hur',  name: 'Hürtgen Forest',   x: 690, y: 305, terrain: 'forest',   owner: 'axis',   troops: 32, value: 1, homeland: true },
  { id: 'sar',  name: 'Saarland',         x: 690, y: 420, terrain: 'hills',    owner: 'axis',   troops: 28, value: 3, homeland: true },
  { id: 'col',  name: 'Cologne',          x: 740, y: 225, terrain: 'city',     owner: 'axis',   troops: 34, value: 4, homeland: true },
  { id: 'ruh',  name: 'Ruhr',             x: 765, y: 145, terrain: 'city',     owner: 'axis',   troops: 39, value: 7, homeland: true },
  { id: 'fra',  name: 'Frankfurt',        x: 800, y: 340, terrain: 'city',     owner: 'axis',   troops: 33, value: 5, homeland: true },
  { id: 'stu',  name: 'Stuttgart',        x: 780, y: 490, terrain: 'hills',    owner: 'axis',   troops: 27, value: 4, homeland: true },
  { id: 'han',  name: 'Hanover',          x: 860, y: 120, terrain: 'farmland', owner: 'axis',   troops: 28, value: 3, homeland: true },
  { id: 'kas',  name: 'Kassel',           x: 880, y: 250, terrain: 'forest',   owner: 'axis',   troops: 28, value: 3, homeland: true },
  { id: 'mun',  name: 'Munich',           x: 905, y: 565, terrain: 'city',     owner: 'axis',   troops: 33, value: 5, homeland: true },
  { id: 'nur',  name: 'Nuremberg',        x: 900, y: 420, terrain: 'town',     owner: 'axis',   troops: 30, value: 4, homeland: true },
  { id: 'lei',  name: 'Leipzig',          x: 965, y: 300, terrain: 'city',     owner: 'axis',   troops: 33, value: 5, homeland: true },
  { id: 'ber',  name: 'Berlin',           x: 970, y: 150, terrain: 'city',     owner: 'axis',   troops: 80, value: 8, homeland: true, capital: true },
];

// Sea lanes for amphibious assaults from England
export const SEA_LINKS = [['eng', 'nbch'], ['eng', 'cher'], ['eng', 'cal']];

// ---------- battle sectors: the map grid cut by province borders ----------
export const CELL = 4;                       // fine raster used for borders and adjacency
export const GW = MAP_W / CELL, GH = MAP_H / CELL;
export const SQ = 70;                        // one map-grid square (sector) in map units
export const GRID_COLS = Math.ceil(MAP_W / SQ), GRID_ROWS = Math.ceil(MAP_H / SQ);
export const gridRef = (x, y) => String.fromCharCode(65 + Math.floor(x / SQ)) + (Math.floor(y / SQ) + 1);

function buildSectors() {
  const noise = makeNoise2D(1944);
  const prov = new Int16Array(GW * GH).fill(-1); // -1 sea
  const conts = PROVINCES.map((r, i) => ({ i, r })).filter((o) => !o.r.hq);
  const engIdx = PROVINCES.findIndex((r) => r.hq);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
    const px = Math.min(MAP_W - 1, Math.max(1, x + noise(x * 0.04, y * 0.04) * 7)), py = Math.min(MAP_H - 1, Math.max(1, y + noise(y * 0.04 + 9, x * 0.04) * 7));
    if (pointInPoly(px, py, ENGLAND)) { prov[gy * GW + gx] = engIdx; continue; }
    if (pointInPoly(px, py, SEA)) continue;
    const jx = x + noise(x * 0.03 + 50, y * 0.03) * 14, jy = y + noise(x * 0.03, y * 0.03 + 50) * 14;
    let best = -1, bd = Infinity;
    for (const o of conts) { const d = (o.r.x - jx) ** 2 + (o.r.y - jy) ** 2; if (d < bd) { bd = d; best = o.i; } }
    prov[gy * GW + gx] = best;
  }
  // pieces: province x grid square (England stays one rear-area sector)
  const keyOf = (gx, gy) => { const p = prov[gy * GW + gx]; if (p < 0) return -1; if (p === engIdx) return p * 1000; return p * 1000 + Math.floor((gx * CELL) / SQ) * GRID_ROWS + Math.floor((gy * CELL) / SQ); };
  const pieces = new Map();
  const cellKey = new Int32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const k = keyOf(gx, gy); cellKey[gy * GW + gx] = k; if (k < 0) continue;
    let pc = pieces.get(k); if (!pc) pieces.set(k, pc = { k, prov: prov[gy * GW + gx], n: 0, sx: 0, sy: 0, coast: 0 });
    pc.n++; pc.sx += gx; pc.sy += gy;
  }
  // slivers (small corners of a province poking into a square) join a neighbouring piece of the same province
  const MIN = (SQ / CELL) ** 2 * 0.22;
  const parent = new Map([...pieces.keys()].map((k) => [k, k]));
  const root = (k) => { while (parent.get(k) !== k) k = parent.get(k); return k; };
  for (let pass = 0; pass < 3; pass++) {
    const size = new Map(); for (const [k, pc] of pieces) { const r = root(k); size.set(r, (size.get(r) || 0) + pc.n); }
    const border = new Map();
    for (let gy = 0; gy < GH - 1; gy++) for (let gx = 0; gx < GW - 1; gx++) {
      const a = cellKey[gy * GW + gx]; if (a < 0) continue;
      for (const b of [cellKey[gy * GW + gx + 1], cellKey[(gy + 1) * GW + gx]]) {
        if (b < 0) continue; const ra = root(a), rb = root(b);
        if (ra === rb || pieces.get(a).prov !== pieces.get(b).prov) continue;
        for (const [x, y] of [[ra, rb], [rb, ra]]) { const m = border.get(x) || new Map(); m.set(y, (m.get(y) || 0) + 1); border.set(x, m); }
      }
    }
    for (const [r, n] of size) {
      if (n >= MIN || root(r) !== r || pieces.get(r).prov === engIdx) continue;
      const m = border.get(r); if (!m) continue;
      let best = null, bv = -1; for (const [o, v] of m) if (root(o) !== r && v > bv) { bv = v; best = root(o); }
      if (best !== null) parent.set(r, best);
    }
  }
  // final sectors
  const sectors = [], idOf = new Map();
  const groups = new Map();
  for (const [k, pc] of pieces) { const r = root(k); const g = groups.get(r) || { prov: pc.prov, n: 0, sx: 0, sy: 0, keys: [] }; g.n += pc.n; g.sx += pc.sx; g.sy += pc.sy; g.keys.push(k); groups.set(r, g); }
  const grid = new Int16Array(GW * GH).fill(-1);
  for (const [r, g] of groups) idOf.set(r, -1);
  const provSecs = PROVINCES.map(() => []);
  for (const [r, g] of groups) {
    const P = PROVINCES[g.prov];
    const cx = (g.sx / g.n) * CELL + CELL / 2, cy = (g.sy / g.n) * CELL + CELL / 2;
    const sec = { prov: g.prov, x: P.hq ? P.x : cx, y: P.hq ? P.y : cy, cells: g.n, ref: P.hq ? '' : gridRef(cx, cy) };
    idOf.set(r, sectors.length); provSecs[g.prov].push(sectors.length); sectors.push(sec);
  }
  for (let i = 0; i < GW * GH; i++) if (cellKey[i] >= 0) grid[i] = idOf.get(root(cellKey[i]));
  // coastal sectors (touch the sea)
  for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
    const a = grid[gy * GW + gx]; if (a < 0) continue;
    if (grid[gy * GW + gx + 1] < 0 || grid[gy * GW + gx - 1] < 0 || grid[(gy + 1) * GW + gx] < 0 || grid[(gy - 1) * GW + gx] < 0) sectors[a].coastal = true;
  }
  // province attributes shared out over its sectors
  const out = [];
  PROVINCES.forEach((P, pi) => {
    const ids = provSecs[pi]; if (!ids.length) return;
    const core = ids.slice().sort((a, b) => Math.hypot(sectors[a].x - P.x, sectors[a].y - P.y) - Math.hypot(sectors[b].x - P.x, sectors[b].y - P.y))[0];
    const portSec = P.port ? ids.filter((i) => sectors[i].coastal).sort((a, b) => Math.hypot(sectors[a].x - P.x, sectors[a].y - P.y) - Math.hypot(sectors[b].x - P.x, sectors[b].y - P.y))[0] ?? core : -1;
    const tot = ids.reduce((a, i) => a + sectors[i].cells, 0);
    for (const i of ids) {
      const sc = sectors[i], isCore = i === core, share = sc.cells / tot;
      let terrain = P.terrain;
      if (!isCore) terrain = P.terrain === 'city' ? 'town' : P.terrain === 'town' ? 'farmland' : P.terrain === 'beach' ? (sc.coastal ? 'beach' : 'farmland') : P.terrain;
      Object.assign(sc, {
        id: isCore ? P.id : `${P.id}-${sc.ref}`, name: P.hq ? P.name : `${P.name} ${sc.ref}`, provName: P.name, core: isCore,
        terrain, owner: P.owner, value: P.value * (isCore ? 0.4 + 0.6 * share : 0.6 * share), port: i === portSec,
        homeland: !!P.homeland, capital: !!P.capital && isCore, hq: !!P.hq,
        troops: P.hq ? 0 : Math.max(3, Math.round(P.troops * (isCore ? 0.35 + 0.65 * share : 0.65 * share))),
      });
    }
  });
  return { sectors, grid, prov, provSecs };
}
const BUILT = buildSectors();
// The front's unit: every battle sector on the map (England is a single rear-area sector).
export const REGIONS = BUILT.sectors;
export const SECTOR_GRID = BUILT.grid;     // fine raster -> sector index (-1 sea)
export const PROVINCE_GRID = BUILT.prov;   // fine raster -> province index
export const PROVINCE_SECTORS = BUILT.provSecs;

export const WEATHER = {
  clear:    { label: 'Clear',    fog: 0.004, air: true },
  overcast: { label: 'Overcast', fog: 0.007, air: true },
  rain:     { label: 'Rain',     fog: 0.011, air: false },
  fog:      { label: 'Fog',      fog: 0.024, air: false },
  snow:     { label: 'Snow',     fog: 0.013, air: false },
};

// Enemy assets Rangers can destroy in a sector. Effects are applied to the war effort
// whether or not the asset was the mission's primary objective.
export const ASSET_TYPES = {
  artillery: { label: 'Artillery battery', icon: '✸', effect: 'Strips the sector of artillery support and one level of fortification.' },
  flak:      { label: 'Flak battery',      icon: '✈', effect: 'Opens the sky: Allied air support hits this sector hard this week.' },
  fuel:      { label: 'Fuel depot',        icon: '◉', effect: 'No German counterattack can be launched from this sector; −15 enemy supplies.' },
  ammo:      { label: 'Ammunition dump',   icon: '▣', effect: 'Garrison loses 8 troops’ worth of firepower.' },
  radio:     { label: 'Command post',      icon: '☎', effect: 'Enemy defense here is disorganised (−15%) and cannot counterattack.' },
  trucks:    { label: 'Truck park',        icon: '▬', effect: 'Disrupts German logistics: −10 enemy manpower and −10 supplies.' },
  tank:      { label: 'Panzer laager',     icon: '◆', effect: 'Destroys armored reserves: −10 enemy troops in the sector.' },
};

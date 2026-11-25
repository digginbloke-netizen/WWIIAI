// Builds a Voronoi-style region ownership grid over land and derives adjacency.
import { MAP_W, MAP_H, SEA, ENGLAND, REGIONS, SEA_LINKS } from './data.js';
import { pointInPoly, makeNoise2D } from '../util.js';

export const CELL = 4;
export const GW = MAP_W / CELL;
export const GH = MAP_H / CELL;

let cached = null;

export function getGeo() {
  if (cached) return cached;
  const grid = new Int16Array(GW * GH).fill(-1); // -1 sea
  const noise = makeNoise2D(1944);
  const conts = REGIONS.map((r, i) => ({ i, r })).filter((o) => !o.r.hq);
  const engIdx = REGIONS.findIndex((r) => r.hq);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
      // perturb coastline slightly for organic look
      const px = x + noise(x * 0.04, y * 0.04) * 7, py = y + noise(y * 0.04 + 9, x * 0.04) * 7;
      if (pointInPoly(px, py, ENGLAND)) { grid[gy * GW + gx] = engIdx; continue; }
      if (pointInPoly(px, py, SEA)) continue;
      // nearest region with jittered borders
      const jx = x + noise(x * 0.03 + 50, y * 0.03) * 14, jy = y + noise(x * 0.03, y * 0.03 + 50) * 14;
      let best = -1, bd = Infinity;
      for (const o of conts) {
        const d = (o.r.x - jx) ** 2 + (o.r.y - jy) ** 2;
        if (d < bd) { bd = d; best = o.i; }
      }
      grid[gy * GW + gx] = best;
    }
  }
  // adjacency
  const adj = REGIONS.map(() => new Set());
  for (let gy = 0; gy < GH - 1; gy++) {
    for (let gx = 0; gx < GW - 1; gx++) {
      const a = grid[gy * GW + gx];
      if (a < 0) continue;
      for (const b of [grid[gy * GW + gx + 1], grid[(gy + 1) * GW + gx]]) {
        if (b >= 0 && b !== a) { adj[a].add(b); adj[b].add(a); }
      }
    }
  }
  // prune very long links
  for (let a = 0; a < REGIONS.length; a++) {
    for (const b of [...adj[a]]) {
      const d = Math.hypot(REGIONS[a].x - REGIONS[b].x, REGIONS[a].y - REGIONS[b].y);
      if (d > 240) { adj[a].delete(b); adj[b].delete(a); }
    }
  }
  const idx = Object.fromEntries(REGIONS.map((r, i) => [r.id, i]));
  for (const [a, b] of SEA_LINKS) { adj[idx[a]].add(idx[b]); adj[idx[b]].add(idx[a]); }
  // region label centroid
  const cx = REGIONS.map(() => [0, 0, 0]);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const a = grid[gy * GW + gx]; if (a < 0) continue;
    cx[a][0] += gx; cx[a][1] += gy; cx[a][2]++;
  }
  cached = { grid, adj: adj.map((s) => [...s]), idx, seaLinks: SEA_LINKS.map(([a, b]) => [idx[a], idx[b]]) };
  return cached;
}

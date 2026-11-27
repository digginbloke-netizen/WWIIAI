// Battle-sector geography: adjacency between the grid sectors (and the sea lanes from England).
import { REGIONS, PROVINCES, SEA_LINKS, SECTOR_GRID, PROVINCE_SECTORS, CELL, GW, GH } from './data.js';

export { CELL, GW, GH };

let cached = null;

export function getGeo() {
  if (cached) return cached;
  const grid = SECTOR_GRID;
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
  // England is linked by sea only
  const eng = REGIONS.findIndex((r) => r.hq);
  for (const b of [...adj[eng]]) { adj[eng].delete(b); adj[b].delete(eng); }
  const idx = Object.fromEntries(REGIONS.map((r, i) => [r.id, i]));
  const pidx = Object.fromEntries(PROVINCES.map((p, i) => [p.id, i]));
  // sea lanes: from England to the coastal sectors of the landing provinces
  const seaLinks = [];
  for (const [a, b] of SEA_LINKS) {
    const from = idx[a];
    for (const j of PROVINCE_SECTORS[pidx[b]]) if (REGIONS[j].coastal) { adj[from].add(j); adj[j].add(from); seaLinks.push([from, j]); }
  }
  cached = { grid, adj: adj.map((s) => [...s]), idx, pidx, seaLinks };
  return cached;
}

// every sector of a province, and the province a sector belongs to
export const provinceOf = (i) => REGIONS[i].prov;
export const sectorsOf = (p) => PROVINCE_SECTORS[p];

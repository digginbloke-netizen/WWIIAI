// Strategic layer: state, rules, Axis AI, auto-resolve, turn progression.
import { REGIONS, PROVINCES, PROVINCE_SECTORS, TERRAIN_INFO, WEATHER, ASSET_TYPES } from './data.js';
import { getGeo } from './geo.js';
import { clamp, rand, pick } from '../util.js';

const SAVE_KEY = 'roadToBerlin.save.v4';
export const ART_COST = 15;
export const AIR_COST = 25;
export const FORT_COST = 20;
export const MAX_TROOPS = 120;

export function newCampaign(settings = {}) {
  const regions = REGIONS.map((r) => ({ owner: r.owner, troops: r.troops, fort: r.capital ? 2 : (r.terrain === 'beach' ? 1 : 0), lockedIn: 0 }));
  const eng = REGIONS.findIndex((r) => r.hq);
  regions[eng].troops = 170;
  const s = {
    version: 2,
    turn: 1,
    startDate: Date.UTC(1944, 5, 6),
    regions,
    res: { allies: { mp: 60, sup: 90 }, axis: { mp: 40, sup: 40 } },
    weather: 'overcast',
    orders: [],
    battles: [],
    phase: 'brief',
    maxOffensives: 10,
    log: [{ turn: 1, type: 'event', text: 'Operation Overlord begins. Allied armies are staged in Southern England. Your Ranger company stands ready to go in ahead of the landings.' }],
    stats: { won: 0, lost: 0, fps: 0, kills: 0, deaths: 0, alliedLosses: 0, axisLosses: 0, missions: 0, missionsWon: 0, assets: 0 },
    flags: {},
    settings: { difficulty: settings.difficulty || 'normal', botCap: settings.botCap || 24 },
    result: null,
    squad: [],
    assets: {},
    nextAssetId: 1,
    mods: {},
    report: null,
  };
  s.squadSector = eng; // where the Ranger company is: you hear about battles there
  s.provState = {};
  s.squad = [{ name: 'You', rank: 'Lt.', cls: 'rifleman', status: 'active', kills: 0, missions: 0, leader: true }];
  replenishSquad(s);
  refreshAssets(s);
  s.day = 0;
  return s;
}

export function saveCampaign(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }
export function loadCampaign() {
  try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

export function currentDate(s) { return new Date(s.startDate + (s.day !== undefined ? s.day : (s.turn - 1) * 7) * 86400000); }

export function isWinter(s) { const m = currentDate(s).getUTCMonth(); return m === 11 || m <= 1; }

export function adjacent(a) { return getGeo().adj[a]; }

// scope: a sector index (or list) for local news you only hear in your own sector; omit for news everyone hears
export function log(s, text, type = 'info', scope) {
  if (scope !== undefined && !(Array.isArray(scope) ? scope : [scope]).includes(s.squadSector)) return;
  s.log.push({ turn: s.turn, day: s.day, text, type }); if (s.log.length > 150) s.log.shift(); if (s.events) s.events.push({ text, type }); }

// ---------- Supply ----------
export function computeSupply(s) {
  const geo = getGeo();
  const sup = REGIONS.map(() => false);
  const queue = [];
  REGIONS.forEach((r, i) => {
    const o = s.regions[i].owner;
    if (o === 'allies' && (r.hq || r.port)) { sup[i] = true; queue.push(i); }
    if (o === 'axis' && r.homeland) { sup[i] = true; queue.push(i); }
  });
  while (queue.length) {
    const a = queue.shift();
    for (const b of geo.adj[a]) {
      if (sup[b] || s.regions[b].owner !== s.regions[a].owner) continue;
      if (REGIONS[a].hq || REGIONS[b].hq) continue; // sea lanes don't propagate overland supply
      sup[b] = true; queue.push(b);
    }
  }
  return sup;
}

export function committedFrom(s, i) { return s.orders.filter((o) => o.from === i).reduce((a, o) => a + o.troops, 0); }

export function canAttack(s, from, to) {
  const g = getGeo();
  if (s.regions[from].owner !== 'allies' || s.regions[to].owner !== 'axis') return false;
  if (!g.adj[from].includes(to)) return false;
  return true;
}

export function validSources(s, to) {
  return getGeo().adj[to].filter((i) => s.regions[i].owner === 'allies' && s.regions[i].troops >= 5);
}

// ---------- Player orders ----------
export function reinforce(s, i, amount) {
  const sup = computeSupply(s);
  if (s.regions[i].owner !== 'allies' || !sup[i]) return 'Region is not in supply.';
  amount = Math.min(amount, s.res.allies.mp, MAX_TROOPS - s.regions[i].troops);
  if (amount <= 0) return 'Not enough manpower or region at capacity.';
  s.regions[i].troops += amount; s.res.allies.mp -= amount;
  return null;
}

export function fortify(s, i) {
  const r = s.regions[i];
  if (r.owner !== 'allies') return 'Not your region.';
  if (r.fort >= 3) return 'Already fully fortified.';
  if (s.res.allies.sup < FORT_COST) return 'Not enough supplies.';
  s.res.allies.sup -= FORT_COST; r.fort++;
  return null;
}

export function moveTroops(s, from, to, amount) {
  const g = getGeo();
  const a = s.regions[from], b = s.regions[to];
  if (a.owner !== 'allies' || b.owner !== 'allies') return 'Both regions must be Allied.';
  if (!g.adj[from].includes(to)) return 'Regions are not adjacent.';
  const movable = a.troops - a.lockedIn;
  amount = Math.min(amount, movable, MAX_TROOPS - b.troops);
  if (amount <= 0) return 'No troops available to move (troops that arrived this turn cannot move again).';
  a.troops -= amount; b.troops += amount; b.lockedIn += amount;
  return null;
}

export function planOffensive(s, from, to, troops, art, air, keep = 0) {
  if (!canAttack(s, from, to)) return 'Invalid offensive.';
  if (s.orders.some((o) => o.to === to)) return 'An offensive is already planned against this region.';
  troops = Math.min(troops, availableFor(s, from, to, keep));
  if (troops < 5) return 'Commit at least 5 troops.';
  const cost = art * ART_COST + air * AIR_COST;
  if (cost > s.res.allies.sup) return 'Not enough supplies for that support.';
  if (air > 0 && !WEATHER[s.weather].air) return 'Air support grounded by weather.';
  s.res.allies.sup -= cost;
  // draw from the primary region first, then neighbouring Allied regions (combined offensive)
  const sources = [];
  let need = troops;
  for (const i of [from, ...validSources(s, to).filter((i) => i !== from)]) {
    if (need <= 0) break;
    const avail = Math.max(0, s.regions[i].troops - reserveOf(s, i, i === from ? keep : 0));
    const n = Math.min(need, avail);
    if (n <= 0) continue;
    s.regions[i].troops -= n; need -= n; sources.push([i, n]);
  }
  s.orders.push({ from, to, troops, art, air, sources });
  return null;
}

// troops a region keeps back when it contributes to an offensive
function reserveOf(s, i, keep) {
  if (REGIONS[i].hq) return 0;
  return Math.max(3, Math.ceil(s.regions[i].troops * keep));
}
export function availableFor(s, from, to, keep = 0) {
  return validSources(s, to).reduce((a, i) => a + Math.max(0, s.regions[i].troops - reserveOf(s, i, i === from ? keep : 0)), 0);
}

export function cancelOffensive(s, k) {
  const o = s.orders[k]; if (!o) return;
  for (const [i, n] of (o.sources || [[o.from, o.troops]])) s.regions[i].troops += n;
  s.res.allies.sup += o.art * ART_COST + o.air * AIR_COST;
  s.orders.splice(k, 1);
}

// ---------- Axis AI ----------
export function distanceToFront(s, side) {
  const g = getGeo();
  const d = REGIONS.map(() => 99);
  const q = [];
  REGIONS.forEach((r, i) => {
    if (s.regions[i].owner !== side) return;
    if (g.adj[i].some((j) => s.regions[j].owner !== side && !REGIONS[j].hq)) { d[i] = 0; q.push(i); }
  });
  while (q.length) {
    const a = q.shift();
    for (const b of g.adj[a]) if (s.regions[b].owner === side && d[b] > d[a] + 1) { d[b] = d[a] + 1; q.push(b); }
  }
  return d;
}

export function axisReinforce(s) {
  const g = getGeo();
  const owned = REGIONS.map((r, i) => i).filter((i) => s.regions[i].owner === 'axis');
  const income = Math.round(4 + owned.reduce((a, i) => a + REGIONS[i].value, 0) * 0.13 + (s.flags.winterDone ? 0 : 3));
  s.res.axis.mp += income;
  s.res.axis.sup += 4 + Math.round(owned.length * 0.3);
  const dist = distanceToFront(s, 'axis');
  // shift interior troops toward the front
  for (const i of owned) {
    if (dist[i] === 0 || dist[i] === 99) continue;
    const r = s.regions[i];
    const spare = r.troops - (REGIONS[i].capital ? 30 : 8);
    if (spare <= 2) continue;
    const next = g.adj[i].filter((j) => s.regions[j].owner === 'axis' && dist[j] < dist[i]);
    if (!next.length) continue;
    const j = pick(next);
    const mv = Math.floor(spare * 0.45 * (0.4 + 0.6 * (s.ecoRail ?? 1)));
    r.troops -= mv; s.regions[j].troops = Math.min(MAX_TROOPS, s.regions[j].troops + mv);
  }
  // spend manpower on threatened frontier regions
  const front = owned.filter((i) => dist[i] === 0);
  if (!front.length) return;
  const threat = front.map((i) => {
    const allied = g.adj[i].filter((j) => s.regions[j].owner === 'allies' && !REGIONS[j].hq).reduce((a, j) => a + s.regions[j].troops, 0);
    return { i, w: (allied + 10) / (s.regions[i].troops + 10) + REGIONS[i].value * 0.1 };
  }).sort((a, b) => b.w - a.w);
  let mp = s.res.axis.mp;
  for (const t of threat) {
    if (mp < 5) break;
    const amt = Math.min(Math.ceil(mp * 0.5), MAX_TROOPS - s.regions[t.i].troops);
    if (amt <= 0) continue;
    s.regions[t.i].troops += amt; mp -= amt;
  }
  s.res.axis.mp = mp;
  // occasional fortification
  if (s.res.axis.sup > 40) {
    const t = threat[0]; if (t && s.regions[t.i].fort < 3) { s.regions[t.i].fort++; s.res.axis.sup -= 30; }
  }
}

export function axisPlanAttacks(s, busy = new Set(), maxN = 2) {
  const g = getGeo();
  const cands = [];
  REGIONS.forEach((r, a) => {
    const ar = s.regions[a];
    if (ar.owner !== 'axis' || ar.troops < 10) return;
    for (const t of g.adj[a]) {
      const tr = s.regions[t];
      if (tr.owner !== 'allies' || REGIONS[t].hq) continue;
      if (busy.has(a) || busy.has(t)) continue; // already fighting
      if (s.landing && s.landing.secureUntil > s.day && REGIONS[t].prov === s.landing.prov) continue; // the beachhead is consolidating
      const defEff = (tr.troops + 1) * TERRAIN_INFO[REGIONS[t].terrain].def * (1 + 0.15 * tr.fort);
      const att = ar.troops * 0.7;
      const score = att / defEff + REGIONS[t].value * 0.04 + (REGIONS[t].port ? 0.15 : 0);
      cands.push({ a, t, score, defEff });
    }
  });
  cands.sort((x, y) => y.score - x.score);
  let n = Math.min(maxN, s.res.axis.mp > 40 ? 3 : 2);
  if (s.flags.winterNow) n += 4;
  const used = new Set();
  const plans = [];
  for (const c of cands) {
    if (plans.length >= n) break;
    if (c.score < (s.flags.winterNow ? 0.8 : 1.15)) break;
    if (used.has(c.a) || used.has('t' + c.t)) continue;
    const ar = s.regions[c.a];
    const troops = Math.round(clamp(c.defEff * 1.4, 8, ar.troops * 0.75));
    ar.troops -= troops;
    used.add(c.a); used.add('t' + c.t);
    plans.push({ from: c.a, to: c.t, troops, art: s.res.axis.sup > 30 ? 1 : 0, air: 0 });
    if (s.res.axis.sup > 30) s.res.axis.sup -= 15;
  }
  return plans;
}

// ---------- Turn flow ----------
export function endPlanning(s) {
  // Scripted winter offensive
  const date = currentDate(s);
  s.flags.winterNow = false;
  if (!s.flags.winterDone && date >= new Date(Date.UTC(1944, 11, 12))) {
    const ard = getGeo().idx.ard;
    s.flags.winterDone = true;
    s.flags.winterNow = true;
    const front = distanceToFront(s, 'axis');
    REGIONS.forEach((r, i) => {
      if (s.regions[i].owner === 'axis' && front[i] <= 1 && Math.hypot(r.x - REGIONS[ard].x, r.y - REGIONS[ard].y) < 260) s.regions[i].troops = Math.min(MAX_TROOPS, s.regions[i].troops + 35);
    });
    log(s, 'WINTER COUNTEROFFENSIVE! Under cover of bad weather, German armored reserves strike the Allied lines.', 'bad');
  }
  const axisPlans = axisPlanAttacks(s);
  const battles = [];
  let id = 0;
  for (const o of s.orders) {
    battles.push({ id: id++, attacker: 'allies', from: o.from, sources: o.sources, to: o.to, attTroops: o.troops, defTroops: s.regions[o.to].troops, art: o.art, air: o.air, enemyArt: s.regions[o.to].fort >= 2 ? 1 : 0, resolved: false });
  }
  for (const o of axisPlans) {
    battles.push({ id: id++, attacker: 'axis', from: o.from, to: o.to, attTroops: o.troops, defTroops: s.regions[o.to].troops, art: 1 + (s.res.allies.sup > 60 ? 1 : 0), air: 0, enemyArt: o.art, resolved: false });
    log(s, `Enemy counterattack on ${REGIONS[o.to].name} from ${REGIONS[o.from].name} (${o.troops} troops).`, 'bad');
  }
  s.orders = [];
  s.battles = battles;
  s.phase = 'brief';
}

export function autoResolve(s, b, ratioBias = 0) {
  const sup = computeSupply(s);
  const def = s.regions[b.to];
  const tinfo = TERRAIN_INFO[REGIONS[b.to].terrain];
  const attSupMod = sup[b.from] ? 1 : 0.75;
  const isAlliedAtt = b.attacker === 'allies';
  const attSupport = 1 + 0.12 * (isAlliedAtt ? b.art : b.enemyArt) + 0.2 * (isAlliedAtt ? b.air : 0);
  const defSupport = 1 + 0.08 * (isAlliedAtt ? b.enemyArt : b.art);
  const attP = b.attTroops * attSupMod * attSupport * rand(0.8, 1.2);
  const effFort = Math.max(0, def.fort - 0.5 * (isAlliedAtt ? b.art : b.enemyArt));
  const defP = Math.max(1, b.defTroops) * tinfo.def * (1 + 0.12 * effFort) * defSupport * rand(0.8, 1.2);
  const ratio = (attP / defP) * (1 + ratioBias);
  const attWin = ratio > 1;
  const attLossF = clamp(0.12 + 0.3 / ratio, 0.1, 0.85);
  const defLossF = clamp(0.12 + 0.3 * ratio, 0.1, 0.95);
  const attLoss = Math.round(b.attTroops * (attWin ? attLossF * 0.8 : attLossF));
  const defLoss = Math.round(b.defTroops * (attWin ? Math.max(defLossF, 0.5) : defLossF * 0.8));
  return { winner: attWin ? b.attacker : (b.attacker === 'allies' ? 'axis' : 'allies'), attLoss, defLoss, mode: 'auto' };
}

// result: { winner, attLoss, defLoss, mode, kills? }
export function applyBattle(s, b, result) {
  const g = getGeo();
  const attSide = b.attacker, defSide = attSide === 'allies' ? 'axis' : 'allies';
  const target = s.regions[b.to];
  const attLeft = Math.max(0, b.attTroops - result.attLoss);
  const defLeft = Math.max(0, b.defTroops - result.defLoss);
  const name = REGIONS[b.to].name;
  if (attSide === 'allies') { s.stats.alliedLosses += result.attLoss; s.stats.axisLosses += result.defLoss; }
  else { s.stats.alliedLosses += result.defLoss; s.stats.axisLosses += result.attLoss; }
  b.resolved = true; b.result = result;
  if (result.winner === attSide) {
    // defender retreats
    const retreat = g.adj[b.to].filter((j) => s.regions[j].owner === defSide && !REGIONS[j].hq)
      .sort((x, y) => s.regions[x].troops - s.regions[y].troops);
    if (retreat.length && defLeft > 0) s.regions[retreat[0]].troops = Math.min(MAX_TROOPS, s.regions[retreat[0]].troops + defLeft);
    target.owner = attSide; target.troops = Math.max(1, attLeft); target.fort = Math.max(0, target.fort - 1); target.lockedIn = 0;
    if (attSide === 'allies') {
      s.stats.won++;
      log(s, `VICTORY at ${name}! Allied forces capture the region (${result.attLoss} lost, ${result.defLoss} enemy casualties).`, 'good');
      onAlliedCapture(s, b.to);
    } else {
      s.stats.lost++;
      log(s, `${name} has fallen to the enemy counterattack. (${result.defLoss} Allied casualties)`, 'bad');
    }
  } else {
    target.troops = Math.max(1, defLeft);
    const srcs = (b.sources || [[b.from, b.attTroops]]).filter(([i]) => s.regions[i].owner === attSide);
    const tot = srcs.reduce((a, [, n]) => a + n, 0) || 1;
    for (const [i, n] of srcs) s.regions[i].troops = Math.min(MAX_TROOPS, s.regions[i].troops + Math.round(attLeft * n / tot));
    if (attSide === 'allies') { s.stats.lost++; log(s, `The assault on ${name} was repulsed. (${result.attLoss} Allied casualties, ${result.defLoss} enemy)`, 'bad'); }
    else { s.stats.won++; log(s, `The enemy attack on ${name} was beaten back! (${result.attLoss} enemy casualties)`, 'good'); }
  }
}

// A sector changed hands: province-wide news (broken into, liberated, lost) for everyone.
export function onSectorChange(s, i, newOwner) {
  const p = REGIONS[i].prov, P = PROVINCES[p], secs = PROVINCE_SECTORS[p];
  if (P.hq) return;
  s.provState = s.provState || {};
  const prev = s.provState[p] || P.owner;
  const now = secs.every((j) => s.regions[j].owner === newOwner) ? newOwner : 'contested';
  if (now === prev) return;
  s.provState[p] = now;
  if (newOwner === 'allies') {
    if (now === 'allies') log(s, `${P.name.toUpperCase()} LIBERATED: every sector of the province is in Allied hands.`, 'good');
    else if (prev === 'axis') log(s, `Allied troops have broken into ${P.name}.`, 'good');
  } else if (now === 'axis') log(s, `${P.name} has been lost: the Germans hold the whole province again.`, 'bad');
  else if (prev === 'allies') log(s, `A German counterattack has broken into ${P.name}.`, 'bad');
}
export const provinceHeld = (s, id) => { const p = PROVINCES.findIndex((x) => x.id === id); return p >= 0 && PROVINCE_SECTORS[p].every((j) => s.regions[j].owner === 'allies'); };

export function onAlliedCapture(s, i) {
  const r = { ...REGIONS[i], id: REGIONS[i].id.split('-')[0] };
  if (r.id === 'par' && !s.flags.paris && provinceHeld(s, 'par')) { s.flags.paris = true; s.maxOffensives = 3; s.res.allies.mp += 40; log(s, 'PARIS LIBERATED! Free French forces join the fight: +40 manpower, +1 offensive per turn.', 'good'); }
  if (r.id === 'ant' && REGIONS[i].port && !s.flags.antwerp) { s.flags.antwerp = true; s.res.allies.sup += 60; log(s, 'The port of Antwerp is open — a flood of supplies arrives (+60 supplies).', 'good'); }
  if (r.homeland && !s.flags.reich) { s.flags.reich = true; s.maxOffensives = Math.max(s.maxOffensives, 3); log(s, 'Allied troops cross into Germany itself.', 'good'); }
  if (r.id === 'ruh' && !s.flags.ruhr && provinceHeld(s, 'ruh')) { s.flags.ruhr = true; log(s, 'The Ruhr industrial heartland is captured. German production collapses.', 'good'); }
  if (REGIONS[i].capital) { s.result = 'victory'; s.phase = 'over'; log(s, 'BERLIN HAS FALLEN. The war in Europe is over.', 'good'); }
}

export function allBattlesResolved(s) { return s.battles.every((b) => b.resolved); }

const WEATHER_TABLE = {
  summer: [['clear', 50], ['overcast', 30], ['rain', 14], ['fog', 6]],
  autumn: [['clear', 25], ['overcast', 30], ['rain', 30], ['fog', 15]],
  winter: [['clear', 15], ['overcast', 25], ['snow', 40], ['fog', 20]],
  spring: [['clear', 35], ['overcast', 30], ['rain', 25], ['fog', 10]],
};
export function rollWeather(s) {
  const m = currentDate(s).getUTCMonth();
  const season = m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : (m === 11 || m <= 1) ? 'winter' : 'spring';
  const tbl = WEATHER_TABLE[season];
  let r = Math.random() * 100;
  for (const [w, p] of tbl) { if ((r -= p) < 0) return w; }
  return 'clear';
}

export function randomEvent(s) {
  if (Math.random() > 0.4) return;
  const g = getGeo();
  const dist = distanceToFront(s, 'axis');
  const front = REGIONS.map((r, i) => i).filter((i) => s.regions[i].owner === 'axis' && dist[i] === 0);
  const ev = Math.floor(Math.random() * 6);
  if (ev === 0 && front.length) {
    const i = pick(front); const l = Math.round(s.regions[i].troops * 0.25); s.regions[i].troops -= l;
    log(s, `Resistance fighters sabotage rail lines near ${REGIONS[i].name}: enemy garrison loses ${l} troops.`, 'good', i);
  } else if (ev === 1) { s.res.allies.sup += 35; log(s, 'A large supply convoy arrives: +35 supplies.', 'good'); }
  else if (ev === 2) { s.res.allies.mp += 25; log(s, 'Fresh replacements arrive from across the Atlantic: +25 manpower.', 'good'); }
  else if (ev === 3 && front.length) {
    const i = pick(front); s.regions[i].troops = Math.min(MAX_TROOPS, s.regions[i].troops + 10);
    log(s, `Intelligence reports a panzer reserve moving into ${REGIONS[i].name} (+10 enemy troops).`, 'bad', i);
  } else if (ev === 4) { s.res.allies.sup = Math.max(0, s.res.allies.sup - 25); log(s, 'Storms in the Channel disrupt shipping: -25 supplies.', 'bad'); }
  else if (ev === 5 && front.length) {
    const i = pick(front); s.regions[i].fort = Math.min(3, s.regions[i].fort + 1);
    log(s, `Enemy engineers fortify ${REGIONS[i].name}.`, 'bad', i);
  }
}

export function finishTurn(s) {
  if (s.phase === 'over') { saveCampaign(s); return; }
  const sup = computeSupply(s);
  // attrition for unsupplied regions
  REGIONS.forEach((r, i) => {
    const reg = s.regions[i]; reg.lockedIn = 0;
    if (!sup[i] && !r.hq && reg.troops > 3) {
      const l = Math.ceil(reg.troops * 0.1); reg.troops -= l;
      if (reg.owner === 'allies') log(s, `${r.name} is cut off from supply and loses ${l} troops.`, 'bad');
    }
  });
  // allied income
  let val = 0, ports = 0;
  REGIONS.forEach((r, i) => { if (s.regions[i].owner === 'allies' && sup[i]) { val += r.value; if (r.port) ports++; } });
  const mpInc = 21 + Math.round(val * 0.55);
  const supInc = 28 + ports * 6 + val;
  s.res.allies.mp += mpInc; s.res.allies.sup += supInc;
  axisReinforce(s);
  s.turn++;
  s.weather = rollWeather(s);
  randomEvent(s);
  log(s, `Week ${s.turn}: +${mpInc} manpower, +${supInc} supplies. Weather: ${WEATHER[s.weather].label}.`, 'info');
  // win / lose checks
  const alliedCont = REGIONS.filter((r, i) => !r.hq && s.regions[i].owner === 'allies').length;
  const axisCount = REGIONS.filter((r, i) => s.regions[i].owner === 'axis').length;
  if (axisCount <= 3) { s.result = 'victory'; s.phase = 'over'; log(s, 'Germany surrenders unconditionally!', 'good'); }
  else if (s.turn > 4 && alliedCont === 0 && s.regions[getGeo().idx.eng].troops + s.res.allies.mp < 60) { s.result = 'defeat'; s.phase = 'over'; log(s, 'The Allies have been driven back into the sea.', 'bad'); }
  else if (s.turn > 56) { s.result = 'stalemate'; s.phase = 'over'; log(s, 'The war drags on into the summer of 1945. Command has relieved you.', 'bad'); }
  else s.phase = 'brief';
  s.battles = [];
  if (s.phase !== 'over') { replenishSquad(s); refreshAssets(s); planWeek(s); }
  saveCampaign(s);
}

// Build the configuration for a first-person battle.
export function battleConfig(s, b) {
  const r = REGIONS[b.to];
  const alliedTroops = b.attacker === 'allies' ? b.attTroops : b.defTroops;
  const axisTroops = b.attacker === 'allies' ? b.defTroops : b.attTroops;
  const sup = computeSupply(s);
  return {
    region: r.name, terrain: r.terrain, weather: s.weather, winter: isWinter(s),
    attacker: b.attacker, alliedTroops, axisTroops,
    fort: s.regions[b.to].fort,
    alliedArt: b.attacker === 'allies' ? b.art : b.art,
    alliedAir: b.air,
    axisArt: b.enemyArt,
    supplied: sup[b.from],
    seed: (s.turn * 7919 + b.to * 104729 + b.id * 31) >>> 0,
    botCap: s.settings.botCap,
    difficulty: s.settings.difficulty,
    amphibious: REGIONS[b.from].hq === true,
  };
}

// =====================================================================
// AI-run front, Ranger missions and weekly resolution
// =====================================================================
const RANGER_NAMES = ['Ruppert', 'Lomell', 'Kuhn', 'Rudder', 'Masny', 'Petty', 'Cripps', 'Goranson', 'Slater', 'Hathaway', 'Kerchner', 'Baugh', 'Dreher', 'Vaughan', 'Fitzsimmons', 'Rafferty', 'Moody', 'Zelepsky', 'Burke', 'Carty', 'Lacy', 'Hale', 'Ortega', 'Nowak', 'Sweeney', 'Bishop', 'Garza', 'Whitfield', 'Kessler', 'Duval'];
const RANGER_CLS = ['rifleman', 'assault', 'support', 'rifleman'];
export function replenishSquad(s) {
  for (const m of s.squad) if (m.status === 'wia') { m.status = 'active'; if (!m.leader) log(s, `${m.rank} ${m.name} returns to the squad from the aid station.`, 'info'); }
  const kia = s.squad.filter((m) => m.status === 'kia');
  s.fallen = (s.fallen || []).concat(kia.map((m) => `${m.rank} ${m.name}`));
  s.squad = s.squad.filter((m) => m.status !== 'kia');
  const used = new Set(s.squad.map((m) => m.name).concat(s.fallen.map((n) => n.split(' ').pop())));
  while (s.squad.length < 5) {
    let name = pick(RANGER_NAMES); for (let k = 0; k < 20 && used.has(name); k++) name = pick(RANGER_NAMES);
    used.add(name);
    const slot = s.squad.length - 1;
    const vet = s.kit && s.kit.veterans;
    s.squad.push({ name, rank: pick(['Pvt.', 'Pfc.', 'Pfc.', 'T/5', 'Sgt.']), cls: RANGER_CLS[slot % 4], status: 'active', kills: 0, missions: 0, exp: vet ? 2 : 0, level: vet ? 1 : 0 });
    if (s.turn > 1) log(s, `Replacement ${s.squad[s.squad.length - 1].rank} ${name} joins the squad.`, 'info');
  }
}

// Distance (in regions) of each German region from the Allied line, counting sea lanes from England.
export function missionDepth(s) {
  const g = getGeo();
  const d = REGIONS.map(() => 99), q = [];
  REGIONS.forEach((r, i) => {
    if (s.regions[i].owner !== 'axis') return;
    if (g.adj[i].some((j) => s.regions[j].owner === 'allies')) { d[i] = 0; q.push(i); }
  });
  while (q.length) {
    const a = q.shift();
    for (const b of g.adj[a]) if (s.regions[b].owner === 'axis' && d[b] > d[a] + 1) { d[b] = d[a] + 1; q.push(b); }
  }
  return d;
}

const ASSET_WEIGHTS = {
  default: { artillery: 3, flak: 2, fuel: 2, ammo: 2, radio: 2, trucks: 2, tank: 1 },
  beach: { artillery: 4, flak: 1, fuel: 1, ammo: 2, radio: 3, trucks: 1, tank: 0 },
  homeland: { artillery: 2, flak: 3, fuel: 2, ammo: 2, radio: 1, trucks: 2, tank: 3 },
};
function rollAsset(r, avoid) {
  const w = r.terrain === 'beach' ? ASSET_WEIGHTS.beach : r.homeland ? ASSET_WEIGHTS.homeland : ASSET_WEIGHTS.default;
  let tot = 0; const opts = Object.entries(w).filter(([k, v]) => v > 0 && !avoid.has(k));
  for (const [, v] of opts) tot += v;
  let x = Math.random() * tot;
  for (const [k, v] of opts) if ((x -= v) < 0) return k;
  return 'ammo';
}
export function refreshAssets(s) {
  const depth = missionDepth(s);
  REGIONS.forEach((r, i) => {
    if (s.regions[i].owner !== 'axis' || depth[i] > 1) { delete s.assets[i]; return; }
    const list = s.assets[i] || (s.assets[i] = []);
    const want = Math.min(3, 1 + (r.value >= 1 ? 1 : 0) + (s.regions[i].fort >= 2 ? 1 : 0));
    // the enemy rebuilds slowly: at most one new asset per week per sector
    if (list.length < want && (list.length < 1 || Math.random() < 0.5)) {
      const n = list.length === 0 ? want : 1;
      for (let k = 0; k < n; k++) list.push({ id: s.nextAssetId++, type: rollAsset(r, new Set(list.map((a) => a.type))) });
    }
  });
}
export function missionSectors(s) {
  const depth = missionDepth(s);
  return REGIONS.map((r, i) => i).filter((i) => s.regions[i].owner === 'axis' && depth[i] <= 1 && (s.assets[i] || []).length);
}

// Allied AI commander: moves reserves up, reinforces the line, launches offensives.
export function alliedAI(s) {
  const g = getGeo();
  const sup = computeSupply(s);
  const own = () => s.regions.map((x, i) => i).filter((i) => s.regions[i].owner === 'allies');
  const isFront = (i) => g.adj[i].some((j) => s.regions[j].owner === 'axis');
  // shift rear troops toward the front
  for (const i of own()) {
    if (isFront(i) || REGIONS[i].hq) continue;
    const t = g.adj[i].filter((j) => s.regions[j].owner === 'allies' && isFront(j)).sort((a, b) => s.regions[a].troops - s.regions[b].troops)[0];
    if (t !== undefined) moveTroops(s, i, t, s.regions[i].troops - 3);
  }
  // reinforce the weakest supplied frontline regions (England counts while it is the jump-off point)
  for (let k = 0; k < 24 && s.res.allies.mp >= 10; k++) {
    const fr = own().filter((i) => isFront(i) && (sup[i] || REGIONS[i].hq)).sort((a, b) => s.regions[a].troops - s.regions[b].troops)[0];
    if (fr === undefined || reinforce(s, fr, 10)) break;
  }
  // offensives: best odds first, committing enough for a solid margin
  const defOf = (j) => Math.max(1, s.regions[j].troops) * TERRAIN_INFO[REGIONS[j].terrain].def * (1 + 0.12 * s.regions[j].fort);
  const cands = [];
  for (const i of own()) for (const j of g.adj[i]) if (s.regions[j].owner === 'axis' && !cands.some((c) => c[2] === j)) cands.push([0, i, j]);
  for (const c of cands) c[0] = availableFor(s, c[1], c[2], 0.3) * 1.2 / defOf(c[2]) + REGIONS[c[2]].value * 0.03 + (REGIONS[c[2]].capital ? 0.3 : 0);
  cands.sort((a, b) => b[0] - a[0]);
  for (const [, i, j] of cands) {
    if (s.orders.length + (s.battles || []).filter((b) => b.attacker === 'allies').length >= s.maxOffensives) break;
    if ((s.battles || []).some((b) => b.to === j || b.from === j)) continue;
    const src = validSources(s, j).sort((a, b) => s.regions[b].troops - s.regions[a].troops)[0];
    if (src === undefined) continue;
    const avail = availableFor(s, src, j, 0.3);
    const art = Math.min(2, Math.floor(s.res.allies.sup / ART_COST / 2));
    const need = defOf(j) * 1.7 / (1 + 0.12 * art);
    if (avail < need * 0.75) continue;
    const air = WEATHER[s.weather].air && s.res.allies.sup - art * ART_COST > 60 ? 1 : 0;
    planOffensive(s, src, j, Math.floor(Math.min(avail, need * 1.15)), art, air, 0.3);
  }
}

export function planWeek(s) {
  s.orders = [];
  s.mods = {};
  alliedAI(s);
  endPlanning(s);
  for (const b of s.battles) if (b.attacker === 'allies') log(s, `Allied offensive planned: ${REGIONS[b.from].name} ➜ ${REGIONS[b.to].name} (${b.attTroops} troops).`, 'info');
}

// Battles in a sector this week (for placing a live front in the mission map).
export function sectorBattle(s, region) {
  return s.battles.find((b) => b.to === region && b.attacker === 'allies') || s.battles.find((b) => b.from === region && b.attacker === 'axis') || null;
}

// Apply what the Rangers did in a sector, then resolve every battle of the week simultaneously.
export function resolveWeek(s, m) {
  const report = { week: s.turn, mission: null, battles: [], effects: [] };
  if (m) report.mission = applyMission(s, m, report.effects);
  for (const b of s.battles) {
    const mods = s.mods;
    let bias = b.bias || 0;
    if (b.attacker === 'axis') {
      const mf = mods[b.from];
      if (mf && mf.noAttack) {
        s.regions[b.from].troops = Math.min(MAX_TROOPS, s.regions[b.from].troops + b.attTroops);
        b.resolved = true; b.result = { winner: 'allies', attLoss: 0, defLoss: 0, mode: 'cancelled' };
        report.battles.push({ b, cancelled: true });
        log(s, `The German attack on ${REGIONS[b.to].name} never materialises — Rangers crippled its staging area in ${REGIONS[b.from].name}.`, 'good');
        continue;
      }
      if (mf && mf.artCut) b.enemyArt = 0;
      if (mf && mf.defMult) bias -= 0.15;
    } else {
      const mt = mods[b.to];
      if (mt) { if (mt.defMult) bias += 0.18; if (mt.airFree) bias += 0.2; if (mt.artCut) b.enemyArt = 0; if (mt.primary) bias += 0.08; }
    }
    const r = autoResolve(s, b, bias);
    if (b.frontWinner) r.winner = b.frontWinner; // a front the Rangers saw decided keeps its outcome
    applyBattle(s, b, r);
    report.battles.push({ b, result: r });
  }
  s.report = report;
  s.battles.forEach((b) => (b.resolved = true));
  finishTurn(s);
  s.report = report;
  saveCampaign(s);
  return report;
}

function applyMission(s, m, effects) {
  const r = m.region, name = REGIONS[r].name;
  const reg = s.regions[r];
  const mods = s.mods[r] || (s.mods[r] = {});
  s.stats.missions++;
  const list = s.assets[r] || [];
  for (const id of m.destroyed) {
    const k = list.findIndex((a) => a.id === id);
    if (k < 0) continue;
    const a = list.splice(k, 1)[0];
    s.stats.assets++;
    const T = ASSET_TYPES[a.type];
    let txt = '';
    if (a.type === 'artillery') { mods.artCut = true; reg.fort = Math.max(0, reg.fort - 1); txt = 'artillery support eliminated, fortifications reduced'; }
    if (a.type === 'flak') { mods.airFree = true; txt = 'the skies are open to Allied air power'; }
    if (a.type === 'fuel') { mods.noAttack = true; s.res.axis.sup = Math.max(0, s.res.axis.sup - 15); txt = 'German units here are out of fuel'; }
    if (a.type === 'ammo') { reg.troops = Math.max(1, reg.troops - 12); txt = 'the garrison is short of ammunition (−12)'; }
    if (a.type === 'radio') { mods.defMult = true; mods.noAttack = true; txt = 'German command in the sector is decapitated'; }
    if (a.type === 'trucks') { s.res.axis.mp = Math.max(0, s.res.axis.mp - 10); s.res.axis.sup = Math.max(0, s.res.axis.sup - 10); txt = 'German logistics disrupted'; }
    if (a.type === 'tank') { reg.troops = Math.max(1, reg.troops - 15); txt = 'armored reserves destroyed (−15)'; }
    const primary = id === m.primaryId;
    effects.push(`${primary ? '★ ' : ''}${T.label} destroyed at ${name}: ${txt}.`);
    log(s, `Rangers destroyed the ${T.label.toLowerCase()} at ${name}${primary ? ' (primary objective)' : ''}: ${txt}.`, 'good');
  }
  if (m.primaryDone) {
    s.stats.missionsWon++; mods.primary = true; s.res.allies.mp += 8;
    effects.push('Primary objective complete: Allied morale in the sector rises.');
  } else effects.push(m.extracted ? 'Primary objective not completed.' : 'The squad was lost before completing the mission.');
  if (m.kills) {
    const l = Math.min(reg.troops - 1, Math.round(m.kills * 0.4));
    reg.troops -= l; s.stats.kills += m.kills; s.stats.axisLosses += l;
    if (l > 0) effects.push(`${m.kills} enemy soldiers killed by the squad (−${l} garrison strength).`);
  }
  if (m.front) {
    const b = s.battles.find((x) => x.id === m.front.battleId);
    if (b) {
      const allied = m.front.bias; // positive favours the Allies
      b.bias = (b.bias || 0) + (b.attacker === 'allies' ? allied : -allied);
      if (m.front.winner) b.frontWinner = m.front.winner;
      effects.push(m.front.winner ? `The battle for ${REGIONS[b.to].name} you fought beside ended in ${m.front.winner === 'allies' ? 'an Allied victory' : 'a German victory'}.` : `The battle you saw in the sector was ${allied > 0.05 ? 'going the Allies’ way' : allied < -0.05 ? 'going badly' : 'still in the balance'} when you left.`);
    }
  }
  // squad fates
  for (const sm of m.squad) {
    const mem = s.squad[sm.idx]; if (!mem) continue;
    mem.kills += sm.kills || 0;
    if (!sm.alive) {
      if (mem.leader) { mem.status = 'wia'; effects.push('You were wounded and evacuated — you will be back next week.'); }
      else { mem.status = 'kia'; effects.push(`${mem.rank} ${mem.name} was killed in action.`); log(s, `${mem.rank} ${mem.name} was killed in action at ${name}.`, 'bad'); }
    } else mem.missions++;
  }
  saveCampaign(s);
  return { region: r, primaryDone: m.primaryDone, destroyed: m.destroyed.length, kills: m.kills };
}

// Configuration for a Ranger operation from the mission board.
export function missionConfig(s, mission, cls, skillOf) {
  const region = mission.region, r = REGIONS[region];
  const b = s.battles.find((x) => x.to === region || x.from === region) || null;
  const defense = mission.type === 'defense', landing = mission.type === 'landing';
  const depth = defense || landing ? 0 : missionDepth(s)[region];
  const assets = defense ? [] : (s.assets[region] || []).map((a) => ({ ...a, primary: mission.type === 'sabotage' && a.id === mission.assetId }));
  return {
    mode: 'mission',
    region: r.name, regionIdx: region, terrain: r.terrain, weather: s.weather, winter: isWinter(s),
    fort: s.regions[region].fort, garrison: s.regions[region].troops, depth,
    mission: { id: mission.id, type: mission.type, title: mission.title, assetId: mission.assetId, strategicId: mission.strategicId, complex: mission.complex, assets },
    front: b ? { battleId: b.id, attacker: b.attacker } : null,
    defense: defense && b ? { attackers: b.att, defenders: s.regions[region].troops } : null,
    landing,
    artCut: !!(s.mods[region] && s.mods[region].until > s.day && s.mods[region].artCut),
    kit: s.kit,
    squad: s.squad.map((m, idx) => ({ ...m, idx, skill: skillOf ? skillOf(m) : 1 })).filter((m) => m.status === 'active'),
    playerCls: cls,
    seed: (s.day * 7919 + region * 104729 + mission.id * 31) >>> 0,
    botCap: s.settings.botCap, difficulty: s.settings.difficulty,
  };
}

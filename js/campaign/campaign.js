// Strategic layer: state, rules, Axis AI, auto-resolve, turn progression.
import { REGIONS, TERRAIN_INFO, WEATHER } from './data.js';
import { getGeo } from './geo.js';
import { clamp, rand, pick } from '../util.js';

const SAVE_KEY = 'roadToBerlin.save.v1';
export const ART_COST = 15;
export const AIR_COST = 25;
export const FORT_COST = 20;
export const MAX_TROOPS = 160;

export function newCampaign(settings = {}) {
  const regions = REGIONS.map((r) => ({ owner: r.owner, troops: r.troops, fort: r.capital ? 2 : (r.terrain === 'beach' ? 1 : 0), lockedIn: 0 }));
  const eng = REGIONS.findIndex((r) => r.hq);
  regions[eng].troops = 150;
  return {
    version: 1,
    turn: 1,
    startDate: Date.UTC(1944, 5, 6),
    regions,
    res: { allies: { mp: 60, sup: 90 }, axis: { mp: 40, sup: 40 } },
    weather: 'overcast',
    orders: [],
    battles: [],
    phase: 'plan',
    maxOffensives: 2,
    log: [{ turn: 1, type: 'event', text: 'Operation Overlord begins. Allied forces are staged in Southern England. Choose where to land.' }],
    stats: { won: 0, lost: 0, fps: 0, kills: 0, deaths: 0, alliedLosses: 0, axisLosses: 0 },
    flags: {},
    settings: { difficulty: settings.difficulty || 'normal', botCap: settings.botCap || 24 },
    result: null,
  };
}

export function saveCampaign(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }
export function loadCampaign() {
  try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

export function currentDate(s) { return new Date(s.startDate + (s.turn - 1) * 7 * 86400000); }

export function isWinter(s) { const m = currentDate(s).getUTCMonth(); return m === 11 || m <= 1; }

export function adjacent(a) { return getGeo().adj[a]; }

export function log(s, text, type = 'info') { s.log.push({ turn: s.turn, text, type }); if (s.log.length > 120) s.log.shift(); }

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

export function planOffensive(s, from, to, troops, art, air) {
  if (s.orders.length >= s.maxOffensives) return `Maximum ${s.maxOffensives} offensives per turn.`;
  if (!canAttack(s, from, to)) return 'Invalid offensive.';
  if (s.orders.some((o) => o.to === to)) return 'An offensive is already planned against this region.';
  troops = Math.min(troops, availableFor(s, from, to));
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
    const avail = i === from ? s.regions[i].troops : Math.max(0, s.regions[i].troops - 3);
    const n = Math.min(need, avail);
    if (n <= 0) continue;
    s.regions[i].troops -= n; need -= n; sources.push([i, n]);
  }
  s.orders.push({ from, to, troops, art, air, sources });
  return null;
}

export function availableFor(s, from, to) {
  return validSources(s, to).reduce((a, i) => a + (i === from ? s.regions[i].troops : Math.max(0, s.regions[i].troops - 3)), 0);
}

export function cancelOffensive(s, k) {
  const o = s.orders[k]; if (!o) return;
  for (const [i, n] of (o.sources || [[o.from, o.troops]])) s.regions[i].troops += n;
  s.res.allies.sup += o.art * ART_COST + o.air * AIR_COST;
  s.orders.splice(k, 1);
}

// ---------- Axis AI ----------
function distanceToFront(s, side) {
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

function axisReinforce(s) {
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
    const spare = r.troops - (REGIONS[i].capital ? 60 : 18);
    if (spare <= 4) continue;
    const next = g.adj[i].filter((j) => s.regions[j].owner === 'axis' && dist[j] < dist[i]);
    if (!next.length) continue;
    const j = pick(next);
    const mv = Math.floor(spare * 0.45);
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

function axisPlanAttacks(s) {
  const g = getGeo();
  const cands = [];
  REGIONS.forEach((r, a) => {
    const ar = s.regions[a];
    if (ar.owner !== 'axis' || ar.troops < 18) return;
    for (const t of g.adj[a]) {
      const tr = s.regions[t];
      if (tr.owner !== 'allies' || REGIONS[t].hq) continue;
      if (s.orders.some((o) => o.to === a)) continue; // busy defending
      const defEff = (tr.troops + 1) * TERRAIN_INFO[REGIONS[t].terrain].def * (1 + 0.15 * tr.fort);
      const att = ar.troops * 0.7;
      const score = att / defEff + REGIONS[t].value * 0.04 + (REGIONS[t].port ? 0.15 : 0);
      cands.push({ a, t, score, defEff });
    }
  });
  cands.sort((x, y) => y.score - x.score);
  let n = s.res.axis.mp > 40 ? 2 : 1;
  if (s.flags.winterNow) n += 2;
  const used = new Set();
  const plans = [];
  for (const c of cands) {
    if (plans.length >= n) break;
    if (c.score < (s.flags.winterNow ? 0.8 : 1.15)) break;
    if (used.has(c.a) || used.has('t' + c.t)) continue;
    const ar = s.regions[c.a];
    const troops = Math.round(clamp(c.defEff * 1.4, 15, ar.troops * 0.75));
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
  s.phase = 'battles';
  if (!battles.length) finishTurn(s);
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

function onAlliedCapture(s, i) {
  const r = REGIONS[i];
  if (r.id === 'par' && !s.flags.paris) { s.flags.paris = true; s.maxOffensives = 3; s.res.allies.mp += 40; log(s, 'PARIS LIBERATED! Free French forces join the fight: +40 manpower, +1 offensive per turn.', 'good'); }
  if (r.id === 'ant' && !s.flags.antwerp) { s.flags.antwerp = true; s.res.allies.sup += 60; log(s, 'The port of Antwerp is open — a flood of supplies arrives (+60 supplies).', 'good'); }
  if (r.homeland && !s.flags.reich) { s.flags.reich = true; s.maxOffensives = Math.max(s.maxOffensives, 3); log(s, 'Allied troops cross into Germany itself.', 'good'); }
  if (r.id === 'ruh' && !s.flags.ruhr) { s.flags.ruhr = true; log(s, 'The Ruhr industrial heartland is captured. German production collapses.', 'good'); }
  if (r.id === 'ber') { s.result = 'victory'; s.phase = 'over'; log(s, 'BERLIN HAS FALLEN. The war in Europe is over.', 'good'); }
}

export function allBattlesResolved(s) { return s.battles.every((b) => b.resolved); }

const WEATHER_TABLE = {
  summer: [['clear', 50], ['overcast', 30], ['rain', 14], ['fog', 6]],
  autumn: [['clear', 25], ['overcast', 30], ['rain', 30], ['fog', 15]],
  winter: [['clear', 15], ['overcast', 25], ['snow', 40], ['fog', 20]],
  spring: [['clear', 35], ['overcast', 30], ['rain', 25], ['fog', 10]],
};
function rollWeather(s) {
  const m = currentDate(s).getUTCMonth();
  const season = m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : (m === 11 || m <= 1) ? 'winter' : 'spring';
  const tbl = WEATHER_TABLE[season];
  let r = Math.random() * 100;
  for (const [w, p] of tbl) { if ((r -= p) < 0) return w; }
  return 'clear';
}

function randomEvent(s) {
  if (Math.random() > 0.4) return;
  const g = getGeo();
  const dist = distanceToFront(s, 'axis');
  const front = REGIONS.map((r, i) => i).filter((i) => s.regions[i].owner === 'axis' && dist[i] === 0);
  const ev = Math.floor(Math.random() * 6);
  if (ev === 0 && front.length) {
    const i = pick(front); const l = Math.round(s.regions[i].troops * 0.25); s.regions[i].troops -= l;
    log(s, `Resistance fighters sabotage rail lines near ${REGIONS[i].name}: enemy garrison loses ${l} troops.`, 'good');
  } else if (ev === 1) { s.res.allies.sup += 35; log(s, 'A large supply convoy arrives: +35 supplies.', 'good'); }
  else if (ev === 2) { s.res.allies.mp += 25; log(s, 'Fresh replacements arrive from across the Atlantic: +25 manpower.', 'good'); }
  else if (ev === 3 && front.length) {
    const i = pick(front); s.regions[i].troops = Math.min(MAX_TROOPS, s.regions[i].troops + 22);
    log(s, `Intelligence reports a panzer reserve moving into ${REGIONS[i].name} (+22 enemy troops).`, 'bad');
  } else if (ev === 4) { s.res.allies.sup = Math.max(0, s.res.allies.sup - 25); log(s, 'Storms in the Channel disrupt shipping: -25 supplies.', 'bad'); }
  else if (ev === 5 && front.length) {
    const i = pick(front); s.regions[i].fort = Math.min(3, s.regions[i].fort + 1);
    log(s, `Enemy engineers fortify ${REGIONS[i].name}.`, 'bad');
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
  const mpInc = 28 + Math.round(val * 0.6);
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
  else s.phase = 'plan';
  s.battles = [];
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

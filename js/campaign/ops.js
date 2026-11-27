// Mission board, strategic economy, squad points, quartermaster and career.
import { REGIONS, ASSET_TYPES } from './data.js';
import { getGeo } from './geo.js';
import * as C from './campaign.js';
import { pick } from '../util.js';

// ---------------- strategic economy ----------------
export const STRAT_TYPES = {
  factory:   { label: 'Armaments factory', effect: 'German manpower and armour production', icon: '⚙' },
  railyard:  { label: 'Rail yard',         effect: 'How fast German reinforcements reach the front', icon: '≡' },
  fuelplant: { label: 'Fuel plant',        effect: 'German capacity to launch attacks', icon: '◉' },
};
const STRAT_SITES = [
  ['par', 'factory'], ['rou', 'railyard'], ['rei', 'railyard'], ['bru', 'factory'], ['ant', 'fuelplant'], ['met', 'railyard'],
  ['lyo', 'factory'], ['aac', 'railyard'], ['col', 'factory'], ['ruh', 'factory'], ['ruh', 'fuelplant'], ['fra', 'railyard'],
  ['stu', 'factory'], ['han', 'fuelplant'], ['kas', 'railyard'], ['nur', 'railyard'], ['mun', 'factory'], ['lei', 'fuelplant'],
  ['ber', 'factory'], ['rot', 'fuelplant'],
];
export const REPAIR_DAYS = 28;

export function initOps(s) {
  const idx = getGeo().idx;
  s.strategic = STRAT_SITES.map(([rid, type], i) => ({ id: 1000 + i, region: idx[rid], type, status: 'ok', repairDay: 0 }));
  s.points = 0; s.pointsTotal = 0;
  s.board = []; s.nextMissionId = 1;
  s.kit = { springfield: false, bazooka: false, radio: false, demo: false, medkit: false, training: 0, veterans: false };
  s.career = { rank: 0, medals: [], streak: 0, log: [] };
  for (const m of s.squad) { m.exp = m.exp || 0; m.level = m.level || 0; }
  refreshBoard(s);
}

// Fractions of the German war economy still working (0..1)
export function economy(s) {
  const live = (t) => {
    const all = s.strategic.filter((x) => x.type === t && s.regions[x.region].owner === 'axis');
    if (!all.length) return 0;
    return all.filter((x) => x.status === 'ok').length / STRAT_SITES.filter(([, ty]) => ty === t).length;
  };
  return { factory: live('factory'), railyard: live('railyard'), fuelplant: live('fuelplant') };
}

// Daily: repairs. Called from the front tick.
export function opsDaily(s) {
  for (const t of s.strategic) {
    if (t.status === 'destroyed' && s.day >= t.repairDay && s.regions[t.region].owner === 'axis') {
      t.status = 'ok';
      C.log(s, `German engineers have repaired the ${STRAT_TYPES[t.type].label.toLowerCase()} at ${REGIONS[t.region].name}.`, 'bad');
    }
  }
  refreshBoard(s);
}

// ---------------- mission board ----------------
export const MISSION_TYPES = {
  sabotage: { label: 'Sabotage',       icon: '✸', base: 100 },
  raid:     { label: 'Strategic raid', icon: '⚙', base: 220 },
  recon:    { label: 'Reconnaissance', icon: '◎', base: 90 },
  ambush:   { label: 'Convoy ambush',  icon: '▬', base: 130 },
  capture:  { label: 'Snatch & grab',  icon: '✉', base: 160 },
  rescue:   { label: 'Rescue',         icon: '✚', base: 150 },
};

function sectorDepths(s) {
  const g = getGeo(), d = REGIONS.map(() => 99), q = [];
  REGIONS.forEach((r, i) => { if (s.regions[i].owner === 'axis' && g.adj[i].some((j) => s.regions[j].owner === 'allies')) { d[i] = 0; q.push(i); } });
  while (q.length) { const a = q.shift(); for (const b of g.adj[a]) if (s.regions[b].owner === 'axis' && d[b] > d[a] + 1) { d[b] = d[a] + 1; q.push(b); } }
  return d;
}

function makeMission(s, type, depth) {
  const D = depth;
  const near = REGIONS.map((r, i) => i).filter((i) => s.regions[i].owner === 'axis' && D[i] <= 1);
  const deep = REGIONS.map((r, i) => i).filter((i) => s.regions[i].owner === 'axis' && D[i] <= 5);
  const taken = new Set(s.board.map((m) => `${m.type}:${m.region}`));
  const ok = (i) => !taken.has(`${type}:${i}`);
  let m = null;
  if (type === 'sabotage') {
    const r = pick(near.filter((i) => (s.assets[i] || []).length && ok(i)));
    if (r === undefined) return null;
    const a = pick(s.assets[r]);
    m = { region: r, assetId: a.id, title: `Destroy the ${ASSET_TYPES[a.type].label.toLowerCase()}`, desc: ASSET_TYPES[a.type].effect };
  } else if (type === 'raid') {
    const t = pick(s.strategic.filter((x) => x.status === 'ok' && s.regions[x.region].owner === 'axis' && D[x.region] <= 5 && ok(x.region)));
    if (!t) return null;
    m = { region: t.region, strategicId: t.id, complex: t.type, title: `Demolish the ${STRAT_TYPES[t.type].label.toLowerCase()}`, desc: `Cripples ${STRAT_TYPES[t.type].effect} for ${REPAIR_DAYS} days.`, depthBonus: D[t.region] };
  } else if (type === 'recon') {
    const r = pick(near.filter((i) => D[i] === 0 && ok(i)));
    if (r === undefined) return null;
    m = { region: r, title: 'Scout the German positions', desc: 'Observe three enemy positions. The next Allied attack here gets a strong bonus, and every enemy asset in the sector is revealed.' };
  } else if (type === 'ambush') {
    const r = pick(deep.filter((i) => D[i] >= 0 && D[i] <= 2 && ok(i)));
    if (r === undefined) return null;
    m = { region: r, title: 'Ambush a supply convoy', desc: 'Stop a German convoy crossing the sector: costs the enemy supplies and the garrison troops.' };
  } else if (type === 'capture') {
    const r = pick(near.filter(ok));
    if (r === undefined) return null;
    m = { region: r, title: 'Seize a staff officer’s documents', desc: 'Reveals German attack plans for a month and disrupts their command in the sector.' };
  } else if (type === 'rescue') {
    const r = pick(near.filter(ok));
    if (r === undefined) return null;
    m = { region: r, title: 'Free captured airmen', desc: 'Bring downed aircrew home: a morale boost for the whole Allied effort.' };
  }
  const days = 14 + Math.floor(Math.random() * 18) + (type === 'raid' ? 10 : 0);
  return { id: s.nextMissionId++, type, ...m, deadline: s.day + days, reward: MISSION_TYPES[type].base + (m.depthBonus || 0) * 35 };
}

export function refreshBoard(s) {
  if (!s.board) return;
  const D = sectorDepths(s);
  // drop expired or no-longer-valid missions
  s.board = s.board.filter((m) => {
    if (m.deadline < s.day) { C.log(s, `Mission expired: ${m.title} (${REGIONS[m.region].name}).`, 'info'); return false; }
    if (s.regions[m.region].owner !== 'axis') return false;
    if (m.assetId && !(s.assets[m.region] || []).some((a) => a.id === m.assetId)) return false;
    if (m.strategicId && s.strategic.find((t) => t.id === m.strategicId).status !== 'ok') return false;
    return true;
  });
  const order = ['sabotage', 'raid', 'recon', 'ambush', 'capture', 'rescue'];
  let guard = 0;
  while (s.board.length < 6 && guard++ < 30) {
    const have = new Set(s.board.map((m) => m.type));
    const type = order.find((t) => !have.has(t)) || pick(order);
    const m = makeMission(s, type, D);
    if (m) s.board.push(m);
  }
}

// ---------------- results ----------------
export const RANKS = [['2nd Lt.', 0], ['1st Lt.', 500], ['Capt.', 1400], ['Maj.', 3000], ['Lt. Col.', 5500]];
export const MEDALS = {
  purple: 'Purple Heart', bronze: 'Bronze Star', silver: 'Silver Star', dsc: 'Distinguished Service Cross', puc: 'Presidential Unit Citation',
};
export const LEVELS = ['Green', 'Regular', 'Veteran', 'Elite'];

// Apply a finished mission to the campaign: effects, points, career. Returns lines for the debrief.
export function missionOutcome(s, mission, r) {
  const out = [];
  const reg = s.regions[mission.region], name = REGIONS[mission.region].name;
  const ok = r.primaryDone;
  const mods = (s.mods[mission.region] && s.mods[mission.region].until > s.day) ? s.mods[mission.region] : (s.mods[mission.region] = { until: s.day + 30 });
  if (ok) {
    if (mission.type === 'raid') {
      const t = s.strategic.find((x) => x.id === mission.strategicId);
      if (t) { t.status = 'destroyed'; t.repairDay = s.day + REPAIR_DAYS; out.push(`The ${STRAT_TYPES[t.type].label.toLowerCase()} at ${name} is out of action for ${REPAIR_DAYS} days.`); }
    }
    if (mission.type === 'recon') {
      mods.recon = true; mods.until = Math.max(mods.until, s.day + 30);
      for (const a of s.assets[mission.region] || []) a.revealed = true;
      out.push('Recon reports in: the next Allied attack on this sector will hit hard.');
    }
    if (mission.type === 'ambush') {
      s.res.axis.sup = Math.max(0, s.res.axis.sup - 25); s.res.axis.mp = Math.max(0, s.res.axis.mp - 10);
      if (reg.owner === 'axis') reg.troops = Math.max(1, reg.troops - 5);
      out.push('The convoy never arrived: the garrison runs short (−5) and German stocks fall.');
    }
    if (mission.type === 'capture') {
      s.intelUntil = s.day + 30; mods.defMult = true; mods.noAttack = true;
      out.push('The documents reveal German attack plans for the next month.');
    }
    if (mission.type === 'rescue') { s.res.allies.mp += 20; out.push(`${r.rescued} airmen brought home: +20 Allied manpower.`); }
  }
  // points
  let pts = ok ? (mission.reward || 100) : 20;
  pts += (r.destroyed.length) * 30 + Math.min(150, r.kills * 3);
  const kia = r.squad.filter((m) => !m.alive && !s.squad[m.idx]?.leader).length;
  if (ok && kia === 0) pts += 40;
  s.points += pts; s.pointsTotal += pts;
  out.push(`+${pts} points (total ${s.points}).`);
  // career
  const car = s.career;
  car.streak = ok ? car.streak + 1 : 0;
  const medals = [];
  if (r.squad.some((m) => !m.alive && s.squad[m.idx]?.leader)) medals.push('purple');
  if (ok && kia === 0) medals.push('bronze');
  if (ok && (r.kills >= 20 || (mission.type === 'capture' && r.alarm))) medals.push('silver');
  if (ok && mission.type === 'raid' && (mission.depthBonus || 0) >= 2) medals.push('dsc');
  if (car.streak === 5) medals.push('puc');
  for (const md of medals) { car.medals.push({ medal: md, day: s.day, region: mission.region }); out.push(`Awarded the ${MEDALS[md]}.`); }
  const oldRank = car.rank;
  car.rank = RANKS.reduce((a, [, need], i) => (s.pointsTotal >= need ? i : a), 0);
  if (car.rank > oldRank) out.push(`Promoted to ${RANKS[car.rank][0]}!`);
  const lead = s.squad.find((m) => m.leader); if (lead) lead.rank = RANKS[car.rank][0];
  // squad experience
  for (const sm of r.squad) {
    const mem = s.squad[sm.idx]; if (!mem || !sm.alive) continue;
    mem.exp = (mem.exp || 0) + 1 + (sm.kills || 0) / 4;
    const lvl = mem.exp >= 12 ? 3 : mem.exp >= 6 ? 2 : mem.exp >= 2 ? 1 : 0;
    if (lvl > (mem.level || 0) && !mem.leader) out.push(`${mem.rank} ${mem.name} is now ${LEVELS[lvl]}.`);
    mem.level = lvl;
  }
  car.log.unshift({ day: s.day, type: mission.type, title: mission.title, region: mission.region, ok, kills: r.kills, kia, pts });
  if (car.log.length > 60) car.log.pop();
  s.board = s.board.filter((m) => m.id !== mission.id);
  refreshBoard(s);
  C.saveCampaign(s);
  return out;
}

// ---------------- quartermaster ----------------
export const SHOP = [
  { key: 'springfield', label: 'M1903A4 Springfield', desc: 'Unlocks the Sniper kit: scoped bolt-action rifle.', cost: 250 },
  { key: 'bazooka', label: 'M1A1 Bazooka', desc: 'Unlocks the Anti-tank kit: rockets wreck trucks, guns and dumps from range.', cost: 300 },
  { key: 'radio', label: 'SCR-300 radio', desc: 'Call two artillery barrages per mission [B].', cost: 220 },
  { key: 'demo', label: 'Extra demolitions', desc: '+2 demolition charges per mission.', cost: 120 },
  { key: 'medkit', label: 'Medical kit', desc: 'Heal yourself and nearby Rangers once per mission [H].', cost: 150 },
  { key: 'veterans', label: 'Veteran replacements', desc: 'New Rangers arrive as Regulars instead of Green.', cost: 200 },
  { key: 'training', label: 'Ranger school', desc: 'Raises the whole squad’s marksmanship and awareness (up to 3 levels).', cost: [150, 260, 400] },
];
export function shopCost(s, item) { return Array.isArray(item.cost) ? item.cost[s.kit.training] : item.cost; }
export function canBuy(s, item) {
  if (item.key === 'training') return s.kit.training < 3 && s.points >= shopCost(s, item);
  return !s.kit[item.key] && s.points >= item.cost;
}
export function buy(s, key) {
  const item = SHOP.find((i) => i.key === key); if (!item || !canBuy(s, item)) return false;
  s.points -= shopCost(s, item);
  if (key === 'training') s.kit.training++; else s.kit[key] = true;
  C.saveCampaign(s);
  return true;
}
// skill used by the squad AI
export function rangerSkill(s, m) { return 0.95 + 0.12 * (m.level || 0) + 0.08 * (s.kit ? s.kit.training : 0); }

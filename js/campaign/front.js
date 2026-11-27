// Real-time front: every TICK_SECONDS of real time the front advances one day.
// Battles are fought out over several days; commanders launch new operations as old ones end.
import { REGIONS, PROVINCES, PROVINCE_SECTORS, TERRAIN_INFO, WEATHER, ASSET_TYPES } from './data.js';
import { getGeo } from './geo.js';
import * as C from './campaign.js';
import { clamp, rand } from '../util.js';
import * as O from './ops.js';

// Real seconds per front update (one game day). Adjustable from the title screen.
export let TICK_SECONDS = 5;
export function setTickSeconds(v) { TICK_SECONDS = Math.max(1, +v || 5); }
export const EFFECT_DAYS = 45;
const LAST_DAY = 56 * 7; // summer 1945

const mods = (s, i) => { const m = s.mods[i]; return m && m.until > s.day ? m : null; };
const busySet = (s) => { const b = new Set(); for (const x of s.battles) { b.add(x.from); b.add(x.to); } return b; };

function launch(s, o, attacker) {
  const b = {
    id: s.nextBattleId++, attacker, from: o.from, to: o.to, sources: o.sources || [[o.from, o.troops]],
    att: o.troops, att0: o.troops, def0: s.regions[o.to].troops, art: o.art || 0, air: o.air || 0,
    day0: s.day, rounds: 0, lossA: 0, lossD: 0, bias: 0,
  };
  // compatibility with mission/briefing code
  b.attTroops = b.att; b.defTroops = b.def0; b.enemyArt = attacker === 'allies' ? (s.regions[o.to].fort >= 2 ? 1 : 0) : (o.art || 0);
  s.battles.push(b);
  const a = REGIONS[b.from].name, t = REGIONS[b.to].name;
  if (attacker === 'allies') C.log(s, `Allied offensive begins: ${a} ➜ ${t} (${b.att} troops).`, 'info', [b.from, b.to]);
  else C.log(s, `German counterattack on ${t} from ${a} (${b.att} troops)!`, 'bad', [b.from, b.to]);
  return b;
}

function round(s, b, sup) {
  const reg = s.regions[b.to];
  const allied = b.attacker === 'allies';
  const tinfo = TERRAIN_INFO[REGIONS[b.to].terrain];
  const mt = mods(s, b.to), mf = mods(s, b.from);
  const airOk = WEATHER[s.weather].air;
  let attSup = 1 + 0.12 * (allied ? b.art : b.enemyArt) + (allied && airOk ? 0.2 * b.air : 0);
  let defSup = 1 + 0.08 * (allied ? (mt && mt.artCut ? 0 : b.enemyArt) : b.art);
  let effFort = Math.max(0, reg.fort - 0.5 * (allied ? b.art : b.enemyArt));
  let bias = b.bias || 0;
  if (allied && mt) { if (mt.defMult) bias += 0.18; if (mt.airFree && airOk) bias += 0.2; if (mt.primary) bias += 0.08; if (mt.recon) bias += 0.25; }
  if (!allied && s.intelUntil > s.day) bias -= 0.15; // forewarned by captured documents
  if (!allied && mf) { if (mf.artCut) attSup = 1; if (mf.defMult) bias -= 0.15; if (mf.noAttack) bias -= 0.3; }
  const attP = b.att * (sup[b.from] || REGIONS[b.from].hq ? 1 : 0.75) * attSup;
  const defP = Math.max(1, reg.troops) * tinfo.def * (1 + 0.12 * effFort) * defSup;
  const r = Math.max(0.05, (attP / defP) * (1 + bias) * rand(0.85, 1.15));
  const k = 0.16;
  const aL = Math.min(b.att, Math.round(b.att * k / Math.pow(r, 0.8) * rand(0.7, 1.3)));
  const dL = Math.min(reg.troops, Math.round(reg.troops * k * Math.pow(r, 0.8) * rand(0.7, 1.3)));
  b.att -= aL; reg.troops -= dL; b.lossA += aL; b.lossD += dL; b.rounds++;
  b.ratio = r;
  if (allied) { s.stats.alliedLosses += aL; s.stats.axisLosses += dL; } else { s.stats.alliedLosses += dL; s.stats.axisLosses += aL; }
  if (b.forced) return b.forced === b.attacker;
  if (reg.troops <= Math.max(1, b.def0 * 0.3) && r > 0.85) return true;
  if (b.att <= Math.max(2, b.att0 * 0.45)) return false;
  if (b.rounds >= 9) return r > 1;
  return null; // still fighting
}

function finish(s, b, attackerWon) {
  const g = getGeo();
  const reg = s.regions[b.to];
  const att = b.attacker, def = att === 'allies' ? 'axis' : 'allies';
  const name = REGIONS[b.to].name;
  if (attackerWon) {
    const retreat = g.adj[b.to].filter((j) => s.regions[j].owner === def && !REGIONS[j].hq).sort((x, y) => s.regions[x].troops - s.regions[y].troops);
    if (retreat.length && reg.troops > 0) s.regions[retreat[0]].troops = Math.min(C.MAX_TROOPS, s.regions[retreat[0]].troops + reg.troops);
    reg.owner = att; reg.troops = Math.max(1, b.att); reg.fort = Math.max(0, reg.fort - 1);
    const sc = [b.to, b.from];
    if (att === 'allies') { s.stats.won++; C.log(s, `VICTORY: Allied troops take ${name} (${b.lossA} lost, ${b.lossD} enemy casualties).`, 'good', sc); }
    else { s.stats.lost++; C.log(s, `${name} has fallen to the German counterattack.`, 'bad', sc); }
    C.onSectorChange(s, b.to, att);
    if (att === 'allies') C.onAlliedCapture(s, b.to);
    delete s.assets[b.to];
  } else {
    const srcs = b.sources.filter(([i]) => s.regions[i].owner === att);
    const tot = srcs.reduce((a, [, n]) => a + n, 0) || 1;
    for (const [i, n] of srcs) s.regions[i].troops = Math.min(C.MAX_TROOPS, s.regions[i].troops + Math.round(b.att * n / tot));
    if (att === 'allies') { s.stats.lost++; C.log(s, `The Allied assault on ${name} has been thrown back (${b.lossA} casualties).`, 'bad', [b.to, b.from]); }
    else { s.stats.won++; C.log(s, `The German attack on ${name} has been beaten off.`, 'good', [b.to, b.from]); }
  }
  b.over = true; b.won = attackerWon;
}

function weekly(s) {
  const sup = C.computeSupply(s);
  REGIONS.forEach((r, i) => {
    const reg = s.regions[i]; reg.lockedIn = 0;
    if (!sup[i] && !r.hq && reg.troops > 3) {
      const l = Math.ceil(reg.troops * 0.1); reg.troops -= l;
      if (reg.owner === 'allies') C.log(s, `${r.name} is cut off from supply and loses ${l} troops.`, 'bad', i);
    }
  });
  // whole provinces cut off are news for everyone
  PROVINCES.forEach((P, p) => {
    const mine = PROVINCE_SECTORS[p].filter((j) => s.regions[j].owner === 'allies');
    if (!P.hq && mine.length >= 2 && mine.every((j) => !sup[j])) C.log(s, `Allied forces in ${P.name} are cut off from supply.`, 'bad');
  });
  let val = 0, ports = 0;
  REGIONS.forEach((r, i) => { if (s.regions[i].owner === 'allies' && sup[i]) { val += r.value; if (r.port) ports++; } });
  const mpInc = 34 + Math.round(val * 0.75), supInc = Math.round(32 + ports * 6 + val);
  s.res.allies.mp += mpInc; s.res.allies.sup += supInc;
  // the German war economy: factories produce, rail yards deliver
  const eco = s.strategic ? O.economy(s) : { factory: 1, railyard: 1, fuelplant: 1 };
  const mp0 = s.res.axis.mp;
  C.axisReinforce(s);
  const gained = s.res.axis.mp - mp0;
  if (s.strategic) s.res.axis.mp = Math.max(0, Math.round(mp0 + gained * (0.45 + 0.55 * eco.factory)));
  s.ecoRail = eco.railyard; s.ecoFuel = eco.fuelplant;
  s.weather = C.rollWeather(s);
  C.randomEvent(s);
  C.replenishSquad(s);
  C.refreshAssets(s);
  C.log(s, `New week: +${mpInc} Allied manpower, +${supInc} supplies. Weather: ${WEATHER[s.weather].label}.`, 'info');
}

// Advance the front by one day. Returns the log entries produced.
export function frontTick(s) {
  if (s.phase === 'over') return [];
  s.events = [];
  s.day++;
  s.turn = Math.floor(s.day / 7) + 1;
  if (s.day % 7 === 0) weekly(s);
  // scripted winter offensive
  const date = C.currentDate(s);
  if (!s.flags.winterDone && date >= new Date(Date.UTC(1944, 11, 12))) {
    const ard = getGeo().idx.ard;
    s.flags.winterDone = true; s.flags.winterUntil = s.day + 7;
    const front = C.distanceToFront(s, 'axis');
    REGIONS.forEach((r, i) => {
      if (s.regions[i].owner === 'axis' && front[i] <= 1 && Math.hypot(r.x - REGIONS[ard].x, r.y - REGIONS[ard].y) < 260) s.regions[i].troops = Math.min(C.MAX_TROOPS, s.regions[i].troops + 14);
    });
    C.log(s, 'WINTER COUNTEROFFENSIVE! German armored reserves strike the Allied lines.', 'bad');
  }
  s.flags.winterNow = s.flags.winterUntil > s.day;
  if (s.strategic) O.opsDaily(s);
  // fight a day of every battle
  const sup = C.computeSupply(s);
  for (const b of s.battles) {
    if (s.regions[b.to].owner === b.attacker) { finish(s, b, true); continue; }
    const res = round(s, b, sup);
    if (res !== null) finish(s, b, res);
  }
  s.battles = s.battles.filter((b) => !b.over);
  if (s.phase !== 'over') {
    // commanders launch new operations
    s.orders = [];
    C.alliedAI(s);
    for (const o of s.orders) launch(s, o, 'allies');
    s.orders = [];
    const axisOngoing = s.battles.filter((b) => b.attacker === 'axis').length;
    const fuel = s.ecoFuel ?? 1;
    if (axisOngoing < (s.flags.winterNow ? 10 : 5) && Math.random() < (s.flags.winterNow ? 0.9 : 0.5) * (0.35 + 0.65 * fuel)) {
      for (const o of C.axisPlanAttacks(s, busySet(s), s.flags.winterNow ? 3 : 1)) launch(s, o, 'axis');
    }
  }
  // victory / defeat
  const alliedCont = REGIONS.filter((r, i) => !r.hq && s.regions[i].owner === 'allies').length;
  const axisCount = REGIONS.filter((r, i) => s.regions[i].owner === 'axis').length;
  if (s.phase !== 'over') {
    if (axisCount <= 8) { s.result = 'victory'; s.phase = 'over'; C.log(s, 'Germany surrenders unconditionally!', 'good'); }
    else if (s.day > 28 && alliedCont === 0 && s.regions[getGeo().idx.eng].troops + s.res.allies.mp < 60) { s.result = 'defeat'; s.phase = 'over'; C.log(s, 'The Allies have been driven back into the sea.', 'bad'); }
    else if (s.day > LAST_DAY) { s.result = 'stalemate'; s.phase = 'over'; C.log(s, 'The war drags on into the summer of 1945. Command has relieved you.', 'bad'); }
  }
  const ev = s.events; s.events = null;
  C.saveCampaign(s);
  return ev;
}

// Start of the campaign: the invasion is launched at once.
export function startFront(s) {
  s.day = 0; s.battles = []; s.nextBattleId = 1; s.mods = {};
  s.orders = [];
  C.alliedAI(s);
  for (const o of s.orders) launch(s, o, 'allies');
  s.orders = [];
  C.saveCampaign(s);
}

// A Ranger destroyed an asset: the effect hits the war effort immediately.
export function assetDestroyed(s, region, id, primary) {
  const list = s.assets[region] || [];
  const k = list.findIndex((a) => a.id === id);
  const reg = s.regions[region];
  const a = k >= 0 ? list.splice(k, 1)[0] : null;
  if (!a) {
    // the sector already changed hands while the squad was inside: still counts for the record
    s.stats.assets++;
    C.log(s, `Rangers destroyed an enemy asset at ${REGIONS[region].name} as the sector fell.`, 'good');
    C.saveCampaign(s);
    return null;
  }
  const m = s.mods[region] && s.mods[region].until > s.day ? s.mods[region] : (s.mods[region] = {});
  m.until = s.day + EFFECT_DAYS;
  s.stats.assets++;
  let txt = '';
  if (a.type === 'artillery') { m.artCut = true; reg.fort = Math.max(0, reg.fort - 1); txt = 'artillery support eliminated, fortifications reduced'; }
  if (a.type === 'flak') { m.airFree = true; txt = 'the skies are open to Allied air power'; }
  if (a.type === 'fuel') { m.noAttack = true; s.res.axis.sup = Math.max(0, s.res.axis.sup - 15); txt = 'German units here are out of fuel'; }
  if (a.type === 'ammo') { if (reg.owner === 'axis') reg.troops = Math.max(1, reg.troops - 8); txt = 'the garrison is short of ammunition'; }
  if (a.type === 'radio') { m.defMult = true; m.noAttack = true; txt = 'German command in the sector is decapitated'; }
  if (a.type === 'trucks') { s.res.axis.mp = Math.max(0, s.res.axis.mp - 10); s.res.axis.sup = Math.max(0, s.res.axis.sup - 10); txt = 'German logistics disrupted'; }
  if (a.type === 'tank') { if (reg.owner === 'axis') reg.troops = Math.max(1, reg.troops - 10); txt = 'armored reserves destroyed'; }
  if (primary) m.primary = true;
  C.log(s, `Rangers destroyed the ${ASSET_TYPES[a.type].label.toLowerCase()} at ${REGIONS[region].name}${primary ? ' (primary objective)' : ''}: ${txt}.`, 'good');
  C.saveCampaign(s);
  return txt;
}

// Live link from the battle in the Rangers' sector to its strategic battle.
export function setFrontState(s, battleId, bias, winner) {
  const b = s.battles.find((x) => x.id === battleId);
  if (!b) return;
  b.bias = b.attacker === 'allies' ? bias : -bias;
  if (winner) b.forced = winner; // the side that won the fight the Rangers witnessed
}

// After extraction (or loss) of the squad.
export function finishMission(s, m) {
  const effects = [];
  const r = m.region, reg = s.regions[r];
  s.stats.missions++;
  if (m.primaryDone) { s.stats.missionsWon++; s.res.allies.mp += 8; effects.push('Primary objective complete: Allied morale rises (+8 manpower).'); }
  if (m.kills) {
    s.stats.kills += m.kills;
    if (reg.owner === 'axis') { const l = Math.min(reg.troops - 1, Math.round(m.kills * 0.4)); reg.troops -= l; if (l > 0) effects.push(`${m.kills} enemy soldiers killed (−${l} garrison strength).`); }
  }
  for (const sm of m.squad) {
    const mem = s.squad[sm.idx]; if (!mem) continue;
    mem.kills += sm.kills || 0;
    if (!sm.alive) {
      if (mem.leader) { mem.status = 'wia'; effects.push('You were wounded and evacuated; you rejoin the squad next week.'); }
      else { mem.status = 'kia'; C.log(s, `${mem.rank} ${mem.name} was killed in action at ${REGIONS[r].name}.`, 'bad'); }
    } else mem.missions++;
  }
  C.saveCampaign(s);
  return effects;
}

export function battleProgress(s, b) {
  const reg = s.regions[b.to];
  return { att: clamp(b.att / Math.max(1, b.att0), 0, 1), def: clamp(reg.troops / Math.max(1, b.def0), 0, 1), days: s.day - b.day0 };
}

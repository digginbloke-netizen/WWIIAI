// Ranger operation in a full-size sector. AI groups on both sides pursue their own hidden
// objectives; the squad pursues the mission from the board. Everything feeds the war effort.
import * as THREE from 'three';
import { Battle } from './battle.js';
import { Bot } from './soldier.js';
import { HALF } from './world.js';
import { ASSET_TYPES } from '../campaign/data.js';
import { audio } from '../audio.js';
import { clamp } from '../util.js';
import * as M from './models.js';
import { DIRECTOR } from './director.js';

const MIX = ['rifleman', 'rifleman', 'assault', 'rifleman', 'support', 'assault'];
const SLOTS = [[-2.6, 3.2], [2.6, 3.2], [-4.2, 6.5], [4.2, 6.5], [0, 8], [-5, 9], [5, 9], [0, 11]];
const FAR = 380; // beyond this, AI runs at a reduced rate and isn't drawn

export const SUB_LABEL = { hall: 'Factory hall', boiler: 'Boiler house', generator: 'Generator station', loco: 'Locomotive', signal: 'Signal tower', storage: 'Fuel storage tank', pump: 'Pump house' };
const assetLabel = (a) => (a.sub ? SUB_LABEL[a.type] : ASSET_TYPES[a.type].label);

export class Mission extends Battle {
  constructor(cfg, container, hudRoot, callbacks) {
    cfg.alliedTroops = 20; cfg.axisTroops = 20; cfg.attacker = 'allies';
    super(cfg, container, hudRoot, callbacks);
  }

  // ---------- forces ----------
  _setupForces() {
    const cfg = this.cfg, w = this.world, M2 = cfg.mission;
    this.isMission = true;
    this.type = M2.type;
    this.timeLimit = 50 * 60;
    this.stealth = true; this.alarm = false; this.alarmPos = null;
    this.qrfT = Infinity; this.destroyed = []; this.charges = []; this.fires = []; this.rockets = [];
    this.garrisonDead = 0; this.extractConfirm = 0; this.squadHold = false;
    this.msquads = []; this.aiObjectives = []; this.vehicles = [];
    this.frontActive = false;
    this.tickets = { allies: 1, axis: 1 }; this.tickets0 = { allies: 1, axis: 1 };
    this.combatants = [this.player];
    this.followIdx = w.addDynamicTarget(w.insert.x, w.insert.z);
    this.huntIdx = w.addDynamicTarget(w.insert.x, w.insert.z - 60);
    this.kit = cfg.kit || {};
    this.support = { art: this.kit.radio ? 2 : 0, air: 0 };

    // --- German garrison: every strongpoint, asset and site is held ---
    const strength = clamp(cfg.garrison / 40, 0.6, 1.6);
    const gsize = (base) => Math.max(2, Math.round(base * strength));
    let k = 0;
    const DEF = w.sites.defend;
    for (const s of w.strongpoints) {
      if (DEF && s.z > DEF.z - 110) continue; // our side of the sector in a defense mission
      if (s.kind === 'bunker') continue; // crewed below
      const n = gsize({ town: 9, hamlet: 4, complex: 7, hq: 4, pow: 4, line: 6 }[s.kind] || 4);
      const sq = this._squad('axis', { role: 'guard', obj: s.nav.idx });
      for (let i = 0; i < n; i++) this._bot('axis', MIX[k++ % 6], sq, s.x, s.z, s.r);
      if (s.kind === 'town' || s.kind === 'complex' || s.kind === 'line') this.aiObjectives.push({ team: 'allies', target: s, label: 'position', held: 0, done: false });
    }
    // bunker crews: an MG team at the slit of every bunker, and they stay there
    for (const B of w.buildings) {
      if (!B.bunker || !B.ok || (DEF && B.cz > DEF.z - 110)) continue;
      const spB = w.strongpoints.find((q) => q.bld === B.idx);
      const n = cfg.landing && B.bluff ? 3 : 2;
      const sq = this._squad('axis', { role: 'garrison', bld: B.idx, face: { x: B.cx, z: B.cz + B.face * 100 }, fixed: true, full: n, obj: spB && spB.nav ? spB.nav.idx : 0 });
      for (let i = 0; i < n; i++) { const b = this._bot('axis', i === 1 ? 'rifleman' : 'support', sq, B.doors[0].d.x, B.doors[0].d.z, 0.6); b.alert = !!cfg.landing; }
      B.crew = sq;
    }
    for (const a of w.assets) {
      if (a.sub || a.allied) continue;
      const sq = this._squad('axis', { role: 'guard', obj: a.nav.idx });
      for (let i = 0; i < gsize(a.primary ? 4 : 3); i++) this._bot('axis', MIX[k++ % 6], sq, a.x, a.z, a.r + 6);
    }
    const nPatrol = Math.round(3 + strength * 2);
    for (let i = 0; i < nPatrol; i++) {
      const route = [...w.wpAxis].sort(() => Math.random() - 0.5).slice(0, 4).map((p) => p.idx);
      const sq = this._squad('axis', { role: 'patrol', route, leg: 1 });
      const t = w.targets[route[0]];
      for (let j = 0; j < 3; j++) this._bot('axis', MIX[k++ % 6], sq, t.x, t.z, 5);
    }
    this.reserve = Math.round(8 * strength);
    // officer for capture missions
    if (w.sites.hq) {
      const sq = this.msquads.find((q) => q.role === 'guard' && w.targets[q.obj] === w.sites.hq.nav) || this._squad('axis', { role: 'guard', obj: w.sites.hq.nav.idx });
      const o = this._bot('axis', 'assault', sq, w.sites.hq.x + 6, w.sites.hq.z, 3);
      o.officer = true; o.name = 'Oberst von Reiche'; o.health = 80;
      const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0xffd04a, depthTest: false, transparent: true, opacity: 0.9 }));
      mk.position.y = 2.3; mk.renderOrder = 11; o.model.add(mk); o.officerMark = mk;
      this.officer = o;
    }
    // prisoners for rescue missions
    this.pows = [];
    if (w.sites.pow) {
      const sq = this._squad('allies', { role: 'captive' });
      for (let i = 0; i < 3; i++) {
        const b = this._bot('allies', 'rifleman', sq, w.sites.pow.x, w.sites.pow.z, 5);
        b.name = ['Lt. Hollis (USAAF)', 'Sgt. Brandt (USAAF)', 'Pvt. Odell'][i];
        b.parts.arms.visible = false; b.health = 60;
        this.pows.push(b);
      }
    }
    // convoy for ambush missions
    if (w.sites.convoy) this._convoy(w.sites.convoy);
    // defense: an Allied platoon holds the position; German assault waves are on their way
    if (DEF) {
      const dc = cfg.defense || { attackers: 40, defenders: 20 };
      const sq = this._squad('allies', { role: 'guard', obj: DEF.nav.idx });
      const nd = clamp(Math.round(dc.defenders * 0.7), 10, 18);
      for (let i = 0; i < nd; i++) { const b = this._bot('allies', MIX[i % 6], sq, DEF.x, DEF.z, DEF.r * 0.6); b.alert = true; }
      // MG nests: a gun team in each, and they stay at their gun
      for (const n of DEF.nests || []) {
        const nq = this._squad('allies', { role: 'guard', obj: n.nav.idx, fixed: true });
        for (let i = 0; i < 2; i++) { const b = this._bot('allies', i ? 'rifleman' : 'support', nq, n.x, n.z + 1, 1); b.alert = true; }
        n.crew = nq;
      }
      // a small guard on the ammunition dump
      if (DEF.dump) {
        DEF.dump.nav.holdPts = [0, 1, 2, 3].map((k) => ({ x: DEF.dump.x + Math.sin(k * 1.57) * (DEF.dump.r + 3.5), z: DEF.dump.z + Math.cos(k * 1.57) * (DEF.dump.r + 3.5) }));
        const gq = this._squad('allies', { role: 'guard', obj: DEF.dump.nav.idx, fixed: true });
        for (let i = 0; i < 4; i++) { const b = this._bot('allies', MIX[i], gq, DEF.dump.x, DEF.dump.z + 4, 4); b.alert = true; }
        this.def0 = { main: sq };
      }
      this.def0 = { ...(this.def0 || {}), main: sq };
      this.stealth = false; this.reserve = 0;
      const waves = clamp(Math.round(dc.attackers / 8), 4, 7);
      this.def = { site: DEF, n: waves, size: clamp(Math.round(8 + dc.attackers / 6), 10, 16), sent: 0, next: 75, squads: [], won: false, lost: false, lastWaveT: 0, sapT: 0 };
      this.def.obj = { team: 'axis', target: DEF, label: 'overrun', held: 0, done: false, w: 0.3 };
      this.aiObjectives.push(this.def.obj);
    }

    // --- hidden AI objectives: what the armies in this sector are trying to do ---
    const front = cfg.front;
    this.frontInfo = front;
    if (cfg.depth === 0) {
      // friendly patrol near the Allied side
      const fr = w.wpAllies.map((p) => p.idx).sort(() => Math.random() - 0.5);
      const sq = this._squad('allies', { role: 'fpatrol', route: fr, leg: 1 });
      for (let j = 0; j < 4; j++) this._bot('allies', MIX[j], sq, w.targets[fr[0]].x, w.targets[fr[0]].z, 4);
    }
    if (front && front.attacker === 'allies' && !cfg.landing) {
      // Allied assault platoons go for the nearest German positions
      const targets = w.strongpoints.slice().sort((a, b) => b.z - a.z).slice(0, 2);
      targets.forEach((t, i) => {
        const sq = this._squad('allies', { role: 'assault', obj: t.nav.idx });
        const sx = clamp(t.x + (Math.random() - 0.5) * 200, -HALF + 40, HALF - 40);
        for (let j = 0; j < 8; j++) { const b = this._bot('allies', MIX[j % 6], sq, sx, HALF - 30, 8); b.yaw = Math.PI; }
        this.aiObjectives.push({ team: 'allies', target: t, label: 'assault', held: 0, done: false, squad: sq });
      });
    }
    if (front && front.attacker === 'axis') {
      // German counterattack heading for the Allied side of the sector
      const goal = w.wpAllies[0];
      const sq = this._squad('axis', { role: 'assault', obj: goal.idx });
      for (let j = 0; j < 10; j++) this._bot('axis', MIX[j % 6], sq, goal.x + (Math.random() - 0.5) * 160, -HALF + 40, 10);
      sq.members.forEach((b) => (b.alert = true));
      this.aiObjectives.push({ team: 'axis', target: goal, label: 'counterattack', held: 0, done: false, squad: sq });
    }

    // --- the Ranger squad ---
    this.roster = cfg.squad.map((m) => ({ ...m, alive: true, kills: 0 }));
    this.controlIdx = Math.max(0, this.roster.findIndex((m) => m.leader));
    this.rangerSquad = this._squad('allies', { role: 'follow' });
    this.rangers = [];
    let slot = 0;
    this.roster.forEach((m, i) => {
      if (i === this.controlIdx) return;
      const b = new Bot(this, 'allies', m.cls === 'sniper' || m.cls === 'bazooka' ? 'rifleman' : m.cls);
      b.name = `${m.rank} ${m.name}`; b.rosterIdx = i; b.skill = m.skill || 1.1; b.slot = SLOTS[slot++ % SLOTS.length];
      b.squadRef = this.rangerSquad; this.rangerSquad.members.push(b);
      this.bots.push(b); this.rangers.push(b);
    });
    const me = this.roster[this.controlIdx];
    this.player.name = me ? `${me.rank} ${me.name === 'You' ? '(You)' : me.name}` : 'You';
    this.combatants = [...this.bots, this.player];
    this.charges0 = 3 + (this.kit.demo ? 2 : 0);
    this.medkits = this.kit.medkit ? 1 : 0;
    this._dirInit();

    // --- artillery: batteries with their own fire missions ---
    this.batteries = [];
    const gAsset = w.assets.find((a) => a.type === 'artillery' && !a.sub && !a.allied);
    if (gAsset) this.batteries.push({ team: 'axis', x: gAsset.x, z: gAsset.z, asset: gAsset, onMap: true });
    else if (!cfg.artCut && (cfg.front || cfg.depth === 0 || cfg.fort >= 2)) this.batteries.push({ team: 'axis', x: (Math.random() - 0.5) * 600, z: -HALF - 380, onMap: false });
    if (cfg.front && cfg.front.attacker === 'allies') this.batteries.push({ team: 'allies', x: (Math.random() - 0.5) * 600, z: HALF + 520, onMap: false });
    for (const bt of this.batteries) { bt.cd = 35 + Math.random() * 45; bt.fired = 0; bt.alive = true; }
    this.incomingT = -99;
    if (cfg.landing) this._landingSetup();
  }

  // ---------- the landing ----------
  // Landing craft run in to the beach with the Rangers and the first assault wave; the ramps drop
  // in the shallows and everyone has one job: get off the beach and knock out the bunkers.
  _landingSetup() {
    const w = this.world;
    this.stealth = false; this.alarm = true; this.reserve = Math.round(this.reserve * 0.5);
    for (const b of this.bots) if (b.team === 'axis') b.alert = true;
    this.dir.pool.allies = 0; // reinforcements come in by boat
    const bunkers = w.bluffBunkers || [];
    const L = this.landing = { boats: [], t: 0, released: false, waves: 0, nextWave: 100, won: false, splashT: 1, bunkers, need: Math.min(4, bunkers.length), msg: 0 };
    L.crestZ = bunkers.length ? bunkers.reduce((a, B) => a + B.cz, 0) / bunkers.length + 8 : w.insert.z - 60;
    for (const B of bunkers) {
      const sp = w.strongpoints.find((q) => q.bld === B.idx);
      B.sp = sp;
      if (sp) this.aiObjectives.push({ team: 'allies', target: sp, label: 'assault', held: 0, done: false, w: 0.05 });
    }
    const x0 = w.insert.x;
    for (const o of [-150, -100, -50, 0, 50, 100, 150]) {
      const x = clamp(x0 + o + (Math.random() - 0.5) * 10, -HALF + 20, HALF - 20);
      const boat = this._boat(x, HALF - 8 - Math.random() * 6);
      if (o === 0) { L.mine = boat; boat.zStop = 401; boat.speed = 4.2; for (let i = 0; i < 6; i++) this._boatRider(boat, 8 + i); continue; }
      for (let i = 0; i < 7; i++) this._boatRider(boat, i);
    }
    this.combatants = [...this.bots, this.player];
  }
  _bunkerTarget(x) {
    const L = this.landing, open = L.bunkers.filter((B) => !B.cleared && B.sp && B.sp.nav);
    const list = open.length ? open : L.bunkers.filter((B) => B.sp && B.sp.nav);
    if (!list.length) return 0;
    return list.slice().sort((a, b) => Math.abs(a.cx - x) - Math.abs(b.cx - x))[0].sp.nav.idx;
  }
  // a GI of the boat's assault section, crouched at his place in the boat
  _boatRider(boat, seat) {
    if (!boat.sq) boat.sq = this._squad('allies', { role: 'assault', obj: this._bunkerTarget(boat.x) });
    const b = this._bot('allies', MIX[seat % 6], boat.sq, boat.x, boat.z - 30, 3);
    b.carrier = boat; b._seat = seat; b.alert = true; b.yaw = Math.PI;
    boat.riders.push(b);
    return b;
  }
  _boat(x, z) {
    const g = new THREE.Group();
    const hullM = new THREE.MeshLambertMaterial({ color: 0x75797b }), darkM = new THREE.MeshLambertMaterial({ color: 0x5d6164 }), deckM = new THREE.MeshLambertMaterial({ color: 0x4b4b48 }); // navy grey
    const box = (w, h, d, x, y, z, m) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; g.add(me); return me; };
    box(3.3, 1.1, 11, 0, -0.56, 0, hullM);                 // hull below the deck
    box(3.0, 0.04, 10.6, 0, 0.0, 0.1, deckM);              // deck
    for (const sx of [-1, 1]) box(0.16, 1.6, 10.7, sx * 1.57, 0.8, 0.15, hullM); // sides
    box(3.3, 1.75, 0.2, 0, 0.87, 5.4, hullM);              // stern
    box(1.0, 2.1, 1.0, 1.0, 1.05, 4.75, darkM);            // coxswain's station
    for (const sx of [-1, 1]) box(0.3, 1.6, 0.35, sx * 1.45, 0.8, -5.35, darkM); // bow frame
    const ramp = new THREE.Group(); ramp.position.set(0, 0, -5.5); g.add(ramp);
    const rp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.75, 0.14), darkM); rp.position.set(0, 0.87, -0.07); rp.castShadow = true; ramp.add(rp);
    for (let k = 0; k < 4; k++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.06), hullM); rib.position.set(0, 0.25 + k * 0.42, -0.16); ramp.add(rib); }
    this.scene.add(g);
    const boat = { x, z, y: -0.05, zStop: 399 + Math.random() * 6, speed: 3.9 + Math.random() * 0.5, mesh: g, ramp, t: Math.random() * 6, riders: [], yaw: Math.PI, duck: true, state: 'approach' };
    boat.seat = (who) => { const k = who._seat || 0; return { x: boat.x + (k % 2 ? 0.68 : -0.68), y: boat.y + 0.02, z: boat.z - 4.0 + Math.floor(k / 2) * 1.05 }; };
    this.landing.boats.push(boat);
    return boat;
  }
  _splash(x, z) {
    for (let i = 0; i < 26; i++) this.effects.smoke.spawn(x + (Math.random() - 0.5) * 2, -0.2, z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2.5, 7 + Math.random() * 9, (Math.random() - 0.5) * 2.5, 1.4 + Math.random() * 1.2, 0.9 + Math.random() * 1.2, 0.86, 0.9, 0.94, 0.75, 9, 1.4, 0.4);
    const c = this.camera.position, d = Math.hypot(x - c.x, z - c.z);
    audio.explosion(d * 0.8 + 8, 0, d < 60);
  }
  _unload(bt) {
    bt.released = true; bt.duck = false;
    for (const r of bt.riders) { if (r.carrier === bt) { r.carrier = null; } }
    if (this.player.carrier === bt) {
      this.player.carrier = null;
      this.landing.released = true;
      this.hud.message('RAMP DOWN! GO! GO! GO!<br><small>Get off the beach and knock out the bunkers on the bluff</small>', 4);
      const r = this.rangers.find((x) => x.alive); if (r) this.chatter.say(r, 'attack', { force: true });
    }
  }
  _landing(dt) {
    const L = this.landing; if (!L) return;
    L.t += dt;
    const mine = L.mine;
    for (const bt of L.boats) {
      bt.t += dt;
      if (bt.state === 'approach') {
        bt.z = Math.max(bt.zStop, bt.z - bt.speed * dt);
        if (bt.z <= bt.zStop + 0.01) { bt.state = 'ramp'; bt.rampT = 0; }
      } else if (bt.state === 'ramp') {
        bt.rampT += dt;
        bt.ramp.rotation.x = -1.4 * Math.min(1, bt.rampT / 1.1) ** 2;
        if (bt.rampT > 1.0 && !bt.released) this._unload(bt);
        if (bt.rampT > 10) bt.state = 'leave';
      } else if (bt.state === 'leave') {
        bt.ramp.rotation.x = Math.min(0, bt.ramp.rotation.x + dt * 0.5);
        bt.z += 2.8 * dt; bt.leaveT = (bt.leaveT || 0) + dt;
        if (bt.leaveT > 30) { this.scene.remove(bt.mesh); bt.gone = true; }
      }
      const calm = bt.state === 'approach' ? 1 : 0.4;
      bt.y = -0.05 + Math.sin(bt.t * 1.4) * 0.07 * calm; // deck stays above the waterline (-0.25)
      bt.mesh.position.set(bt.x, bt.y, bt.z);
      bt.mesh.rotation.x = Math.sin(bt.t * 1.1) * 0.022 * calm; bt.mesh.rotation.z = Math.sin(bt.t * 0.9 + 1) * 0.03 * calm;
    }
    L.boats = L.boats.filter((b) => !b.gone);
    // the run in: shell splashes among the boats, the coxswain's calls
    if (!L.released && mine) {
      const eta = (mine.z - mine.zStop) / mine.speed;
      if (L.msg === 0 && L.t > 1.5) { L.msg = 1; this.hud.message(`H-HOUR · ${this.cfg.region}<br><small>Keep your head down until the ramp drops</small>`, 5); }
      if (L.msg === 1 && eta < 12) { L.msg = 2; this.hud.message('Thirty seconds!', 2.5); }
      if (L.msg === 2 && eta < 3) { L.msg = 3; this.hud.message('Stand by the ramp!', 2); }
    }
    L.splashT -= dt;
    if (L.splashT <= 0 && L.t < 240) {
      L.splashT = L.released ? 2 + Math.random() * 3 : 0.7 + Math.random() * 1.1;
      const ref = L.boats.length ? L.boats[Math.floor(Math.random() * L.boats.length)] : mine;
      if (ref) { const x = ref.x + (Math.random() - 0.5) * 50, z = Math.max(398, ref.z + (Math.random() - 0.5) * 50); if (Math.hypot(x - ref.x, z - ref.z) > 9) this._splash(x, z); }
    }
    // follow-up waves keep coming until the bluff is taken
    if (L.released && !L.won && L.waves < 4) {
      L.nextWave -= dt;
      if (L.nextWave <= 0) {
        L.nextWave = 90 + Math.random() * 30; L.waves++;
        for (let k = 0; k < 2; k++) {
          const x = clamp(this.world.insert.x + (Math.random() - 0.5) * 360, -HALF + 20, HALF - 20);
          const bt = this._boat(x, HALF - 8);
          for (let i = 0; i < 8; i++) this._boatRider(bt, i);
        }
        this.combatants = [...this.bots, this.player];
        if (this.cb.onNews) this.cb.onNews('More landing craft are coming in to the beach', 'good');
      }
    }
    // the bunkers on the bluff
    L.checkT = (L.checkT || 0) - dt;
    if (L.checkT <= 0 && L.released) {
      L.checkT = 1;
      const W = this.world;
      for (const B of L.bunkers) {
        if (B.cleared) continue;
        const crew = B.crew ? B.crew.members.some((b) => b.alive) : false;
        const inside = this.bots.some((b) => b.alive && b.team === 'axis' && W.bldAt(b.pos.x, b.pos.z) === B.idx);
        if (!crew && !inside) {
          B.cleared = true;
          if (B.sp) B.sp.owner = 'allies';
          const n = L.bunkers.filter((q) => q.cleared).length;
          this.hud.news(`Bunker on the bluff knocked out (${n}/${L.need})`, 'good');
          for (const sq of this.msquads) if (sq.team === 'allies' && sq.role === 'assault' && B.sp && sq.obj === B.sp.nav.idx) sq.obj = this._bunkerTarget(B.cx);
        }
      }
      const P = [this.player, ...this.rangers].filter((r) => r.alive);
      if (!L.offBeach && P.some((r) => r.pos.z < L.crestZ)) { L.offBeach = true; this.hud.message('Off the beach! Keep pushing!', 2); }
      if (!L.won && L.bunkers.filter((q) => q.cleared).length >= L.need) {
        L.won = true;
        this.hud.message('★ THE BEACH IS BREACHED!<br><small>The follow-up waves are pouring through the gap.</small>', 5);
        if (this.cb.onNews) this.cb.onNews('The German beach defences have been breached', 'good');
        setTimeout(() => { if (!this.over) { this.extracted = true; this.finish(true, 'The bunkers on the bluff are silenced and the landing force is moving inland. The beachhead is secure.'); } }, 10000);
      }
    }
  }

  // ---------- artillery ----------
  _artillery(dt) {
    for (const bt of this.batteries) {
      if (bt.asset && !bt.asset.alive) { if (bt.alive) this.hud.news('The German battery in the sector has been silenced', 'good'); bt.alive = false; }
      if (!bt.alive) continue;
      bt.cd -= dt;
      if (bt.cd > 0) continue;
      const m = bt.team === 'axis' ? this._germanFireMission(bt) : this._alliedFireMission(bt);
      bt.cd = m ? (65 + Math.random() * 55) * (this._observer(bt.team) ? 0.6 : 1) : 12;
      if (m) this._fire(bt, m);
    }
    // warning when rounds are about to land near you
    const p = this.player;
    if (p.alive && this.time - this.incomingT > 12 && this.shells.some((s) => !s.byPlayer && s.t < 2.5 && Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < 55)) {
      this.incomingT = this.time; this.hud.message('⚠ INCOMING!', 1.5);
      const r = this.rangers.find((x) => x.alive); if (r) this.chatter.say(r, 'incoming', { force: true });
    }
  }
  _centroid(list) { let x = 0, z = 0; for (const b of list) { x += b.pos.x; z += b.pos.z; } return { x: x / list.length, z: z / list.length }; }
  // Groups of enemy soldiers that somebody on `team`'s side can see (or their forward observer),
  // scored for a fire mission. The Rangers are just another group. Nothing is fired within 45 m of
  // the team's own men, and groups attacking one of the team's positions come first.
  _fireTargets(team) {
    const enemy = team === 'axis' ? 'allies' : 'axis', key = team === 'axis' ? 'seenByAxisT' : 'seenByAlliesT';
    const fo = this._observer(team), foP = fo && fo.sq.members.find((x) => x.alive);
    const cells = new Map();
    for (const c of this.combatants) {
      if (!c.alive || c.team !== enemy || c.role === 'captive' || c.carrier || c.hidden) continue;
      const seen = this.time - (c[key] || -99) < 12 || (foP && Math.hypot(c.pos.x - foP.pos.x, c.pos.z - foP.pos.z) < 230);
      if (!seen) continue;
      const k = Math.round(c.pos.x / 35) * 10000 + Math.round(c.pos.z / 35);
      (cells.get(k) || cells.set(k, []).get(k)).push(c);
    }
    const w = this.world, posts = [...w.strongpoints.filter((p) => p.owner === team || (team === 'axis' && p.owner === undefined)), ...(team === 'allies' && w.sites.defend ? [w.sites.defend] : [])];
    const out = [];
    for (const list of cells.values()) {
      if (list.length < 3) continue;
      const c = this._centroid(list);
      if (this.combatants.some((o) => o.alive && o.team === team && Math.hypot(o.pos.x - c.x, o.pos.z - c.z) < 45)) continue; // danger close
      let sc = list.length;
      if (posts.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 160)) sc += 4;
      out.push({ x: c.x, z: c.z, s: sc, n: Math.min(10, 4 + list.length), spread: 22, delay: 7, why: 'defensive' });
    }
    return out;
  }
  // a planned assault by the team that hasn't had its preparation fire yet
  _prepTarget(team) {
    for (const o of this.aiObjectives) {
      if (o.team !== team || o.done || o.prepped || !o.squad || !o.target || !['assault', 'counterattack'].includes(o.label)) continue;
      const al = o.squad.members.filter((b) => b.alive); if (al.length < 3) continue;
      const c = this._centroid(al), d = Math.hypot(c.x - o.target.x, c.z - o.target.z);
      if (d < 380 && d > 90) return { o, x: o.target.x, z: o.target.z, s: 9, n: 12, spread: 26, delay: 8, interval: 0.45, why: 'prep' };
    }
    return null;
  }
  _pickMission(cands) {
    let best = null;
    for (const m of cands) {
      // don't keep hammering the same spot
      const s = m.s * (this._lastFire && Math.hypot(this._lastFire.x - m.x, this._lastFire.z - m.z) < 40 ? 0.6 : 1) * (0.85 + Math.random() * 0.3);
      if (!best || s > best.sc) best = { ...m, sc: s };
    }
    if (best && best.o) best.o.prepped = true;
    if (best) this._lastFire = { x: best.x, z: best.z };
    return best;
  }
  _germanFireMission(bt) {
    const w = this.world, cands = [...this._fireTargets('axis')];
    const prep = this._prepTarget('axis'); if (prep) cands.push(prep);
    // harassing fire on the roads and assembly areas on the Allied side, when there's nothing better
    if (Math.random() < 0.5) {
      for (let k = 0; k < 8; k++) {
        const rd = w.roads[Math.floor(Math.random() * w.roads.length)]; if (!rd || rd.pts.length < 2) continue;
        const i = Math.floor(Math.random() * (rd.pts.length - 1)), f = Math.random(), a = rd.pts[i], c = rd.pts[i + 1];
        const x = a[0] + (c[0] - a[0]) * f, z = a[1] + (c[1] - a[1]) * f;
        if (Math.abs(x) < HALF - 30 && z > -HALF * 0.1 && z < HALF - 30 && !this.combatants.some((o) => o.alive && o.team === 'axis' && Math.hypot(o.pos.x - x, o.pos.z - z) < 60)) { cands.push({ x, z, s: 2, n: 4, spread: 30, delay: 6, why: 'harass' }); break; }
      }
      const wp = w.wpAllies[Math.floor(Math.random() * w.wpAllies.length)];
      if (wp) cands.push({ x: wp.x, z: wp.z, s: 1.5, n: 4, spread: 30, delay: 6, why: 'harass' });
    }
    return this._pickMission(cands);
  }
  _alliedFireMission(bt) {
    const cands = [...this._fireTargets('allies')];
    const prep = this._prepTarget('allies'); if (prep) cands.push(prep);
    // counter-battery once a German battery has given itself away
    const gb = this.batteries.find((b) => b.team === 'axis' && b.alive && b.onMap && b.fired >= 2);
    if (gb) cands.push({ x: gb.x, z: gb.z, s: 6, n: 8, spread: 16, delay: 8, why: 'counter' });
    return this._pickMission(cands);
  }
  _fire(bt, m) {
    bt.fired++;
    const cam = this.camera.position;
    if (bt.onMap) {
      // the guns flash and thunder where they stand
      for (let k = 0; k < 2; k++) setTimeout(() => {
        if (!this.running || !bt.alive) return;
        const gx = bt.x + (k ? 5 : -5), gz = bt.z, gy = this.world.H(gx, gz) + 1.4;
        this.effects.muzzle(gx, gy, gz + 2.5, true);
        for (let i = 0; i < 8; i++) this.effects.smoke.spawn(gx, gy, gz + 2.5, (Math.random() - 0.5) * 2, 1 + Math.random(), 2 + Math.random() * 2, 3, 2.5, 0.7, 0.68, 0.64, 0.5, -0.2, 1.4, 0.8);
        const d = Math.hypot(gx - cam.x, gz - cam.z);
        audio.explosion(d * 0.8 + 10, 0, true);
      }, k * 700);
    } else {
      const d = Math.hypot(bt.x - cam.x, bt.z - cam.z);
      audio.explosion(d * 0.6, 0, false); // distant guns
    }
    const own = bt.team === this.playerTeam;
    this.callArtillery(bt.team, m.x, m.z, m.n, m.spread, { delay: m.delay + (bt.onMap ? 2 : 5), show: own, interval: m.interval });
    if (own && m.why === 'prep' && this.player.alive && Math.hypot(m.x - this.player.pos.x, m.z - this.player.pos.z) < 400) this.hud.news('Allied guns are shelling the German line ahead of an assault', 'good');
  }
  _squad(team, props) { const sq = { team, members: [], obj: 0, ...props }; this.msquads.push(sq); return sq; }
  _bot(team, cls, sq, x, z, r) {
    const b = new Bot(this, team, cls);
    b.squadRef = sq; sq.members.push(b); this.bots.push(b);
    const p = this._safeSpot(x, z, r);
    b.spawn(p.x, p.z, sq);
    if (sq.role !== 'assault') b.yaw = Math.random() * Math.PI * 2;
    return b;
  }

  // ---------- convoy ----------
  _convoy(pts) {
    const w = this.world;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const truckGeo = M.truckGeometry();
    const L = [];
    let acc = 0;
    for (let i = 0; i + 1 < pts.length; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); L.push([acc, d]); acc += d; }
    this.convoyRoute = { pts, segs: L, length: acc };
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(truckGeo, mat); mesh.castShadow = true;
      this.scene.add(mesh);
      // trucks wait off-map, then roll through the sector
      const v = { mesh, s: -i * 16 - 30, speed: 6.5, hp: 150, alive: true, stopped: false, escaped: false, riders: 3 };
      this.vehicles.push(v);
    }
    this.convoyDelay = 90 + Math.random() * 60; // seconds before the convoy appears
  }
  _routePos(s) {
    const R = this.convoyRoute;
    s = clamp(s, 0, R.length - 0.01);
    for (let i = 0; i < R.segs.length; i++) {
      const [a, d] = R.segs[i];
      if (s <= a + d) {
        const f = (s - a) / d, p = R.pts[i], q = R.pts[i + 1];
        return { x: p[0] + (q[0] - p[0]) * f, z: p[1] + (q[1] - p[1]) * f, yaw: Math.atan2(q[0] - p[0], q[1] - p[1]) };
      }
    }
    const p = R.pts[R.pts.length - 1];
    return { x: p[0], z: p[1], yaw: 0 };
  }
  _updateConvoy(dt) {
    if (!this.vehicles.length) return;
    if (this.convoyDelay > 0) { this.convoyDelay -= dt; if (this.convoyDelay <= 0) this.hud.message('Engines in the distance — the convoy is coming', 3); }
    const halted = this.vehicles.some((v) => !v.alive || v.stopped);
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      if (this.convoyDelay <= 0 && !v.stopped && !v.escaped) {
        v.s += v.speed * dt;
        if (halted) this._dismount(v);
        if (v.s >= this.convoyRoute.length - 1) { v.escaped = true; v.mesh.visible = false; this.hud.message('A truck has escaped the sector', 2); }
      }
      const p = this._routePos(Math.max(0, v.s));
      v.x = p.x; v.z = p.z;
      v.mesh.visible = v.s > 0 && !v.escaped;
      v.mesh.position.set(p.x, this.world.H(p.x, p.z), p.z);
      v.mesh.rotation.y = p.yaw;
      if (v.mesh.visible && this.time - (v.soundT || 0) > 2.5 && Math.hypot(p.x - this.camera.position.x, p.z - this.camera.position.z) < 120) { v.soundT = this.time; }
    }
  }
  _dismount(v) {
    if (v.stopped) return;
    v.stopped = true;
    if (v.s <= 0) return;
    const sq = this._squad('axis', { role: 'qrf' });
    for (let i = 0; i < v.riders; i++) { const b = this._bot('axis', MIX[i], sq, v.x, v.z, 4); b.alert = true; }
    this.combatants = [...this.bots, this.player];
    this.raiseAlarm({ team: 'axis', pos: { x: v.x, z: v.z } }, { x: v.x, z: v.z });
  }

  // ---------- deployment ----------
  deployPlayer(cls) {
    const w = this.world;
    const L = this.landing;
    if (L && L.mine && !L.mine.released && !this.player.deaths) {
      // aboard the landing craft with the Rangers
      const bt = L.mine;
      this.player.spawn(bt.x, bt.z, cls);
      this.player.carrier = bt; this.player._seat = 2; this.player.yaw = 0; this.player.pitch = -0.05;
      this.player.satchels = this.charges0;
      this.rangers.forEach((b, i) => { b.spawn(bt.x, bt.z, this.rangerSquad); b.carrier = bt; b._seat = [0, 1, 3, 4, 6, 7][i % 6]; b.yaw = Math.PI; bt.riders.push(b); });
      this.paused = false;
      this.lockPointer();
      return true;
    }
    const p = this._safeSpot(w.insert.x, w.insert.z, 3);
    this.player.spawn(p.x, p.z, cls);
    this.player.yaw = Math.atan2(w.insert.x * 0.2, w.insert.z * 0.1);
    this.player.satchels = this.charges0;
    for (const b of this.rangers) {
      const q = this._safeSpot(p.x + b.slot[0], p.z + b.slot[1], 2);
      b.spawn(q.x, q.z, this.rangerSquad);
      b.yaw = this.player.yaw + Math.PI;
    }
    this.paused = false;
    this.lockPointer();
    this.hud.message(`<small>${this.cfg.region}</small><br>${this.cfg.mission.title}`, 4);
    return true;
  }

  // ---------- input ----------
  onKey(code) {
    const p = this.player;
    if (code === 'KeyF') this._plantCharge();
    if (code === 'KeyE') this._interact();
    if (code === 'KeyH') this._useMedkit();
    if (code === 'KeyQ') {
      this.squadHold = !this.squadHold;
      this.squadHoldPos = { x: p.pos.x, z: p.pos.z };
      this.hud.message(this.squadHold ? 'Squad: hold this position' : 'Squad: on me', 1.5);
      audio.ui();
      const r = this.rangers.filter((x) => x.alive).sort((a, c) => a.pos.distanceTo(p.pos) - c.pos.distanceTo(p.pos))[0];
      if (r) this.chatter.say(r, this.squadHold ? 'hold' : 'follow', { force: true });
    }
  }
  _nearestAsset(maxExtra = 3.5) {
    const p = this.player.pos;
    let best = null, bd = Infinity;
    for (const a of this.world.assets) {
      if (!a.alive || a.allied) continue;
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d < a.r + maxExtra && d < bd) { bd = d; best = a; }
    }
    return best;
  }
  _plantCharge() {
    const p = this.player;
    if (!p.alive) return;
    if (p.satchels <= 0) { this.hud.message('No demolition charges left', 1.5); return; }
    p.satchels--;
    const a = this._nearestAsset();
    const v = this.vehicles.find((v) => v.alive && Math.hypot(v.x - p.pos.x, v.z - p.pos.z) < 5);
    const bk = !a && !v ? this._nearBunker() : null;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.22), new THREE.MeshLambertMaterial({ color: 0x5a5236 }));
    const fx = p.pos.x - Math.sin(p.yaw) * 0.7, fz = p.pos.z - Math.cos(p.yaw) * 0.7;
    mesh.position.set(fx, this.world.groundAt(fx, fz, p.pos.y + 0.5) + 0.09, fz);
    this.scene.add(mesh);
    this.charges.push({ x: fx, z: fz, y: mesh.position.y, t: 9, mesh, beep: 0, asset: a, bunker: bk });
    this.hud.message(a ? `Charge set on the ${assetLabel(a).toLowerCase()} — 9 seconds, get clear!` : v ? 'Charge set on the truck — 9 seconds!' : bk ? 'Charge set on the bunker — 9 seconds, get clear!' : 'Charge set — 9 seconds!', 2.5);
    audio.click();
  }
  _nearBunker() {
    const p = this.player.pos;
    for (const B of this.world.buildings) {
      if (!B.bunker) continue;
      const dx = Math.max(B.x0 - p.x, 0, p.x - B.x1), dz = Math.max(B.z0 - p.z, 0, p.z - B.z1);
      if (Math.hypot(dx, dz) < 2.2) return B;
    }
    return null;
  }
  _useMedkit() {
    if (this.medkits <= 0) { this.hud.message('No medical kit', 1.2); return; }
    this.medkits--;
    const p = this.player; p.health = 100;
    for (const b of this.rangers) if (b.alive && b.pos.distanceTo(p.pos) < 12) b.health = 100;
    this.hud.message('Medic! The squad patches up its wounded', 2);
  }
  _interact() {
    const p = this.player, w = this.world;
    if (!p.alive) return;
    // documents
    if (this.docs && !this.docs.taken && Math.hypot(this.docs.x - p.pos.x, this.docs.z - p.pos.z) < 2.5) {
      this.docs.taken = true; this.scene.remove(this.docs.mesh);
      this.hud.message('Documents secured — get them back to HQ', 3); audio.ui(); return;
    }
    // prisoners
    const pow = this.pows.find((b) => b.alive && b.role === 'captive' && b.pos.distanceTo(p.pos) < 4);
    if (pow) {
      for (const b of this.pows) if (b.alive && b.role === 'captive') {
        b.role = 'follow'; b.squadRef = this.rangerSquad; this.rangerSquad.members.push(b); b.squad = this.rangerSquad;
        b.slot = SLOTS[4 + this.pows.indexOf(b)]; b.alert = true;
      }
      this.freed = true;
      this.hud.message('Prisoners freed — escort them to the extraction point', 3); audio.ui(); return;
    }
    // extraction
    if (Math.hypot(p.pos.x - w.exfil.x, p.pos.z - w.exfil.z) < w.exfil.radius) {
      if (!this.objectiveDone() && this.time > this.extractConfirm) {
        this.extractConfirm = this.time + 4;
        this.hud.message('Objective not complete — press E again to extract anyway', 3);
        return;
      }
      this.finish(true, this.objectiveDone() ? 'The squad has been extracted. Mission accomplished.' : 'The squad pulled out before completing the mission.');
    }
  }

  // ---------- objectives ----------
  objectiveDone() {
    const w = this.world;
    switch (this.type) {
      case 'sabotage': { const a = w.assets.find((x) => x.primary); return !!a && !a.alive; }
      case 'raid': return w.assets.filter((x) => x.sub).every((x) => !x.alive);
      case 'recon': return w.sites.ops.every((o) => o.done);
      case 'ambush': return this.vehicles.filter((v) => !v.alive).length >= 2;
      case 'capture': return !!(this.docs && this.docs.taken);
      case 'rescue': return this.pows.filter((b) => b.alive && b.role === 'follow').length >= 2;
      case 'defense': return !!(this.def && this.def.won);
      case 'landing': return !!(this.landing && this.landing.won);
    }
    return false;
  }
  objectiveText() {
    const w = this.world;
    switch (this.type) {
      case 'sabotage': { const a = w.assets.find((x) => x.primary); return [[`★ Destroy the ${assetLabel(a).toLowerCase()}`, !a.alive]]; }
      case 'raid': return w.assets.filter((x) => x.sub).map((a) => [`★ Demolish the ${assetLabel(a).toLowerCase()}`, !a.alive]);
      case 'recon': return w.sites.ops.map((o, i) => [`★ Observation post ${i + 1}${o.done ? '' : o.t > 0 ? ` (${Math.round(o.t / 10 * 100)}%)` : ''}`, o.done]);
      case 'ambush': { const n = this.vehicles.filter((v) => !v.alive).length; return [[`★ Destroy the convoy (${n}/2 trucks)`, n >= 2]]; }
      case 'capture': return [['★ Eliminate the German staff officer', this.officer && !this.officer.alive], ['★ Recover his documents', !!(this.docs && this.docs.taken)]];
      case 'defense': {
        const D = this.def, S = D.site, nests = (S.nests || []).filter((n) => n.crew && n.crew.members.some((b) => b.alive)).length;
        const out = [[`★ Break the German attack (wave ${Math.min(D.sent, D.n)}/${D.n})`, D.won], ['★ Do not let them take the position', !D.obj.done]];
        if (S.dump) out.push([`★ Protect the ammunition dump${D.sapT > 0 && S.dump.alive ? ' — SAPPERS!' : ''}`, S.dump.alive]);
        if (S.cp) out.push([`◆ Command post${S.cp.alive ? '' : ' (lost)'}`, S.cp.alive]);
        if (S.nests) out.push([`◆ MG nests manned: ${nests}/${S.nests.length}`, nests > 0]);
        return out;
      }
      case 'landing': { const L = this.landing, n = L.bunkers.filter((B) => B.cleared).length; return [['★ Get off the beach', !!L.offBeach], [`★ Knock out the bunkers on the bluff (${n}/${L.need})`, n >= L.need]]; }
      case 'rescue': return [['★ Free the prisoners', !!this.freed], [`★ Bring at least 2 out alive (${this.pows.filter((b) => b.alive).length} alive)`, this.objectiveDone()]];
    }
    return [];
  }

  // ---------- shouts & noise ----------
  // There is no sector-wide alarm: a German who spots or hears the squad shouts, and only the
  // soldiers within earshot react. Everyone else carries on until they see or hear something.
  raiseAlarm(src, pos) {
    if (src && src.team !== 'axis') return;
    const s0 = src && src.pos ? src.pos : pos;
    const nearSquad = s0 && [this.player, ...this.rangers].some((r) => r.alive && Math.hypot(r.pos.x - s0.x, r.pos.z - s0.z) < 90);
    if (pos && nearSquad) { this.alarmPos = { x: pos.x, z: pos.z }; this.alarmPosT = this.time; this.squadSeenT = this.time; this.alarm = true; }
    if (src && src.alive && src.isPlayer === false) this.chatter.say(src, 'alarm');
    if (!s0) return;
    for (const b of this.bots) {
      if (!b.alive || b.team !== 'axis' || b.alert) continue;
      if (Math.hypot(b.pos.x - s0.x, b.pos.z - s0.z) < 70) { b.alert = true; if (pos) { b.lastSeen = new THREE.Vector3(pos.x, 0, pos.z); b.lastSeenT = this.time; } }
    }
  }
  noise(pos, radius, src) {
    for (const b of this.bots) {
      if (!b.alive || b.team !== 'axis' || b.alert) continue;
      const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
      if (d > radius) continue;
      if (src && src.team === 'allies') {
        b.alert = true; b.lastSeen = new THREE.Vector3(pos.x, pos.y || 0, pos.z); b.lastSeenT = this.time;
        this.raiseAlarm(b, pos);
      } else b.suspicion += 0.5;
    }
  }
  playerShot(o, d, p) {
    super.playerShot(o, d, p);
    this.noise(p.pos, this.player.cls === 'sniper' ? 60 : 85, p);
    // bullets do a little damage to trucks
    for (const v of this.vehicles) {
      if (!v.alive || !v.mesh.visible) continue;
      const cx = v.x - o.x, cz = v.z - o.z, t = cx * d.x + cz * d.z;
      if (t > 0 && t < 200 && Math.hypot(cx - d.x * t, cz - d.z * t) < 1.6) { v.hp -= 6; this._dismount(v); if (v.hp <= 0) this._killVehicle(v, p); }
    }
  }
  explode(x, y, z, radius, dmg, owner, big = false) {
    super.explode(x, y, z, radius, dmg, owner, big);
    // everyone nearby gets their head down
    if (big) {
      for (const bt of this.bots) if (bt.alive && Math.hypot(bt.pos.x - x, bt.pos.z - z) < 35) { bt.duckUntil = this.time + 5 + Math.random() * 4; bt.suppress = 1; }
      const near = this.chatter.nearest(Math.random() < 0.5 ? 'axis' : 'allies', x, z, 40);
      if (near) this.chatter.say(near, 'incoming');
    }
    this.noise({ x, y, z }, 160, owner && owner.team ? owner : { team: 'allies' });
    for (const a of this.world.assets) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.z - z), reach = radius + a.r * 0.7;
      if (d > reach) continue;
      a.hp -= dmg * (1 - (d / reach) * 0.6) * (a.allied ? 0.07 : 1); // dug in and sandbagged against shellfire
      if (a.hp <= 0) this._destroyAsset(a, owner);
    }
    for (const v of this.vehicles) {
      if (!v.alive || !v.mesh.visible) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < radius + 3) { v.hp -= dmg * (1 - d / (radius + 3)); this._dismount(v); if (v.hp <= 0) this._killVehicle(v, owner); }
    }
  }
  _killVehicle(v, by) {
    if (!v.alive) return;
    v.alive = false;
    v.mesh.material = this.world.burntMat || new THREE.MeshLambertMaterial({ color: 0x2a2724 });
    v.mesh.scale.y = 0.75;
    setTimeout(() => this.running && super.explode(v.x, this.world.H(v.x, v.z) + 1, v.z, 7, 120, by || null, true), 200);
    this.fires.push({ x: v.x, y: this.world.H(v.x, v.z) + 1, z: v.z, t: 200, r: 1.5, big: false });
    this.hud.message('Truck destroyed', 1.5);
  }
  _destroyAsset(a, by) {
    if (!a.alive) return;
    this.world.destroyAsset(a);
    if (a.allied) {
      // one of ours
      for (let i = 0; i < 4; i++) setTimeout(() => this.running && super.explode(a.x + (Math.random() - 0.5) * a.r, a.y + 0.5, a.z + (Math.random() - 0.5) * a.r, 7, 120, by || null, true), 300 + i * 450);
      this.fires.push({ x: a.x, y: a.y + 1, z: a.z, t: 240, r: a.r * 0.5, big: a.type === 'ammo' });
      audio.explosion(Math.hypot(a.x - this.camera.position.x, a.z - this.camera.position.z), 0, true);
      if (a.type === 'ammo') { this.hud.message('⚠ THE AMMUNITION DUMP HAS GONE UP!', 4); if (this.def && !this.def.lost) { this.def.lost = true; setTimeout(() => this.finish(false, 'German sappers blew up the ammunition dump. Without it the position cannot be held.'), 3500); } }
      else { this.hud.message('⚠ The command post has been knocked out<br><small>No more artillery support for the position</small>', 4); for (const bt of this.batteries) if (bt.team === 'allies') bt.alive = false; }
      return;
    }
    this.destroyed.push(a.id);
    const chain = a.type === 'fuel' || a.type === 'ammo' || a.type === 'storage' ? 4 : 2;
    for (let i = 0; i < chain; i++) {
      setTimeout(() => {
        if (!this.running) return;
        const ox = a.x + (Math.random() - 0.5) * a.r, oz = a.z + (Math.random() - 0.5) * a.r;
        super.explode(ox, a.y + 0.5, oz, 7, 120, by || null, true);
      }, 300 + i * 450);
    }
    this.fires.push({ x: a.x, y: a.y + 1, z: a.z, t: 240, r: a.r * 0.5, big: a.type === 'fuel' || a.type === 'storage' });
    const T = a.sub ? { label: assetLabel(a), effect: 'One step closer to shutting the plant down.' } : ASSET_TYPES[a.type];
    this.hud.message(`${a.primary && !a.sub ? '★ PRIMARY OBJECTIVE COMPLETE<br>' : ''}${T.label} destroyed<br><small>${T.effect}</small>`, 4);
    if (this.cb.onAsset && !a.sub) this.cb.onAsset(a);
    if (this.objectiveDone()) setTimeout(() => this.running && this.hud.message('Objective complete — get to the extraction point', 3), 4200);
    audio.explosion(Math.hypot(a.x - this.camera.position.x, a.z - this.camera.position.z), 0, true);
    this.raiseAlarm({ team: 'axis', pos: { x: a.x, z: a.z } }, null);
  }

  // ---------- update ----------
  _updateBots(dt) {
    // full-rate AI near the player; distant groups think at a third of the rate and aren't drawn
    const c = this.camera.position;
    this.frameN = (this.frameN || 0) + 1;
    for (const b of this.bots) {
      if (b.retired) continue;
      const far = Math.hypot(b.pos.x - c.x, b.pos.z - c.z) > FAR;
      if (b.alive) b.model.visible = !far && !b.hidden;
      if (!far) b.update(dt);
      else if ((this.frameN + (b.rosterIdx || b.pos.x | 0)) % 3 === 0) b.update(Math.min(0.15, dt * 3));
    }
  }

  _modeUpdate(dt) {
    const w = this.world, p = this.player;
    this.dynT = (this.dynT || 0) - dt;
    if (this.dynT <= 0) {
      this.dynT = 1.2;
      if (p.alive) w.updateDynamicTarget(this.followIdx, p.pos.x, p.pos.z);
      for (const b of this.bots) {
        if (b.alive && b.team === 'axis' && b.visible && b.target && (b.target.isPlayer || b.target.role === 'follow')) {
          this.alarmPos = { x: b.target.pos.x, z: b.target.pos.z }; this.alarmPosT = this.time; this.squadSeenT = this.time; this.alarm = true; break;
        }
      }
      if (this.alarmPos) w.updateDynamicTarget(this.huntIdx, this.alarmPos.x, this.alarmPos.z);
      // the squad counts as undetected again once no German has had eyes on it for a while
      if (!this.def && !this.landing) this.stealth = this.time - (this.squadSeenT ?? -99) > 25;
      for (const a of w.assets) if (!a.known && !a.allied && p.alive && Math.hypot(a.x - p.pos.x, a.z - p.pos.z) < 130) { a.known = true; if (!a.primary) this.hud.message(`Enemy ${assetLabel(a).toLowerCase()} spotted`, 2); }
      this._spotting();
      for (const g of this.bots) {
        if (!g.alive || !g.visible || !g.target) continue;
        if (g.team === 'axis' && g.target.team === 'allies') g.target.seenByAxisT = this.time;
        else if (g.team === 'allies' && g.target.team === 'axis') g.target.seenByAlliesT = this.time;
      }
      this._aiObjectives(1.2);
      this._director(1.2);
      this._prune(1.2);
      if (this.def) this._defense(1.2);
    }
    this._updateConvoy(dt);
    this._landing(dt);
    this._artillery(dt);
    // demolition charges
    for (const ch of this.charges) {
      ch.t -= dt; ch.beep -= dt;
      if (ch.beep <= 0) { ch.beep = ch.t < 3 ? 0.25 : 0.8; if (Math.hypot(ch.x - this.camera.position.x, ch.z - this.camera.position.z) < 40) audio.click(); }
      if (ch.t <= 0) {
        this.scene.remove(ch.mesh); ch.mesh.geometry.dispose();
        if (ch.asset && ch.asset.alive) { ch.asset.hp = 0; this._destroyAsset(ch.asset, p); }
        if (ch.bunker && !ch.bunker.blown) {
          // the blast goes through the slit and the door: nobody inside survives
          const B = ch.bunker; B.blown = true;
          for (const b of this.bots) if (b.alive && this.world.bldAt(b.pos.x, b.pos.z) === B.idx) { p._lastWeapon = 'Demolition charge'; b.damage(500, p, { x: ch.x, z: ch.z }); }
          this.fires.push({ x: B.cx, z: B.cz, y: B.floor + 2.9, r: 3, t: 60, big: false });
        }
        this.explode(ch.x, ch.y, ch.z, 9, 300, p, true);
      }
    }
    this.charges = this.charges.filter((c) => c.t > 0);
    // bazooka rockets
    for (const r of this.rockets) {
      r.t += dt;
      const step = r.vel.length() * dt;
      const d = r.vel.clone().normalize();
      const hit = w.raycast(r.pos.x, r.pos.y, r.pos.z, d.x, d.y, d.z, step + 0.2);
      const hitBot = this.bots.find((b) => b.alive && b.team === 'axis' && b.rayHit(r.pos, d) && b.rayHit(r.pos, d).t < step);
      const hitVeh = this.vehicles.find((v) => v.alive && v.mesh.visible && Math.hypot(v.x - r.pos.x, v.z - r.pos.z) < 2.5);
      r.pos.addScaledVector(r.vel, dt); r.vel.y -= 2 * dt;
      r.mesh.position.copy(r.pos); r.mesh.lookAt(r.pos.clone().add(r.vel));
      this.effects.smoke.spawn(r.pos.x, r.pos.y, r.pos.z, 0, 0.3, 0, 0.8, 0.5, 0.7, 0.7, 0.7, 0.4, 0, 1.2, 1);
      if (hit !== Infinity || hitBot || hitVeh || r.t > 4 || r.pos.y < w.H(r.pos.x, r.pos.z)) {
        r.done = true; this.scene.remove(r.mesh);
        this.explode(r.pos.x, r.pos.y, r.pos.z, 4.5, 330, p, false);
        if (hitVeh) { hitVeh.hp -= 200; if (hitVeh.hp <= 0) this._killVehicle(hitVeh, p); }
        const a = this._assetNear(r.pos, 3); if (a) { a.hp -= 180; if (a.hp <= 0) this._destroyAsset(a, p); }
      }
    }
    this.rockets = this.rockets.filter((r) => !r.done);
    // burning wrecks
    this.fireT = (this.fireT || 0) - dt;
    if (this.fireT <= 0) {
      this.fireT = 0.12;
      for (const f of this.fires) {
        if ((f.t -= 0.12) <= 0) continue;
        if (Math.hypot(f.x - this.camera.position.x, f.z - this.camera.position.z) > 450) continue;
        const ox = f.x + (Math.random() - 0.5) * f.r, oz = f.z + (Math.random() - 0.5) * f.r;
        this.effects.fire.spawn(ox, f.y, oz, 0, 2 + Math.random() * 2, 0, 0.5 + Math.random() * 0.4, f.big ? 3 : 2, 1, 0.5, 0.15, 0.9, -1, 1.5, 0.5);
        this.effects.smoke.spawn(ox, f.y + 2, oz, (Math.random() - 0.5) * 0.6, 2.5, (Math.random() - 0.5) * 0.6, 6, 2.5, 0.12, 0.11, 0.1, 0.55, -0.15, 1.8, 0.2);
      }
      this.fires = this.fires.filter((f) => f.t > 0);
    }
    // recon observation
    if (w.sites.ops && p.alive) for (const o of w.sites.ops) {
      if (o.done) continue;
      const near = Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < 10;
      if (near && Math.hypot(p.vel.x, p.vel.z) < 1.2) { o.t += dt; if (o.t >= 10) { o.done = true; this.hud.message('Observation complete — positions noted', 2); audio.ui(); } }
    }
    // officer's documents
    if (this.officer && !this.officer.alive && !this.docs) {
      const o = this.officer;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: 0x3a2a1a }));
      mesh.position.set(o.pos.x + 0.6, this.world.H(o.pos.x, o.pos.z) + 0.1, o.pos.z);
      this.scene.add(mesh);
      this.docs = { x: mesh.position.x, z: mesh.position.z, mesh, taken: false };
      this.hud.message('The officer is down — grab his documents [E]', 3);
    }
    // prompts
    let prompt = '';
    if (p.alive) {
      const a = this._nearestAsset();
      if (a) prompt = `[F] Plant demolition charge — ${assetLabel(a)}${p.satchels ? '' : ' (none left)'}`;
      if (this.vehicles.some((v) => v.alive && v.mesh.visible && Math.hypot(v.x - p.pos.x, v.z - p.pos.z) < 5)) prompt = '[F] Plant demolition charge — truck';
      else if (!a) { const bk = this._nearBunker(); if (bk && !bk.blown) prompt = `[F] Plant demolition charge — bunker${p.satchels ? '' : ' (none left)'}`; }
      if (this.docs && !this.docs.taken && Math.hypot(this.docs.x - p.pos.x, this.docs.z - p.pos.z) < 2.5) prompt = '[E] Take the documents';
      if (this.pows.some((b) => b.alive && b.role === 'captive' && b.pos.distanceTo(p.pos) < 4)) prompt = '[E] Free the prisoners';
      const op = w.sites.ops && w.sites.ops.find((o) => !o.done && Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < 10);
      if (op) prompt = `Observing… keep still (${Math.round(op.t / 10 * 100)}%)`;
      if (Math.hypot(p.pos.x - w.exfil.x, p.pos.z - w.exfil.z) < w.exfil.radius) prompt = '[E] Extract the squad';
    }
    this.prompt = prompt;
    // player down → take over a surviving Ranger
    if (!p.alive && !this.over && this.downT && this.time - this.downT > 2) {
      const next = this.rangers.find((b) => b.alive && !b.unarmed && b.role === 'follow');
      if (next) this._takeOver(next);
      else this.finish(false, 'The Ranger squad has been wiped out.');
      this.downT = 0;
    }
    if (!this.over && this.time >= this.timeLimit) this.finish(true, 'The operation window has closed; the squad withdraws.');
  }
  _assetNear(pos, extra) { return this.world.assets.find((a) => a.alive && !a.allied && Math.hypot(a.x - pos.x, a.z - pos.z) < a.r + extra); }

  // Hidden AI objectives: a position is taken when attackers hold it with no defenders nearby.
  _aiObjectives(dt) {
    for (const o of this.aiObjectives) {
      if (o.done || o.manual || !o.target) continue;
      const t = o.target, R = (t.r || t.radius || 15) + 8;
      let att = 0, def = 0;
      for (const c of this.combatants) {
        if (!c.alive || c.unarmed) continue;
        if (Math.hypot(c.pos.x - t.x, c.pos.z - t.z) > R) continue;
        if (c.team === o.team) att++; else def++;
      }
      o.held = att > 0 && def === 0 ? o.held + dt : Math.max(0, o.held - dt);
      if (o.held > 40) {
        o.done = true;
        if (t.owner !== undefined) {
          t.owner = o.team;
          // other objectives on this spot that were already won by the side that just lost it stay counted;
          // the new owner's pending ones are settled
          for (const q of this.aiObjectives) if (q !== o && q.target === t && !q.done && q.team === o.team) q.done = true, q.w = 0;
        }
        if (o.team === 'allies' && this.cb.onNews) this.cb.onNews(`Allied troops have taken a German position in the sector`, 'good');
        if (o.team === 'axis' && this.cb.onNews) this.cb.onNews(`German troops have broken into the Allied side of the sector`, 'bad');
      }
    }
  }
  // Defense missions: German assault waves after a barrage; the position holds or falls
  _defense(dt) {
    const D = this.def; if (this.over || D.won) return;
    const P = D.site;
    if (D.obj.done) {
      if (!D.lost) { D.lost = true; this.hud.message('⚠ The position has been overrun!', 3); this.finish(false, 'The Germans have overrun the position.'); }
      return;
    }
    const alive = D.squads.reduce((a, sq) => a + sq.members.filter((b) => b.alive).length, 0);
    // the next wave goes in once the last one is spent (or after a while regardless)
    const spent = alive < D.size * 0.6;
    if (spent || this.time - D.lastWaveT > 210) D.next -= dt;
    if (D.sent < D.n && (D.next <= 0 || (D.sent > 0 && alive < 3 && this.time - D.lastWaveT > 45))) {
      D.sent++; D.lastWaveT = this.time; D.next = 40 + Math.random() * 30;
      // barrage first, then the infantry
      this.callArtillery('axis', P.x, P.z, 6 + D.sent, 26, { delay: 4, show: false });
      this.hud.message(`⚠ German attack! Wave ${D.sent} of ${D.n}`, 3);
      // the wave comes in on a broad front: a main assault on the position, flank groups going for
      // the MG nests, and from the second wave on a sapper team sent for the ammunition dump
      const z0 = clamp(P.z - 250 - Math.random() * 60, -HALF + 30, HALF - 30);
      const raise = (obj, n, x, classes = MIX) => {
        const sq = this._squad('axis', { role: 'assault', obj, mobile: false });
        for (let i = 0; i < n; i++) { const b = this._bot('axis', classes[i % classes.length], sq, x + (i % 5) * 4, z0 - Math.floor(i / 5) * 4, 6); b.alert = true; b.yaw = 0; }
        D.squads.push(sq); return sq;
      };
      const nests = (P.nests || []).filter((n) => n.crew && n.crew.members.some((b) => b.alive));
      const nMain = Math.round(D.size * (nests.length ? 0.55 : 0.8));
      raise(P.nav.idx, nMain, clamp(P.x + (Math.random() - 0.5) * 80, -HALF + 40, HALF - 40));
      if (nests.length) {
        const flanks = nests.length > 1 ? [nests[0], nests[nests.length - 1]] : nests;
        flanks.forEach((n) => raise(n.nav.idx, Math.max(3, Math.round((D.size - nMain) / flanks.length)), clamp(n.x + (n.x < P.x ? -60 : 60), -HALF + 40, HALF - 40)));
      }
      if (D.sent >= 2 && P.dump && P.dump.alive) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const sap = raise(P.dump.nav.idx, 3 + (D.sent > 4 ? 1 : 0), clamp(P.x + side * 170, -HALF + 40, HALF - 40), ['assault', 'rifleman', 'assault', 'rifleman']);
        sap.sappers = true;
        if (this.cb.onNews && D.sent === 2) this.cb.onNews('Intelligence: German engineers are trying to work round the flank toward the dump', 'bad');
      }
      this.combatants = [...this.bots, this.player];
    }
    // sappers at the dump: if nobody drives them off they set their charges
    const dump = P.dump;
    if (dump && dump.alive) {
      const at = D.squads.some((sq) => sq.sappers && sq.members.some((b) => b.alive && Math.hypot(b.pos.x - dump.x, b.pos.z - dump.z) < dump.r + 6));
      const guarded = this.combatants.some((c) => c.alive && c.team === 'allies' && c.role !== 'captive' && Math.hypot(c.pos.x - dump.x, c.pos.z - dump.z) < dump.r + 18);
      if (at && !guarded) {
        if (D.sapT === 0) { this.hud.message('⚠ German sappers are at the ammunition dump!', 3); const r = this.rangers.find((x) => x.alive); if (r) this.chatter.say(r, 'contact', { force: true }); }
        D.sapT += dt;
        if (D.sapT > 20) { dump.hp = 0; this._destroyAsset(dump, null); }
      } else D.sapT = Math.max(0, D.sapT - dt * 0.5);
    }
    // the MG nests that lose their crews
    for (const n of P.nests || []) {
      if (!n.crew || n.crew.members.some((b) => b.alive)) continue;
      if (n.alive) { n.alive = false; n.lostT = this.time; this.hud.news('An MG nest on the line has been knocked out', 'bad'); }
      // riflemen from the line move up to man the gun again, if the Germans aren't sitting in it
      const held = this.bots.some((b) => b.alive && b.team === 'axis' && Math.hypot(b.pos.x - n.x, b.pos.z - n.z) < 12);
      if (!held && this.time - (n.lostT || 0) > 25 && this.time - (n.remanT || -99) > 60) {
        // the nearest riflemen holding the line (not other gun teams, not the Rangers)
        const pick = this.bots.filter((b) => b.alive && b.team === 'allies' && (b.role === 'guard' || b.role === 'assault') && b.squadRef && !b.squadRef.fixed && Math.hypot(b.pos.x - n.x, b.pos.z - n.z) < 150)
          .sort((a, c) => Math.hypot(a.pos.x - n.x, a.pos.z - n.z) - Math.hypot(c.pos.x - n.x, c.pos.z - n.z)).slice(0, 2);
        if (pick.length) {
          n.remanT = this.time; n.alive = true;
          for (const b of pick) { const old = b.squadRef; old.members.splice(old.members.indexOf(b), 1); b.role = 'guard'; b.squad = n.crew; b.squadRef = n.crew; n.crew.members.push(b); b.holdPt = null; }
          this.hud.news('Riflemen are moving up to man a silent MG nest', 'good');
        }
      }
    }
    if (D.lost) return;
    if (D.sent >= D.n && ((alive <= Math.max(2, D.size * 0.2) && this.time - D.lastWaveT > 25) || this.time - D.lastWaveT > 240)) {
      D.won = true;
      this.hud.message('★ The German attack has been broken!<br><small>Relief troops are taking over the position.</small>', 4);
      if (this.cb.onNews) this.cb.onNews('The German attack on the sector has been broken', 'good');
      setTimeout(() => { if (!this.over) { this.extracted = true; this.finish(true, 'The German attack has been broken and the position held. Relief troops take over.'); } }, 9000);
    }
  }

  // Bodies that have lain out of sight for a while, and soldiers who marched off the map, are
  // dropped from the simulation. The casualty counts the strategic battle needs are kept.
  _prune(dt) {
    this.pruneT = (this.pruneT ?? 10) - dt;
    if (this.pruneT > 0) return;
    this.pruneT = 10;
    const g = this.gone || (this.gone = { axis: { n: 0, dead: 0 }, allies: { n: 0, dead: 0 } });
    const keep = new Set(this.rangers);
    const out = [];
    for (const b of this.bots) {
      if (keep.has(b) || b.role === 'captive') continue;
      if (b.retired || (!b.alive && b.deadT > 25 && !b.model.visible)) out.push(b);
    }
    if (!out.length) return;
    const drop = new Set(out);
    for (const b of out) {
      if (!(b.team === 'allies' && b.role === 'follow')) { g[b.team].n++; if (b.deaths > 0) g[b.team].dead++; }
      if (b.retired && b.squadRef) b.squadRef.anyRetired = true;
      if (b.cover && b.cover.occ === b) b.cover.occ = null;
      if (b.holdPt && b.holdPt.occ === b) b.holdPt.occ = null;
      this.scene.remove(b.model);
    }
    this.bots = this.bots.filter((b) => !drop.has(b));
    for (const sq of this.msquads) if (sq.members.some((m) => drop.has(m))) sq.members = sq.members.filter((m) => !drop.has(m));
    this.combatants = [...this.bots, this.player];
  }

  // feeds the strategic battle in this sector
  frontBias() {
    let b = 0;
    for (const o of this.aiObjectives) if (o.done) b += (o.team === 'allies' ? 1 : -1) * (o.w ?? 0.15);
    // casualties (not soldiers who simply marched off the map), including those already pruned
    const g = this.gone || { axis: { n: 0, dead: 0 }, allies: { n: 0, dead: 0 } };
    const axis = this.bots.filter((x) => x.team === 'axis'), allies = this.bots.filter((x) => x.team === 'allies' && x.role !== 'follow' && x.role !== 'captive');
    const axN = axis.length + g.axis.n, alN = allies.length + g.allies.n;
    b += ((axis.filter((x) => x.deaths > 0).length + g.axis.dead) / (axN || 1)) * 0.25;
    if (alN) b -= ((allies.filter((x) => x.deaths > 0).length + g.allies.dead) / alN) * 0.12;
    return clamp(b, -0.45, 0.45);
  }

  _takeOver(b) {
    const p = this.player;
    this.controlIdx = b.rosterIdx;
    const m = this.roster[b.rosterIdx];
    b.alive = false; b.retired = true; b.model.visible = false;
    p.spawn(b.pos.x, b.pos.z, b.cls);
    p.health = Math.max(40, b.health);
    p.yaw = b.yaw + Math.PI;
    p.satchels = this.lastSatchels ?? 1;
    p.name = `${m.rank} ${m.name}`;
    this.rangers = this.rangers.filter((r) => r !== b);
    this.hud.message(`You take command as ${m.rank} ${m.name}`, 3);
  }

  onKill(victim, killer) {
    if (!victim.alive) return;
    if (victim.isPlayer) {
      victim.die();
      this.roster[this.controlIdx].alive = false;
      this.lastSatchels = victim.satchels;
      this.stats.deaths++;
      this.hud.kill(killer, victim, killer && killer.w ? killer.w.name : '', false);
      this.hud.message(`${victim.name} is down!`, 2);
      this.downT = this.time;
      for (const b of this.bots) if (b.target === victim) { b.target = null; b.visible = false; }
      return;
    }
    victim.die();
    if (victim.team === 'axis') this.garrisonDead++;
    if (victim.rosterIdx !== undefined) this.roster[victim.rosterIdx].alive = false;
    if (killer && killer.rosterIdx !== undefined) this.roster[killer.rosterIdx].kills++;
    if (killer && killer.isPlayer && this.roster[this.controlIdx]) this.roster[this.controlIdx].kills++;
    if (killer && killer !== victim) killer.kills++;
    if (killer && killer.isPlayer) this.stats.kills++;
    this.hud.kill(killer, victim, killer ? (killer._lastWeapon || (killer.w && killer.w.name) || '') : '', victim.killedByHead);
    if (victim.team === 'axis') this.noise(victim.pos, 25, { team: 'allies' });
    if (victim.officer && victim.officerMark) victim.officerMark.visible = false;
    for (const b of this.bots) if (b.target === victim) { b.target = null; b.visible = false; }
  }

  _reinforce() {}
  _bleed() {}
  _enemySupport() {}

  // ---------- end ----------
  finish(extracted, reason) {
    if (this.over) return;
    this.over = true; this.extracted = extracted; this.reason = reason;
    document.exitPointerLock && document.exitPointerLock();
    this.player.mouse.left = false;
    setTimeout(() => this.cb.onEnd(this.result()), 1200);
  }
  end() {}

  result() {
    const w = this.world;
    const done = this.objectiveDone() && (this.type !== 'capture' && this.type !== 'rescue' && this.type !== 'recon' ? true : !!this.extracted);
    return {
      mode: 'mission', type: this.type, region: this.cfg.regionIdx, missionId: this.cfg.mission.id,
      primaryId: this.cfg.mission.assetId, strategicId: this.cfg.mission.strategicId,
      primaryDone: done, destroyed: [...this.destroyed].filter((id) => typeof id === 'number'),
      kills: this.garrisonDead, extracted: !!this.extracted, reason: this.reason,
      trucks: this.vehicles.filter((v) => !v.alive).length,
      rescued: this.pows.filter((b) => b.alive && b.role === 'follow').length,
      alarm: this.alarm,
      squad: this.roster.map((m) => ({ idx: m.idx, alive: m.alive, kills: m.kills })),
      aiObjectives: this.aiObjectives.map((o) => ({ team: o.team, done: o.done })),
      front: this.cfg.front ? { battleId: this.cfg.front.battleId, bias: this.frontBias(), winner: this.def ? (this.def.won ? 'allies' : this.def.lost ? 'axis' : null) : this.landing ? (this.landing.won ? 'allies' : null) : null } : null,
      stats: { ...this.stats }, time: this.time,
      winner: done ? 'allies' : 'axis', tickets: { ...this.tickets }, tickets0: { ...this.tickets0 },
    };
  }
  retreatResolve() {
    this.over = true; this.extracted = true; this.reason = 'The squad was pulled out on your order.';
    document.exitPointerLock && document.exitPointerLock();
    return this.result();
  }
}
Object.assign(Mission.prototype, DIRECTOR);

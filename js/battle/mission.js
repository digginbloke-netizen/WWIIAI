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
    for (const s of w.strongpoints) {
      const n = gsize({ town: 9, hamlet: 4, complex: 7, hq: 4, pow: 4, line: 6 }[s.kind] || 4);
      const sq = this._squad('axis', { role: 'guard', obj: s.nav.idx });
      for (let i = 0; i < n; i++) this._bot('axis', MIX[k++ % 6], sq, s.x, s.z, s.r);
      if (s.kind === 'town' || s.kind === 'complex' || s.kind === 'line') this.aiObjectives.push({ team: 'allies', target: s, label: 'position', held: 0, done: false });
    }
    for (const a of w.assets) {
      if (a.sub) continue;
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

    // --- hidden AI objectives: what the armies in this sector are trying to do ---
    const front = cfg.front;
    this.frontInfo = front;
    if (cfg.depth === 0) {
      // friendly patrol near the Allied side
      const fr = w.wpAllies.map((p) => p.idx).sort(() => Math.random() - 0.5);
      const sq = this._squad('allies', { role: 'fpatrol', route: fr, leg: 1 });
      for (let j = 0; j < 4; j++) this._bot('allies', MIX[j], sq, w.targets[fr[0]].x, w.targets[fr[0]].z, 4);
    }
    if (front && front.attacker === 'allies') {
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

    // --- artillery: batteries with their own fire missions ---
    this.batteries = [];
    const gAsset = w.assets.find((a) => a.type === 'artillery' && !a.sub);
    if (gAsset) this.batteries.push({ team: 'axis', x: gAsset.x, z: gAsset.z, asset: gAsset, onMap: true });
    else if (!cfg.artCut && (cfg.front || cfg.depth === 0 || cfg.fort >= 2)) this.batteries.push({ team: 'axis', x: (Math.random() - 0.5) * 600, z: -HALF - 380, onMap: false });
    if (cfg.front && cfg.front.attacker === 'allies') this.batteries.push({ team: 'allies', x: (Math.random() - 0.5) * 600, z: HALF + 520, onMap: false });
    for (const bt of this.batteries) { bt.cd = 35 + Math.random() * 45; bt.fired = 0; bt.alive = true; }
    this.incomingT = -99;
  }

  // ---------- artillery ----------
  _artillery(dt) {
    for (const bt of this.batteries) {
      if (bt.asset && !bt.asset.alive) { if (bt.alive) this.hud.news('The German battery in the sector has been silenced', 'good'); bt.alive = false; }
      if (!bt.alive) continue;
      bt.cd -= dt;
      if (bt.cd > 0) continue;
      const m = bt.team === 'axis' ? this._germanFireMission(bt) : this._alliedFireMission(bt);
      bt.cd = m ? 65 + Math.random() * 55 : 12;
      if (m) this._fire(bt, m);
    }
    // warning when rounds are about to land near you
    const p = this.player;
    if (p.alive && this.time - this.incomingT > 12 && this.shells.some((s) => !s.byPlayer && s.t < 2.5 && Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < 55)) {
      this.incomingT = this.time; this.hud.message('⚠ INCOMING!', 1.5);
    }
  }
  _centroid(list) { let x = 0, z = 0; for (const b of list) { x += b.pos.x; z += b.pos.z; } return { x: x / list.length, z: z / list.length }; }
  _germanFireMission(bt) {
    const w = this.world;
    // 1) the squad's last known position, called in by German spotters
    if (this.alarm && this.alarmPos && this.time - (this.alarmPosT || 0) < 30 && Math.random() < 0.7) {
      return { x: this.alarmPos.x, z: this.alarmPos.z, n: 6, spread: 24, delay: 12, why: 'squad' };
    }
    // 2) defensive fire on Allied troops the Germans can see near their positions
    const seen = this.bots.filter((b) => b.alive && b.team === 'allies' && b.role !== 'follow' && b.role !== 'captive' && this.time - (b.seenByAxisT || -99) < 8);
    if (seen.length >= 3) { const c = this._centroid(seen); return { x: c.x, z: c.z, n: 8, spread: 22, delay: 6, why: 'defensive' }; }
    // 3) harassing fire on a road on the Allied side
    if (Math.random() < 0.4 && w.roads.length) for (let k = 0; k < 8; k++) {
      const rd = w.roads[Math.floor(Math.random() * w.roads.length)]; if (rd.pts.length < 2) continue;
      const i = Math.floor(Math.random() * (rd.pts.length - 1)), f = Math.random(), a = rd.pts[i], c = rd.pts[i + 1];
      const x = a[0] + (c[0] - a[0]) * f, z = a[1] + (c[1] - a[1]) * f;
      if (Math.abs(x) < HALF - 30 && z > -HALF * 0.1 && z < HALF - 30) return { x, z, n: 4, spread: 30, delay: 6, why: 'harass' };
    }
    return null;
  }
  _alliedFireMission(bt) {
    // 1) preparation ahead of an Allied assault
    for (const o of this.aiObjectives) {
      if (o.team !== 'allies' || o.done || o.prepped || !o.squad) continue;
      const al = o.squad.members.filter((b) => b.alive); if (!al.length) continue;
      const c = this._centroid(al), d = Math.hypot(c.x - o.target.x, c.z - o.target.z);
      if (d < 380 && d > 90) { o.prepped = true; return { x: o.target.x, z: o.target.z, n: 12, spread: 26, delay: 8, interval: 0.45, why: 'prep' }; }
    }
    // 2) counter-battery once a German battery has given itself away
    const gb = this.batteries.find((b) => b.team === 'axis' && b.alive && b.onMap && b.fired >= 2);
    if (gb && Math.random() < 0.6) return { x: gb.x, z: gb.z, n: 8, spread: 16, delay: 8, why: 'counter' };
    // 3) break up a German counterattack
    for (const o of this.aiObjectives) {
      if (o.team !== 'axis' || o.done || !o.squad) continue;
      const al = o.squad.members.filter((b) => b.alive); if (al.length < 3) continue;
      const c = this._centroid(al); return { x: c.x, z: c.z, n: 8, spread: 22, delay: 8, why: 'support' };
    }
    return null;
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
    }
  }
  _nearestAsset(maxExtra = 3.5) {
    const p = this.player.pos;
    let best = null, bd = Infinity;
    for (const a of this.world.assets) {
      if (!a.alive) continue;
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.22), new THREE.MeshLambertMaterial({ color: 0x5a5236 }));
    const fx = p.pos.x - Math.sin(p.yaw) * 0.7, fz = p.pos.z - Math.cos(p.yaw) * 0.7;
    mesh.position.set(fx, this.world.groundAt(fx, fz, p.pos.y + 0.5) + 0.09, fz);
    this.scene.add(mesh);
    this.charges.push({ x: fx, z: fz, y: mesh.position.y, t: 9, mesh, beep: 0, asset: a });
    this.hud.message(a ? `Charge set on the ${assetLabel(a).toLowerCase()} — 9 seconds, get clear!` : v ? 'Charge set on the truck — 9 seconds!' : 'Charge set — 9 seconds!', 2.5);
    audio.click();
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
      case 'rescue': return [['★ Free the prisoners', !!this.freed], [`★ Bring at least 2 out alive (${this.pows.filter((b) => b.alive).length} alive)`, this.objectiveDone()]];
    }
    return [];
  }

  // ---------- alarm & noise ----------
  raiseAlarm(src, pos) {
    if (src && src.team !== 'axis') return;
    const s0 = src && src.pos ? src.pos : pos;
    const nearSquad = s0 && [this.player, ...this.rangers].some((r) => r.alive && Math.hypot(r.pos.x - s0.x, r.pos.z - s0.z) < 90);
    if (pos && nearSquad) { this.alarmPos = { x: pos.x, z: pos.z }; this.alarmPosT = this.time; }
    if (!this.alarm && nearSquad) {
      this.alarm = true; this.stealth = false;
      this.qrfT = this.time + 70;
      this.hud.message('⚠ The alarm has been raised!', 2.5);
    }
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
    if (big) for (const bt of this.bots) if (bt.alive && Math.hypot(bt.pos.x - x, bt.pos.z - z) < 35) { bt.duckUntil = this.time + 5 + Math.random() * 4; bt.suppress = 1; }
    this.noise({ x, y, z }, 160, owner && owner.team ? owner : { team: 'allies' });
    for (const a of this.world.assets) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.z - z), reach = radius + a.r * 0.7;
      if (d > reach) continue;
      a.hp -= dmg * (1 - (d / reach) * 0.6);
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
          this.alarmPos = { x: b.target.pos.x, z: b.target.pos.z }; this.alarmPosT = this.time; break;
        }
      }
      if (this.alarmPos) w.updateDynamicTarget(this.huntIdx, this.alarmPos.x, this.alarmPos.z);
      for (const a of w.assets) if (!a.known && p.alive && Math.hypot(a.x - p.pos.x, a.z - p.pos.z) < 130) { a.known = true; if (!a.primary) this.hud.message(`Enemy ${assetLabel(a).toLowerCase()} spotted`, 2); }
      this._spotting();
      for (const g of this.bots) if (g.alive && g.team === 'axis' && g.visible && g.target && g.target.team === 'allies') g.target.seenByAxisT = this.time;
      this._aiObjectives(1.2);
    }
    // reaction force
    if (this.alarm && this.time > this.qrfT && this.reserve > 0 && this.alarmPos) {
      this.qrfT = this.time + 120;
      const n = Math.min(6, this.reserve); this.reserve -= n;
      const ang = Math.random() * Math.PI * 2;
      const sx = clamp(this.alarmPos.x + Math.cos(ang) * 200, -HALF + 20, HALF - 20), sz = clamp(this.alarmPos.z - Math.abs(Math.sin(ang)) * 200, -HALF + 20, HALF - 20);
      const sq = this._squad('axis', { role: 'qrf' });
      for (let i = 0; i < n; i++) { const b = this._bot('axis', MIX[i], sq, sx, sz, 6); b.alert = true; }
      this.combatants = [...this.bots, this.player];
      this.hud.message('Enemy reaction force moving in!', 3);
    }
    this._updateConvoy(dt);
    this._artillery(dt);
    // demolition charges
    for (const ch of this.charges) {
      ch.t -= dt; ch.beep -= dt;
      if (ch.beep <= 0) { ch.beep = ch.t < 3 ? 0.25 : 0.8; if (Math.hypot(ch.x - this.camera.position.x, ch.z - this.camera.position.z) < 40) audio.click(); }
      if (ch.t <= 0) {
        this.scene.remove(ch.mesh); ch.mesh.geometry.dispose();
        if (ch.asset && ch.asset.alive) { ch.asset.hp = 0; this._destroyAsset(ch.asset, p); }
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
  _assetNear(pos, extra) { return this.world.assets.find((a) => a.alive && Math.hypot(a.x - pos.x, a.z - pos.z) < a.r + extra); }

  // Hidden AI objectives: a position is taken when attackers hold it with no defenders nearby.
  _aiObjectives(dt) {
    for (const o of this.aiObjectives) {
      if (o.done) continue;
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
        if (o.team === 'allies' && this.cb.onNews) this.cb.onNews(`Allied troops have taken a German position in the sector`, 'good');
        if (o.team === 'axis' && this.cb.onNews) this.cb.onNews(`German troops have broken into the Allied side of the sector`, 'bad');
      }
    }
  }
  // feeds the strategic battle in this sector
  frontBias() {
    let b = 0;
    for (const o of this.aiObjectives) if (o.done) b += o.team === 'allies' ? 0.15 : -0.15;
    const axisAlive = this.bots.filter((x) => x.alive && x.team === 'axis').length;
    const axisTotal = this.bots.filter((x) => x.team === 'axis').length || 1;
    b += (1 - axisAlive / axisTotal) * 0.25;
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
      front: this.cfg.front ? { battleId: this.cfg.front.battleId, bias: this.frontBias(), winner: null } : null,
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

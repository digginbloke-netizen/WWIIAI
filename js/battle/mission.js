// Ranger mission: a squad-level operation inside a live sector of the front.
import * as THREE from 'three';
import { Battle } from './battle.js';
import { Bot } from './soldier.js';
import { HALF } from './world.js';
import { ASSET_TYPES } from '../campaign/data.js';
import { audio } from '../audio.js';
import { clamp } from '../util.js';

const GARRISON_CLS = ['rifleman', 'rifleman', 'assault', 'rifleman', 'support', 'assault'];
const SLOTS = [[-2.6, 3.2], [2.6, 3.2], [-4.2, 6.5], [4.2, 6.5], [0, 8]];

export class Mission extends Battle {
  constructor(cfg, container, hudRoot, callbacks) {
    const f = cfg.front;
    cfg.alliedTroops = f ? f.alliedTroops : 10;
    cfg.axisTroops = f ? f.axisTroops : 10;
    cfg.attacker = f ? f.attacker : 'allies';
    super(cfg, container, hudRoot, callbacks);
  }

  // ---------- forces ----------
  _setupForces() {
    const cfg = this.cfg, w = this.world;
    this.isMission = true;
    this.timeLimit = 45 * 60;
    this.stealth = true; this.alarm = false; this.alarmPos = null;
    this.qrfT = Infinity; this.destroyed = []; this.charges = []; this.fires = [];
    this.frontActive = !!cfg.front; this.frontOver = false; this.frontWinner = null;
    this.garrisonDead = 0; this.extractConfirm = 0; this.squadHold = false;
    this.msquads = [];
    if (this.frontActive) {
      // a smaller slice of the frontline battle runs on the flank
      const fc = Math.max(10, Math.round(this.cap * 0.6));
      const sc = Math.min(1, 90 / Math.max(this.tickets.allies, this.tickets.axis));
      this.tickets = { allies: Math.max(10, Math.round(this.tickets.allies * sc)), axis: Math.max(10, Math.round(this.tickets.axis * sc)) };
      this.tickets0 = { ...this.tickets };
      super._setupForces(fc, true);
    } else this.combatants = [this.player];
    this.followIdx = w.addDynamicTarget(w.insert.x, w.insert.z);
    this.huntIdx = w.addDynamicTarget(w.insert.x, w.insert.z - 40);

    // German garrison: guards on every asset, patrols between waypoints, a reserve for the reaction force
    const total = clamp(Math.round(cfg.garrison * 0.45), 12, Math.round(this.cap * 1.2));
    let k = 0;
    for (const a of w.assets) {
      const sq = this._squad('axis', { role: 'guard', obj: a.target });
      const n = a.primary ? 4 : 3;
      for (let i = 0; i < n; i++) this._bot('axis', GARRISON_CLS[k++ % 6], sq, a.x, a.z, a.r + 5);
    }
    const remaining = Math.max(0, total - k);
    const patrolN = Math.round(remaining * 0.6);
    for (let i = 0; i < patrolN; i += 3) {
      const route = [...w.wpAxisIdx].sort(() => Math.random() - 0.5).slice(0, 4);
      const sq = this._squad('axis', { role: 'patrol', route, leg: 1 });
      const t = w.targets[route[0]];
      for (let j = 0; j < 3 && i + j < patrolN; j++) this._bot('axis', GARRISON_CLS[k++ % 6], sq, t.x, t.z, 4);
    }
    this.reserve = remaining - patrolN;
    // friendly patrol near the Allied side of the sector
    if (cfg.friendlyPatrol) {
      const route = [...w.wpAlliesIdx].sort(() => Math.random() - 0.5);
      const sq = this._squad('allies', { role: 'fpatrol', route, leg: 1 });
      const t = w.targets[route[0]];
      for (let j = 0; j < 4; j++) this._bot('allies', GARRISON_CLS[j], sq, t.x, t.z, 4);
    }
    // the Ranger squad (spawned with the player)
    this.roster = cfg.squad.map((m) => ({ ...m, alive: true, kills: 0 }));
    this.controlIdx = this.roster.findIndex((m) => m.leader);
    if (this.controlIdx < 0) this.controlIdx = 0;
    this.rangerSquad = this._squad('allies', { role: 'follow' });
    this.rangers = [];
    let slot = 0;
    this.roster.forEach((m, i) => {
      if (i === this.controlIdx) return;
      const b = new Bot(this, 'allies', m.cls);
      b.name = `${m.rank} ${m.name}`; b.rosterIdx = i; b.skill = 1.25; b.slot = SLOTS[slot++ % SLOTS.length];
      b.squadRef = this.rangerSquad; this.rangerSquad.members.push(b);
      this.bots.push(b); this.rangers.push(b);
    });
    this.player.name = this.roster[this.controlIdx] ? `${this.roster[this.controlIdx].rank} ${this.roster[this.controlIdx].name === 'You' ? '(You)' : this.roster[this.controlIdx].name}` : 'You';
    this.combatants = [...this.bots, this.player];
    this.charges0 = 3;
  }
  _squad(team, props) { const sq = { team, members: [], obj: 0, ...props }; this.msquads.push(sq); return sq; }
  _bot(team, cls, sq, x, z, r) {
    const b = new Bot(this, team, cls);
    b.squadRef = sq; sq.members.push(b); this.bots.push(b);
    const p = this._safeSpot(x, z, r);
    b.spawn(p.x, p.z, sq);
    b.yaw = Math.random() * Math.PI * 2;
    return b;
  }

  // ---------- deployment ----------
  deployPlayer(cls) {
    const w = this.world;
    const p = this._safeSpot(w.insert.x, w.insert.z, 3);
    this.player.spawn(p.x, p.z, cls);
    this.player.yaw = Math.atan2(w.insert.x * 0.3, w.insert.z); // face into the sector
    this.player.satchels = this.charges0;
    for (const b of this.rangers) {
      const q = this._safeSpot(p.x + b.slot[0], p.z + b.slot[1], 2);
      b.spawn(q.x, q.z, this.rangerSquad);
      b.yaw = this.player.yaw + Math.PI;
    }
    this.paused = false;
    this.lockPointer();
    const prim = w.assets.find((a) => a.primary);
    this.hud.message(`<small>${this.cfg.region}</small><br>Destroy the ${ASSET_TYPES[prim.type].label.toLowerCase()}`, 4);
    return true;
  }

  // ---------- input ----------
  onKey(code) {
    const p = this.player;
    if (code === 'KeyF') this._plantCharge();
    if (code === 'KeyE') this._tryExtract();
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.22), new THREE.MeshLambertMaterial({ color: 0x5a5236 }));
    const fx = p.pos.x - Math.sin(p.yaw) * 0.7, fz = p.pos.z - Math.cos(p.yaw) * 0.7;
    mesh.position.set(fx, this.world.groundAt(fx, fz, p.pos.y + 0.5) + 0.09, fz);
    this.scene.add(mesh);
    this.charges.push({ x: fx, z: fz, y: mesh.position.y, t: 9, mesh, beep: 0, asset: a });
    this.hud.message(a ? `Charge set on the ${ASSET_TYPES[a.type].label.toLowerCase()} — 9 seconds, get clear!` : 'Charge set — 9 seconds!', 2.5);
    audio.click();
  }

  _tryExtract() {
    const p = this.player, x = this.world.exfil;
    if (!p.alive || Math.hypot(p.pos.x - x.x, p.pos.z - x.z) > x.radius) return;
    const prim = this.world.assets.find((a) => a.primary);
    if (prim && prim.alive && this.time > this.extractConfirm) {
      this.extractConfirm = this.time + 4;
      this.hud.message('Primary objective not complete — press E again to extract anyway', 3);
      return;
    }
    this.finish(true, prim && !prim.alive ? 'The squad has been extracted. Mission accomplished.' : 'The squad pulled out before completing the mission.');
  }

  // ---------- alarm & noise ----------
  raiseAlarm(src, pos) {
    if (src && src.team !== 'axis') return;
    const s0 = src && src.pos ? src.pos : pos;
    // a firefight elsewhere in the sector only puts the local garrison on alert;
    // the sector-wide alarm (and the reaction force) needs contact near the Rangers
    const nearSquad = s0 && [this.player, ...this.rangers].some((r) => r.alive && Math.hypot(r.pos.x - s0.x, r.pos.z - s0.z) < 75);
    if (pos && nearSquad) this.alarmPos = { x: pos.x, z: pos.z };
    if (!this.alarm && nearSquad) {
      this.alarm = true; this.stealth = false;
      this.qrfT = this.time + 60;
      this.hud.message('⚠ The alarm has been raised!', 2.5);
    }
    // nearby garrison troops become alert
    const s = s0;
    if (!s) return;
    for (const b of this.bots) {
      if (!b.alive || b.team !== 'axis' || b.role === 'front' || b.alert) continue;
      if (Math.hypot(b.pos.x - s.x, b.pos.z - s.z) < 70) { b.alert = true; if (pos) { b.lastSeen = new THREE.Vector3(pos.x, 0, pos.z); b.lastSeenT = this.time; } }
    }
  }
  // gunfire and explosions draw the attention of unaware enemies
  noise(pos, radius, src) {
    if (!this.isMission) return;
    for (const b of this.bots) {
      if (!b.alive || b.team !== 'axis' || b.role === 'front' || b.alert) continue;
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
    this.noise(p.pos, 85, p);
  }

  explode(x, y, z, radius, dmg, owner, big = false) {
    super.explode(x, y, z, radius, dmg, owner, big);
    this.noise({ x, y, z }, 150, owner && owner.team ? owner : { team: 'allies' });
    for (const a of this.world.assets) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - x, a.z - z);
      const reach = radius + a.r * 0.7;
      if (d > reach) continue;
      a.hp -= dmg * (1 - (d / reach) * 0.6);
      if (a.hp <= 0) this._destroyAsset(a, owner);
    }
  }

  _destroyAsset(a, by) {
    this.world.destroyAsset(a);
    this.destroyed.push(a.id);
    const T = ASSET_TYPES[a.type];
    // secondary explosions for fuel and ammunition
    const chain = a.type === 'fuel' || a.type === 'ammo' ? 4 : 2;
    for (let i = 0; i < chain; i++) {
      setTimeout(() => {
        if (!this.running) return;
        const ox = a.x + (Math.random() - 0.5) * a.r, oz = a.z + (Math.random() - 0.5) * a.r;
        super.explode(ox, a.y + 0.5, oz, 7, 120, by || null, true);
      }, 300 + i * 450);
    }
    this.fires.push({ x: a.x, y: a.y + 1, z: a.z, t: 240, r: a.r * 0.5, big: a.type === 'fuel' });
    if (this.cb.onAsset) this.cb.onAsset(a); // the war effort feels it immediately
    this.hud.message(`${a.primary ? '★ PRIMARY OBJECTIVE COMPLETE<br>' : ''}${T.label} destroyed<br><small>${T.effect}</small>${a.primary ? '<br><small>Get to the extraction point</small>' : ''}`, 5);
    audio.explosion(Math.hypot(a.x - this.camera.position.x, a.z - this.camera.position.z), 0, true);
    this.raiseAlarm({ team: 'axis', pos: { x: a.x, z: a.z } }, null);
  }

  // ---------- update ----------
  _modeUpdate(dt) {
    const w = this.world, p = this.player;
    // the live front on the flank
    if (this.frontActive && !this.frontOver) {
      this.commandT -= dt;
      if (this.commandT <= 0) { this.commandT = 3; this._commander('allies'); this._commander('axis'); this._spotting(); }
      this._reinforce(dt);
      this._bleed(dt);
      this._enemySupport(dt);
      if (this.tickets.allies <= 0 || this.tickets.axis <= 0) {
        this.frontOver = true;
        this.frontWinner = this.tickets.allies <= 0 ? 'axis' : 'allies';
        this.hud.message(this.frontWinner === 'allies' ? 'The Allied assault in the sector has broken through!' : 'The Allied assault in the sector has been thrown back.', 4);
      }
    } else if (this.commandT !== undefined) { this.commandT -= dt; if (this.commandT <= 0) { this.commandT = 2; this._spotting(); } }
    // dynamic navigation: the squad follows its leader, the enemy hunts the last known contact
    this.dynT = (this.dynT || 0) - dt;
    if (this.dynT <= 0) {
      this.dynT = 1.2;
      if (p.alive) w.updateDynamicTarget(this.followIdx, p.pos.x, p.pos.z);
      for (const b of this.bots) {
        if (b.alive && b.team === 'axis' && b.role !== 'front' && b.visible && b.target && (b.target.isPlayer || b.target.role === 'follow')) {
          this.alarmPos = { x: b.target.pos.x, z: b.target.pos.z }; break;
        }
      }
      if (this.alarmPos) w.updateDynamicTarget(this.huntIdx, this.alarmPos.x, this.alarmPos.z);
      // discovered assets
      for (const a of w.assets) if (!a.known && p.alive && Math.hypot(a.x - p.pos.x, a.z - p.pos.z) < 85) { a.known = true; if (!a.primary) this.hud.message(`Enemy ${ASSET_TYPES[a.type].label.toLowerCase()} spotted`, 2); }
    }
    // reaction force
    if (this.alarm && this.time > this.qrfT && this.reserve > 0) {
      this.qrfT = this.time + 110;
      const n = Math.min(6, this.reserve); this.reserve -= n;
      const sx = (this.alarmPos ? -Math.sign(this.alarmPos.x || 1) : 1) * (30 + Math.random() * 60);
      const sq = this._squad('axis', { role: 'qrf' });
      for (let i = 0; i < n; i++) { const b = this._bot('axis', GARRISON_CLS[i], sq, sx, -HALF + 14, 6); b.alert = true; }
      this.combatants = [...this.bots, this.player];
      this.hud.message('Enemy reaction force moving into the sector!', 3);
    }
    // demolition charges
    for (const c of this.charges) {
      c.t -= dt; c.beep -= dt;
      if (c.beep <= 0) { c.beep = c.t < 3 ? 0.25 : 0.8; if (Math.hypot(c.x - this.camera.position.x, c.z - this.camera.position.z) < 40) audio.click(); }
      if (c.t <= 0) {
        this.scene.remove(c.mesh); c.mesh.geometry.dispose();
        if (c.asset && c.asset.alive) c.asset.hp = 0, this._destroyAsset(c.asset, p);
        this.explode(c.x, c.y, c.z, 9, 260, p, true);
      }
    }
    this.charges = this.charges.filter((c) => c.t > 0);
    // burning wrecks
    this.fireT = (this.fireT || 0) - dt;
    if (this.fireT <= 0) {
      this.fireT = 0.12;
      for (const f of this.fires) {
        if ((f.t -= 0.12) <= 0) continue;
        const ox = f.x + (Math.random() - 0.5) * f.r, oz = f.z + (Math.random() - 0.5) * f.r;
        this.effects.fire.spawn(ox, f.y, oz, 0, 2 + Math.random() * 2, 0, 0.5 + Math.random() * 0.4, f.big ? 3 : 2, 1, 0.5, 0.15, 0.9, -1, 1.5, 0.5);
        this.effects.smoke.spawn(ox, f.y + 2, oz, (Math.random() - 0.5) * 0.6, 2.5, (Math.random() - 0.5) * 0.6, 6, 2.5, 0.12, 0.11, 0.1, 0.55, -0.15, 1.8, 0.2);
      }
      this.fires = this.fires.filter((f) => f.t > 0);
    }
    // prompts
    let prompt = '';
    if (p.alive) {
      const a = this._nearestAsset();
      if (a) prompt = `[F] Plant demolition charge — ${ASSET_TYPES[a.type].label}${p.satchels ? '' : ' (none left)'}`;
      if (Math.hypot(p.pos.x - w.exfil.x, p.pos.z - w.exfil.z) < w.exfil.radius) prompt = '[E] Extract the squad';
    }
    this.prompt = prompt;
    // player down → take over a surviving Ranger
    if (!p.alive && !this.over && this.time - (this.downT || 0) > 2 && this.downT) {
      const next = this.rangers.find((b) => b.alive);
      if (next) this._takeOver(next);
      else this.finish(false, 'The Ranger squad has been wiped out.');
      this.downT = 0;
    }
    if (!this.over && this.time >= this.timeLimit) this.finish(true, 'The operation window has closed; the squad withdraws.');
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
    const role = victim.squadRef ? victim.squadRef.role : null;
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
    if (victim.team === 'axis' && role && role !== 'front') this.garrisonDead++;
    if (victim.rosterIdx !== undefined) this.roster[victim.rosterIdx].alive = false;
    if (killer && killer.rosterIdx !== undefined) this.roster[killer.rosterIdx].kills++;
    if (killer && killer.isPlayer && this.roster[this.controlIdx]) this.roster[this.controlIdx].kills++;
    if (role && role !== 'front') {
      // mission troops don't spend front-line tickets
      victim.die();
      if (killer && killer !== victim) killer.kills++;
      if (killer && killer.isPlayer) this.stats.kills++;
      this.hud.kill(killer, victim, killer ? (killer._lastWeapon || (killer.w && killer.w.name) || '') : '', victim.killedByHead);
      if (victim.team === 'axis') this.noise(victim.pos, 25, { team: 'allies' });
      for (const b of this.bots) if (b.target === victim) { b.target = null; b.visible = false; }
      return;
    }
    super.onKill(victim, killer);
  }

  _reinforce(dt) {
    // only the front respawns; mission troops are finite
    this.respawnT -= dt;
    if (this.respawnT > 0) return;
    this.respawnT = 1.5;
    for (const team of ['allies', 'axis']) {
      const front = this.bots.filter((b) => b.team === team && !b.squadRef.role);
      const alive = front.filter((b) => b.alive).length;
      const maxAlive = Math.min(front.length, this.tickets[team]);
      const dead = front.filter((b) => !b.alive && b.deadT > 6);
      for (let k = 0; k < Math.min(maxAlive - alive, 3, dead.length); k++) this._spawnBot(dead[k]);
    }
  }

  // ---------- end ----------
  finish(extracted, reason) {
    if (this.over) return;
    this.over = true; this.extracted = extracted; this.reason = reason;
    document.exitPointerLock && document.exitPointerLock();
    this.player.mouse.left = false;
    setTimeout(() => this.cb.onEnd(this.result()), 1200);
  }
  end() {} // the front ending doesn't end the mission

  result() {
    const prim = this.world.assets.find((a) => a.primary);
    let front = null;
    if (this.cfg.front) {
      const fa = this.world.flags.filter((f) => f.owner === 'allies').length;
      const fx = this.world.flags.filter((f) => f.owner === 'axis').length;
      const al = this.tickets.allies / this.tickets0.allies, ax = this.tickets.axis / this.tickets0.axis;
      front = { battleId: this.cfg.front.battleId, bias: clamp((al - ax) * 0.8 + 0.08 * (fa - fx), -0.45, 0.45), winner: this.frontWinner };
    }
    const squad = this.roster.map((m) => ({ idx: m.idx, alive: m.alive, kills: m.kills }));
    return {
      mode: 'mission', region: this.cfg.regionIdx, primaryId: this.cfg.primaryId,
      primaryDone: !!(prim && !prim.alive), destroyed: [...this.destroyed],
      kills: this.garrisonDead + (this.frontActive ? 0 : 0), extracted: !!this.extracted, reason: this.reason,
      squad, front, stats: { ...this.stats }, time: this.time,
      winner: prim && !prim.alive ? 'allies' : 'axis', tickets: { ...this.tickets }, tickets0: { ...this.tickets0 },
    };
  }
  retreatResolve() {
    this.over = true; this.extracted = true; this.reason = 'The squad was pulled out on your order.';
    document.exitPointerLock && document.exitPointerLock();
    return this.result();
  }
}

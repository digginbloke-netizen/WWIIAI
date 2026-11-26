// Soldier models + bot AI.
import * as THREE from 'three';
import { WEAPONS, GRENADE } from './weapons.js';
import { clamp, angleDiff, pick } from '../util.js';
import { soldierGeometry } from './models.js';
import { photo } from './textures.js';

const NAMES = {
  allies: ['Miller', 'Johnson', 'Davis', 'Walsh', 'Kowalski', 'Russo', 'Baker', 'Carter', 'Hughes', 'Brennan', 'Ortiz', 'Fisher', 'Price', 'Doyle', 'Morgan', 'Hayes', 'Lindqvist', 'Novak', 'Reed', 'Tucker', 'Sullivan', 'Parker', 'Grant', 'Hale', 'Foster', 'Webb', 'Kane', 'Murphy', 'Ward', 'Ellis'],
  axis: ['Bauer', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Braun', 'Zimmer', 'Krüger', 'Hartmann', 'Lange', 'Werner', 'Krause', 'Vogel', 'Jäger', 'Roth', 'Lorenz', 'Kuhn', 'Brandt', 'Graf', 'Seidel', 'Haas', 'Dietrich', 'Sommer'],
};
const RANKS = { allies: ['Pvt.', 'Pvt.', 'Pfc.', 'Cpl.', 'Sgt.'], axis: ['Schtz.', 'Schtz.', 'Gefr.', 'Uffz.', 'Fw.'] };
export function soldierName(team) { return `${pick(RANKS[team])} ${pick(NAMES[team])}`; }

// ---------- shared model assets ----------
let ASSETS = null;
function assets() {
  if (ASSETS) return ASSETS;
  ASSETS = {
    marker: new THREE.MeshBasicMaterial({ color: 0x66bbff, transparent: true, opacity: 0.85, depthTest: false }),
    markerGeo: (() => { const g = new THREE.ConeGeometry(0.07, 0.14, 4); g.rotateX(Math.PI); return g; })(),
  };
  return ASSETS;
}

let SOLDIER_MAT = null;
export function buildSoldierModel(team, cls) {
  if (!SOLDIER_MAT) SOLDIER_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, map: photo('fabric', 'diff', { gray: 0.92, contrast: 0.7 }) });
  const G = soldierGeometry(team, cls);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hipY = 0.92;
  const mk = (g, parent, x, y, z) => { const m = new THREE.Mesh(g, SOLDIER_MAT); m.position.set(x, y, z); parent.add(m); return m; };
  const legL = mk(G.thigh, body, -0.1, hipY, 0), legR = mk(G.thigh, body, 0.1, hipY, 0);
  const shinL = mk(G.shin, legL, 0, -0.43, 0), shinR = mk(G.shin, legR, 0, -0.43, 0);
  const upper = mk(G.upper, body, 0, hipY, 0);
  upper.castShadow = true; legL.castShadow = true; legR.castShadow = true;
  const arms = mk(G.arms, upper, 0, 0.47, 0);
  const head = new THREE.Object3D();
  root.userData = { body, legL, legR, shinL, shinR, upper, head, arms };
  return root;
}

export function friendMarker() {
  const A = assets();
  const m = new THREE.Mesh(A.markerGeo, A.marker);
  m.renderOrder = 10;
  return m;
}

// ---------- AABB ray test for hit detection ----------
export function rayAABB(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (const k of ['x', 'y', 'z']) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < min[k] || o[k] > max[k]) return -1; continue; }
    let t1 = (min[k] - o[k]) / d[k], t2 = (max[k] - o[k]) / d[k];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmax < 0 ? -1 : Math.max(0, tmin);
}

const _v = new THREE.Vector3();

// ---------- Bot ----------
export class Bot {
  constructor(battle, team, cls) {
    this.b = battle;
    this.team = team; this.cls = cls;
    this.isPlayer = false;
    this.name = soldierName(team);
    this.w = WEAPONS[team][cls];
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.model = buildSoldierModel(team, cls);
    this.parts = this.model.userData;
    battle.scene.add(this.model);
    if (team === battle.playerTeam) { this.marker = friendMarker(); this.model.add(this.marker); this.marker.position.y = 2.1; }
    this.alive = false;
    this.kills = 0; this.deaths = 0;
    this.skill = 0.75 + Math.random() * 0.5;
  }

  spawn(x, z, squad) {
    this.pos.set(x, 0, z);
    this.pos.y = this.b.world.groundAt(x, z, 50);
    this.health = 100; this.alive = true;
    this.mag = this.w.mag; this.ammo = this.w.reserve;
    this.grenades = Math.random() < 0.35 ? 1 : 0;
    this.squad = squad;
    this.role = squad.role || 'front';
    this.alert = !(this.role === 'guard' || this.role === 'patrol' || this.role === 'captive');
    this.unarmed = this.role === 'captive';
    this.suspicion = 0;
    this.state = 'advance';
    this.target = null; this.lastSeen = null; this.lastSeenT = -99;
    this.think = Math.random() * 0.3;
    this.fireCd = 0; this.burst = 0; this.reloadT = 0;
    this.aimT = 0; this.suppress = 0; this.crouch = false; this.reactDelay = 0.6; this.visible = false;
    this.cover = null; this.holdPt = null; this.holdT = 0;
    this.stuckT = 0; this.lastPos = this.pos.clone(); this.sidestep = 0; this.sideDir = 1;
    this.lastHurt = -99; this.threat = null;
    this.deadT = 0; this.walkPhase = Math.random() * 6;
    this.grenadeCd = 15 + Math.random() * 25;
    this.strafeT = 0; this.strafeDir = 1; this.boundT = Math.random() * 3; this.bounding = true; this.push = false;
    this.model.visible = true;
    this.model.rotation.set(0, 0, 0);
    this.parts.body.position.set(0, 0, 0); this.parts.body.rotation.set(0, 0, 0);
    this.yaw = this.team === this.b.attTeam ? Math.PI : 0;
    if (this.b.world.attSign < 0) this.yaw += Math.PI;
    if (this.marker) this.marker.visible = true;
  }

  get moving() { return this.vel.lengthSq() > 0.5; }
  eyeY() { return this.pos.y + (this.crouch ? 1.15 : 1.62); }
  headPos(out = _v) { return out.set(this.pos.x, this.pos.y + (this.crouch ? 1.2 : 1.66), this.pos.z); }
  chestPos(out = _v) { return out.set(this.pos.x, this.pos.y + (this.crouch ? 0.95 : 1.3), this.pos.z); }
  // returns {t, head} or null
  rayHit(o, d) {
    const top = this.crouch ? 1.38 : 1.82;
    const t = rayAABB(o, d, { x: this.pos.x - 0.3, y: this.pos.y, z: this.pos.z - 0.3 }, { x: this.pos.x + 0.3, y: this.pos.y + top, z: this.pos.z + 0.3 });
    if (t < 0) return null;
    const hy = o.y + d.y * t;
    return { t, head: hy > this.pos.y + top - 0.3 };
  }

  damage(dmg, attacker, fromPos) {
    if (!this.alive) return;
    this.health -= dmg;
    this.lastHurt = this.b.time;
    this.suppress = Math.min(1, this.suppress + 0.5);
    if (!this.alert) { this.alert = true; if (this.b.raiseAlarm) this.b.raiseAlarm(this, fromPos || this.pos); }
    if (attacker && attacker.alive) {
      this.threat = attacker;
      if (!this.target || !this.target.alive) { this.lastSeen = attacker.pos.clone(); this.lastSeenT = this.b.time; }
    }
    if (this.health <= 0) this.b.onKill(this, attacker);
  }

  die() {
    this.alive = false; this.deadT = 0; this.deaths++;
    if (this.cover) { this.cover.occ = null; this.cover = null; }
    if (this.marker) this.marker.visible = false;
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
  }

  // --------- AI ---------
  update(dt) {
    const b = this.b;
    if (!this.alive) {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.45);
      this.parts.body.rotation.x = -this.fallDir * k * 1.45;
      this.parts.body.position.y = -k * 0.05;
      if (this.deadT > 20) this.model.visible = false;
      return;
    }
    this.suppress = Math.max(0, this.suppress - dt * 0.35);
    this.fireCd -= dt; this.grenadeCd -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = this._pendingMag || this.w.mag; }

    this.think -= dt;
    if (this.think <= 0) { this.think = 0.25 + Math.random() * 0.2; this._perceive(); this._decide(); }

    // ---- movement goal ----
    let goal = null; let speed = 3.7;
    const tgt = this.target && this.target.alive ? this.target : null;
    if (this.state === 'engage' && tgt) {
      const d = this.pos.distanceTo(tgt.pos);
      const ideal = this.cls === 'assault' ? 14 : this.cls === 'support' ? 45 : 35;
      if (this.cover && !this.coverReached) goal = this.cover;
      else if (this.push && this.suppress < 0.65) { goal = { flag: this.squad.obj }; speed = 3.3; }
      else if (d > ideal * 1.6 && this.suppress < 0.5) goal = { x: tgt.pos.x, z: tgt.pos.z, direct: d < 25 };
      else {
        // strafe while fighting if not in cover
        if (!this.coverReached && !this.crouch) {
          this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.5; this.strafeDir = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.4) this.strafeDir = 0; }
          if (this.strafeDir) {
            const ang = Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z) + this.strafeDir * Math.PI / 2;
            goal = { x: this.pos.x + Math.sin(ang) * 3, z: this.pos.z + Math.cos(ang) * 3, direct: true };
            speed = 2.2;
          }
        }
      }
      if (this.cover && !this.coverReached) speed = 4.6;
    } else if (this.state === 'retreat' && this.cover) {
      goal = this.cover; speed = 4.8;
    } else if (this.state === 'search' && this.lastSeen) {
      goal = { x: this.lastSeen.x, z: this.lastSeen.z, direct: false }; speed = 3.2;
    } else if (this.state === 'hold' && this.holdPt) {
      goal = this.holdPt; speed = 3.2;
    } else if (this.state === 'advance') {
      goal = this.navGoal || { flag: this.squad.obj };
      speed = this.navSpeed || 4.2;
    }

    let mx = 0, mz = 0;
    if (goal) {
      if (goal.flag !== undefined) {
        [mx, mz] = b.world.flowDir(this.pos.x, this.pos.z, goal.flag);
      } else {
        const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z, L = Math.hypot(dx, dz);
        if (L > 0.6) {
          if (!goal.direct && L > 6) {
            // use flowfield of nearest flag if goal near it, else direct
            const fi = this.squad.obj;
            const f = b.world.targets[fi];
            if (f && Math.hypot(goal.x - f.x, goal.z - f.z) < 15) [mx, mz] = b.world.flowDir(this.pos.x, this.pos.z, fi);
            else { mx = dx / L; mz = dz / L; }
          } else { mx = dx / L; mz = dz / L; }
        } else if (goal === this.cover) { this.coverReached = true; }
        else if (goal === this.holdPt) { this.holdReached = true; }
      }
    }
    // stuck handling
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      const s = this.sideDir;
      const nx = -mz * s, nz = mx * s;
      mx = mx * 0.2 + nx; mz = mz * 0.2 + nz;
      const L = Math.hypot(mx, mz) || 1; mx /= L; mz /= L;
    }
    // separation from nearby friends
    let sx = 0, sz = 0;
    for (const o of this.squad.members) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 2.5 && d2 > 1e-4) { sx += dx / d2; sz += dz / d2; }
    }
    if (mx || mz) { mx += sx * 0.4; mz += sz * 0.4; const L = Math.hypot(mx, mz) || 1; mx /= L; mz /= L; }

    const wantCrouch = (this.role === 'follow' && this.state !== 'engage' && this.b.player.crouch) || (this.state === 'engage' && (this.coverReached ? (this.cover && this.cover.low) : !goal) && this.suppress > 0.2) || (this.state === 'hold' && this.holdReached) || (this.state === 'engage' && !goal && this.cls === 'support');
    this.crouch = wantCrouch;
    if (this.crouch) speed *= 0.55;
    if (this.suppress > 0.6) speed *= 0.8;
    if (b.world.water && b.world.H(this.pos.x, this.pos.z) < -0.3) speed *= 0.6;
    const ax = mx * speed, az = mz * speed;
    const k = Math.min(1, dt * 8);
    this.vel.x += (ax - this.vel.x) * k; this.vel.z += (az - this.vel.z) * k;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    b.world.collide(this.pos, 0.35);
    const gy = b.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);

    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
      if ((mx || mz) && moved < 0.8 && this.sidestep <= 0) { this.sidestep = 0.8 + Math.random(); this.sideDir = Math.random() < 0.5 ? 1 : -1; }
      this.stuckT = 0; this.lastPos.copy(this.pos);
    }

    // ---- facing / aiming ----
    let faceYaw = this.yaw;
    if (tgt && this.state === 'engage') {
      faceYaw = Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
      const dy = (tgt.pos.y + 1.2) - this.eyeY();
      this.pitch = Math.atan2(dy, Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z));
    } else if (this.vel.lengthSq() > 0.3) { faceYaw = Math.atan2(this.vel.x, this.vel.z); this.pitch = 0; }
    else if (this.lastSeen && b.time - this.lastSeenT < 8) faceYaw = Math.atan2(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
    else if (this.state === 'hold') faceYaw = this.holdYaw ?? faceYaw;
    this.yaw += angleDiff(this.yaw, faceYaw) * Math.min(1, dt * 7);

    // ---- combat ----
    if (this.state === 'engage' && tgt && this.visible && !this.unarmed) {
      this.aimT += dt;
      if (this.reloadT <= 0 && this.mag <= 0) this._reload();
      else if (this.fireCd <= 0 && this.reloadT <= 0 && this.aimT > this.reactDelay && Math.abs(angleDiff(this.yaw, faceYaw)) < 0.3) this._shoot(tgt);
    } else this.aimT = Math.max(0, this.aimT - dt);
    if (this.reloadT <= 0 && this.mag < this.w.mag * 0.3 && (!tgt || !this.visible) && this.ammo > 0) this._reload();

    this._animate(dt);
  }

  _reload() {
    if (this.ammo <= 0) { this.ammo = this.w.reserve; } // bots get resupplied (keep fights going)
    this.reloadT = this.w.reload * (0.9 + Math.random() * 0.4);
    const n = Math.min(this.w.mag, this.ammo); this.ammo -= n; this.mag = 0;
    this._pendingMag = n;
  }

  _perceive() {
    const b = this.b;
    if (!this.alert) return this._perceiveCalm();
    const range = b.viewRange;
    const ex = this.pos.x, ez = this.pos.z, eyeY = this.eyeY();
    let best = null, bd = Infinity;
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const cands = [];
    for (const o of b.combatants) {
      if (!o.alive || o.team === this.team || o.role === 'captive' || o.hidden) continue;
      const dx = o.pos.x - ex, dz = o.pos.z - ez, d2 = dx * dx + dz * dz;
      if (d2 > range * range) continue;
      const d = Math.sqrt(d2);
      const alert = this.suppress > 0.1 || b.time - this.lastHurt < 3 || d < 12 || (o.firedT !== undefined && b.time - o.firedT < 0.6 && d < range * 0.8);
      if (!alert && (dx * fwdX + dz * fwdZ) / (d || 1) < -0.2) continue; // behind us
      let score = d;
      if (o === this.threat) score *= 0.5;
      if (o === this.target) score *= 0.7;
      if (o.isPlayer) score *= 0.9;
      // crouched/prone in cover is harder to spot at range
      if (o.crouch && d > 50) score *= 1.4;
      cands.push([score, o]);
    }
    cands.sort((a, c) => a[0] - c[0]);
    let checks = 0;
    for (const [s, o] of cands) {
      if (checks++ >= 3) break;
      const h = o.crouch ? 1.0 : 1.45;
      if (b.world.los(ex, eyeY, ez, o.pos.x, o.pos.y + h, o.pos.z)) { best = o; bd = s; break; }
    }
    void bd;
    const prev = this.target;
    this.visible = !!best;
    if (best) {
      if (best !== prev) { this.aimT = 0; this.reactDelay = b.diff.react * (0.6 + Math.random() * 0.8) / this.skill; }
      this.target = best; this.lastSeen = best.pos.clone(); this.lastSeenT = b.time;
    } else if (this.target && (!this.target.alive || b.time - this.lastSeenT > 6)) {
      this.target = null;
    }
  }

  // Unaware sentries: short sight, narrow field of view, need a moment to recognise a threat.
  _perceiveCalm() {
    const b = this.b;
    const range = Math.min(b.viewRange, 60);
    const ex = this.pos.x, ez = this.pos.z, eyeY = this.eyeY();
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let seen = null, sd = Infinity;
    for (const o of b.combatants) {
      if (!o.alive || o.team === this.team || o.role === 'captive' || o.hidden) continue;
      const dx = o.pos.x - ex, dz = o.pos.z - ez, d = Math.hypot(dx, dz);
      let rr = range * (o.crouch ? 0.55 : 1) * (o.moving ? 1 : 0.75);
      if (d > rr || d >= sd) continue;
      if (d > 5 && (dx * fx + dz * fz) / d < 0.35) continue;
      if (!b.world.los(ex, eyeY, ez, o.pos.x, o.pos.y + (o.crouch ? 1.0 : 1.45), o.pos.z)) continue;
      seen = o; sd = d;
    }
    this.visible = false;
    if (seen) {
      const rr = range * (seen.crouch ? 0.55 : 1);
      this.suspicion += (1.25 - sd / rr) * 0.45;
      this.holdYaw = Math.atan2(seen.pos.x - ex, seen.pos.z - ez);
      if (this.suspicion >= 1 || sd < 7) {
        this.alert = true; this.target = seen; this.visible = true; this.lastSeen = seen.pos.clone(); this.lastSeenT = b.time;
        this.aimT = 0; this.reactDelay = 0.6 + b.diff.react;
        if (b.raiseAlarm) b.raiseAlarm(this, seen.pos);
      }
    } else this.suspicion = Math.max(0, this.suspicion - 0.08);
  }

  // Non-combat movement for mission roles. Sets this.navGoal / navSpeed and returns the state.
  _roleMove() {
    const b = this.b, role = this.role, sq = this.squad;
    this.navGoal = null; this.navSpeed = 4.2;
    if (role === 'follow') {
      const p = b.player;
      if (b.squadHold && b.squadHoldPos) { this.navGoal = { x: b.squadHoldPos.x + this.slot[0], z: b.squadHoldPos.z + this.slot[1], direct: false }; this.navSpeed = 3.6; }
      else if (p.alive) {
        const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
        // slot offsets are relative to the leader's facing (behind and to the sides)
        const ox = this.slot[0] * c + this.slot[1] * sn, oz = -this.slot[0] * sn + this.slot[1] * c;
        const gx = p.pos.x + ox, gz = p.pos.z + oz;
        const d = Math.hypot(gx - this.pos.x, gz - this.pos.z);
        if (d < 1.8) return 'idle';
        this.navGoal = d > 14 ? { flag: b.followIdx } : { x: gx, z: gz, direct: true };
        this.navSpeed = d > 10 ? 5.2 : p.moving ? Math.max(2.2, Math.hypot(p.vel.x, p.vel.z) * 1.05) : 2.6;
      }
      return 'advance';
    }
    if (role === 'patrol' || role === 'fpatrol') {
      if (role === 'patrol' && this.alert && b.huntIdx !== undefined) { this.navGoal = { flag: b.huntIdx }; this.navSpeed = 4.0; return 'advance'; }
      const t = b.world.targets[sq.route[sq.leg % sq.route.length]];
      const lead = sq.members.find((m) => m.alive);
      if (lead === this && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < t.radius) sq.leg++;
      this.navGoal = { flag: sq.route[sq.leg % sq.route.length] };
      this.navSpeed = this.alert && role === 'patrol' ? 3.8 : 2.0;
      if (lead && lead !== this && Math.hypot(lead.pos.x - this.pos.x, lead.pos.z - this.pos.z) > 7) this.navSpeed = 3.2;
      return 'advance';
    }
    if (role === 'qrf') { this.navGoal = { flag: b.huntIdx }; this.navSpeed = 4.4; const t = b.world.targets[b.huntIdx]; if (Math.hypot(t.x - this.pos.x, t.z - this.pos.z) > 10) return 'advance'; }
    if (role === 'captive') return 'idle';
    if (role === 'assault') {
      // hidden objective: take and hold a position
      const t = b.world.targets[sq.obj];
      const d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
      if (d > t.radius * 0.8) { this.navGoal = { flag: sq.obj }; this.navSpeed = d > 60 ? 3.6 : 3.0; return 'advance'; }
    }
    // guards (and arrived QRF): hold around the objective target
    const tgt = role === 'qrf' ? b.world.targets[b.huntIdx] : b.world.targets[sq.obj];
    if (this.state !== 'hold' || !this.holdPt) this._pickHold(tgt);
    this.holdT -= 0.3;
    if (this.holdT <= 0) this._pickHold(tgt);
    return 'hold';
  }

  _decide() {
    const b = this.b;
    if (this.role !== 'front') return this._decideRole();
    const tgt = this.target && this.target.alive ? this.target : null;
    const flag = b.world.targets[this.squad.obj];
    const prevState = this.state;
    const hurt = this.health < 40 && b.time - this.lastHurt < 4;
    // fire-and-maneuver: alternate bounding forward and fixing the enemy with fire
    const df0 = Math.hypot(this.pos.x - flag.x, this.pos.z - flag.z);
    this.boundT -= 0.3;
    if (this.boundT <= 0) { this.bounding = !this.bounding; this.boundT = this.bounding ? 3 + Math.random() * 4 : 1.5 + Math.random() * 3; }
    const wasPush = this.push;
    this.push = flag.owner !== this.team && df0 > flag.radius * 0.6 && (this.bounding || this.cls === 'assault');
    if (this.push && !wasPush && this.cover) { this.cover.occ = null; this.cover = null; }
    if (tgt && this.visible && this.pos.distanceTo(tgt.pos) > this.w.range * 0.8 && !(this.threat === tgt)) {
      // out of effective range: keep moving
      this.visible = false;
    }
    if (tgt && this.visible) {
      this.state = 'engage';
      // grab cover when under fire or low hp
      if ((this.suppress > 0.35 || hurt || this.cls !== 'assault') && !this.cover && !this.push && Math.random() < 0.5) {
        const c = b.world.findCover(this.pos.x, this.pos.z, tgt.pos.x, tgt.pos.z, hurt ? 18 : 10, this);
        if (c) { this.cover = c; c.occ = this; this.coverReached = false; }
      }
      // grenade at clustered / dug-in enemies
      if (this.grenades > 0 && this.grenadeCd <= 0) {
        const d = this.pos.distanceTo(tgt.pos);
        if (d > 10 && d < 26 && tgt.crouch && Math.random() < 0.35) { this._throwGrenade(tgt.pos); }
      }
    } else if (hurt && this.threat && this.threat.alive) {
      this.state = 'retreat';
      if (!this.cover) {
        const c = b.world.findCover(this.pos.x, this.pos.z, this.threat.pos.x, this.threat.pos.z, 20, this);
        if (c) { this.cover = c; c.occ = this; this.coverReached = false; }
      }
    } else if (this.lastSeen && b.time - this.lastSeenT < 6 && this.pos.distanceTo(this.lastSeen) > 4 && this.pos.distanceTo(this.lastSeen) < 35 && this.suppress < 0.5 && !this.push) {
      this.state = 'search';
      if (this.grenades > 0 && this.grenadeCd <= 0 && b.time - this.lastSeenT < 3) {
        const d = this.pos.distanceTo(this.lastSeen);
        if (d > 10 && d < 24 && Math.random() < 0.15) this._throwGrenade(this.lastSeen);
      }
    } else {
      const df = Math.hypot(this.pos.x - flag.x, this.pos.z - flag.z);
      if (df < flag.radius + 4) {
        if (this.state !== 'hold' || !this.holdPt) this._pickHold(flag);
        this.state = 'hold';
        this.holdT -= 0.3;
        if (this.holdT <= 0) this._pickHold(flag);
      } else {
        this.state = 'advance';
      }
    }
    if (this.state !== 'engage' && this.state !== 'retreat' && this.cover) {
      if (prevState === 'engage' || this.state === 'advance') { this.cover.occ = null; this.cover = null; }
    }
    if (this.cover && tgt && this.coverReached) {
      // check cover still valid against current target
      const c = this.cover;
      const ex = tgt.pos.x - c.x, ez = tgt.pos.z - c.z, el = Math.hypot(ex, ez) || 1;
      if ((ex * c.nx + ez * c.nz) / el > -0.3) { c.occ = null; this.cover = null; }
    }
  }

  _decideRole() {
    const b = this.b;
    let tgt = this.target && this.target.alive ? this.target : null;
    const prevState = this.state;
    const hurt = this.health < 40 && b.time - this.lastHurt < 4;
    this.push = false;
    // Rangers hold fire while the squad is undetected unless the target is already fighting
    if (this.role === 'follow' && tgt) {
      // fire discipline: undetected, only shoot enemies that are already shooting at the squad;
      // detected, only fight what threatens the squad rather than distant battles
      const onSquad = tgt.target && (tgt.target.isPlayer || tgt.target.role === 'follow');
      const nearLeader = b.player.alive && Math.hypot(tgt.pos.x - b.player.pos.x, tgt.pos.z - b.player.pos.z) < 70;
      if (b.stealth ? !(tgt.alert && onSquad) : !(nearLeader || onSquad)) this.visible = false;
    }
    if (tgt && this.visible && this.pos.distanceTo(tgt.pos) > this.w.range * 0.8) this.visible = false;
    if (this.unarmed) this.visible = false;
    const leashed = this.role === 'follow' && b.player.alive && this.pos.distanceTo(b.player.pos) > 28;
    if (tgt && this.visible && !leashed) {
      this.state = 'engage';
      if ((this.suppress > 0.3 || hurt || this.cls !== 'assault') && !this.cover && Math.random() < 0.5) {
        const c = b.world.findCover(this.pos.x, this.pos.z, tgt.pos.x, tgt.pos.z, hurt ? 16 : 9, this);
        if (c) { this.cover = c; c.occ = this; this.coverReached = false; }
      }
      if (this.grenades > 0 && this.grenadeCd <= 0) {
        const d = this.pos.distanceTo(tgt.pos);
        if (d > 10 && d < 26 && tgt.crouch && Math.random() < 0.35) this._throwGrenade(tgt.pos);
      }
    } else if (hurt && this.threat && this.threat.alive && !leashed) {
      this.state = 'retreat';
      if (!this.cover) {
        const c = b.world.findCover(this.pos.x, this.pos.z, this.threat.pos.x, this.threat.pos.z, 18, this);
        if (c) { this.cover = c; c.occ = this; this.coverReached = false; }
      }
    } else if (this.alert && this.role !== 'follow' && this.lastSeen && b.time - this.lastSeenT < 10 && this.pos.distanceTo(this.lastSeen) > 4 && this.pos.distanceTo(this.lastSeen) < 60 && this.suppress < 0.5) {
      this.state = 'search';
    } else {
      this.state = this._roleMove();
    }
    if (this.state !== 'engage' && this.state !== 'retreat' && this.cover && prevState === 'engage') { this.cover.occ = null; this.cover = null; }
    if (this.cover && tgt && this.coverReached) {
      const c = this.cover;
      const ex = tgt.pos.x - c.x, ez = tgt.pos.z - c.z, el = Math.hypot(ex, ez) || 1;
      if ((ex * c.nx + ez * c.nz) / el > -0.3) { c.occ = null; this.cover = null; }
    }
  }

  _pickHold(flag) {
    const b = this.b;
    this.holdT = 6 + Math.random() * 10;
    this.holdReached = false;
    // face toward where the enemy comes from
    const enemySpawn = this.team === b.attTeam ? b.world.spawns.def : b.world.spawns.att;
    const tx = enemySpawn.x, tz = enemySpawn.z;
    this.holdYaw = Math.atan2(tx - flag.x, tz - flag.z) + (Math.random() - 0.5) * 1.2;
    if (Math.random() < 0.6) {
      const c = b.world.findCover(flag.x + (Math.random() - 0.5) * 8, flag.z + (Math.random() - 0.5) * 8, tx, tz, flag.radius + 2, this);
      if (c) { if (this.holdPt && this.holdPt.occ === this) this.holdPt.occ = null; c.occ = this; this.holdPt = c; return; }
    }
    const a = Math.random() * Math.PI * 2, r = Math.random() * flag.radius * 0.8;
    this.holdPt = { x: flag.x + Math.cos(a) * r, z: flag.z + Math.sin(a) * r };
  }

  _throwGrenade(at) {
    this.grenades--; this.grenadeCd = 25 + Math.random() * 20;
    const b = this.b;
    const o = new THREE.Vector3(this.pos.x, this.pos.y + 1.7, this.pos.z);
    const dx = at.x - o.x, dz = at.z - o.z, d = Math.hypot(dx, dz);
    const err = 1 + d * 0.08;
    const tx = at.x + (Math.random() - 0.5) * err, tz = at.z + (Math.random() - 0.5) * err;
    // 45 degree-ish lob
    const ddx = tx - o.x, ddz = tz - o.z, dd = Math.hypot(ddx, ddz);
    const v = Math.sqrt(dd * 9.8 / Math.sin(2 * 0.7)) * 0.95;
    const vel = new THREE.Vector3(ddx / dd * Math.cos(0.7) * v, Math.sin(0.7) * v, ddz / dd * Math.cos(0.7) * v);
    b.throwGrenade(o, vel, this);
  }

  _shoot(tgt) {
    const b = this.b, w = this.w;
    this.mag--;
    this.firedT = b.time;
    if (w.auto) {
      if (this.burst <= 0) this.burst = 3 + Math.floor(Math.random() * (this.cls === 'support' ? 8 : 5));
      this.burst--;
      this.fireCd = this.burst > 0 ? w.rof : 0.7 + Math.random() * 1.0;
    } else this.fireCd = Math.max(w.rof, 1.1 + Math.random() * 1.4);
    if (this.mag <= 0) this.fireCd = 0.1;
    // muzzle position (approx)
    const mx = this.pos.x + Math.sin(this.yaw) * 0.7 + Math.cos(this.yaw) * 0.05;
    const mz = this.pos.z + Math.cos(this.yaw) * 0.7 - Math.sin(this.yaw) * 0.05;
    const my = this.pos.y + (this.crouch ? 1.05 : 1.45);
    const d = Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
    // hit probability model
    let p = 0.26 * b.diff.acc * this.skill;
    const dc = d / (w.auto ? (this.cls === 'support' ? 70 : 40) : 85);
    p /= 1 + dc * dc;
    if (w.auto) p *= 0.55;
    if (tgt.crouch) p *= 0.6;
    if (tgt.moving) p *= 0.8;
    if (this.moving) p *= 0.5;
    p *= 1 - this.suppress * 0.6;
    p *= clamp(0.35 + this.aimT * 0.45, 0.35, 1.1);
    if (tgt.isPlayer) p *= b.diff.dmgToPlayer; else p *= 0.32; // bot-vs-bot fights are slower, keeping the battle alive
    const hit = Math.random() < p;
    const head = hit && Math.random() < 0.12;
    const ty = tgt.pos.y + (head ? (tgt.crouch ? 1.2 : 1.65) : (tgt.crouch ? 0.8 : 1.15));
    let tx = tgt.pos.x, tz = tgt.pos.z, aimY = ty;
    if (!hit) {
      const m = 0.6 + Math.random() * 1.8;
      const a = Math.random() * Math.PI * 2;
      tx += Math.cos(a) * m; tz += Math.sin(a) * m * 0.4; aimY += (Math.random() - 0.3) * m;
    }
    // trace the bullet against world geometry
    const dx = tx - mx, dy = aimY - my, dz = tz - mz;
    const L = Math.hypot(dx, dy, dz);
    const ux = dx / L, uy = dy / L, uz = dz / L;
    const reach = hit ? L - 0.3 : L + 40;
    const wt = b.world.raycast(mx, my, mz, ux, uy, uz, reach);
    const blocked = wt !== Infinity;
    const endT = blocked ? wt : (hit ? L : reach);
    const ex = mx + ux * endT, ey = my + uy * endT, ez = mz + uz * endT;
    b.effects.muzzle(mx, my, mz, this.cls === 'support');
    if (Math.random() < 0.55 || this.cls !== 'assault') b.effects.tracer(mx, my, mz, ex, ey, ez);
    b.sound(w.sound, this.pos);
    if (this.role !== 'front' && b.noise) b.noise(this.pos, 75, this);
    if (blocked) b.effects.impact(ex, ey, ez, b.world.lastHit === 'terrain' ? 'dirt' : 'stone');
    else if (hit) {
      let dmg = w.dmg * (head ? 2.2 : 1) * (0.85 + Math.random() * 0.3);
      if (d > w.range * 0.6) dmg *= 0.8;
      b.effects.blood(tx, ty, tz);
      tgt.damage(dmg, this, this.pos);
    } else {
      b.effects.impact(ex, Math.max(ey, b.world.H(ex, ez)), ez, 'dirt');
      if (tgt.suppress !== undefined) tgt.suppress = Math.min(1, tgt.suppress + 0.15);
    }
    // near-miss feedback for the player
    b.bulletNear(mx, my, mz, ux, uy, uz, endT, this);
  }

  _animate(dt) {
    const P = this.parts;
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * sp * 2.4;
    const sw = Math.min(1, sp / 3.5);
    const ph = this.walkPhase;
    let hip, tL, tR, kL, kR, lean;
    if (this.crouch) {
      // kneeling: left foot planted forward, right knee on the ground
      const step = Math.sin(ph) * sw * 0.35;
      hip = 0.54; tL = -1.35 + step; kL = 1.35 - step; tR = -0.15 - step; kR = 1.75; lean = 0.22;
    } else {
      const amp = 0.55 * sw + 0.02;
      tL = Math.sin(ph) * amp; tR = -Math.sin(ph) * amp;
      kL = Math.max(0, -Math.sin(ph + 0.9)) * 1.1 * sw + 0.08; kR = Math.max(0, Math.sin(ph + 0.9)) * 1.1 * sw + 0.08;
      hip = 0.92 - Math.abs(Math.cos(ph)) * 0.035 * sw - (sw > 0.9 ? 0.03 : 0);
      lean = sp > 3.8 ? 0.22 : 0.06 + sw * 0.06;
    }
    const k = Math.min(1, dt * 14);
    P.legL.rotation.x += (tL - P.legL.rotation.x) * k; P.legR.rotation.x += (tR - P.legR.rotation.x) * k;
    P.shinL.rotation.x += (kL - P.shinL.rotation.x) * k; P.shinR.rotation.x += (kR - P.shinR.rotation.x) * k;
    P.legL.position.y = P.legR.position.y = P.upper.position.y = P.upper.position.y + (hip - P.upper.position.y) * k;
    P.upper.rotation.x += (lean - P.upper.rotation.x) * k;
    P.upper.rotation.y = Math.sin(ph) * 0.08 * sw;
    const aim = -this.pitch * 0.9 - P.upper.rotation.x + (this.reloadT > 0 ? 0.6 : (this.state === 'engage' ? 0 : (sp > 3.8 ? 0.7 : 0.35)));
    P.arms.rotation.x += (aim - P.arms.rotation.x) * k;
  }

}

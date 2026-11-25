// Soldier models + bot AI.
import * as THREE from 'three';
import { WEAPONS, GRENADE } from './weapons.js';
import { clamp, angleDiff, pick } from '../util.js';

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
  const L = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w, h, d, y = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y, 0); return g; };
  const helmetUS = new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); helmetUS.scale(1, 0.85, 1.05);
  const brimUS = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12);
  const helmetDE = new THREE.SphereGeometry(0.165, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); helmetDE.scale(1, 1, 1.08);
  const skirtDE = new THREE.CylinderGeometry(0.17, 0.205, 0.1, 12, 1, true);
  ASSETS = {
    leg: box(0.17, 0.86, 0.2, -0.43),
    boot: box(0.18, 0.12, 0.27, -0.84),
    torso: box(0.48, 0.62, 0.28, 0),
    belt: box(0.5, 0.07, 0.3, -0.25),
    pack: box(0.36, 0.38, 0.14, 0),
    head: box(0.21, 0.24, 0.23, 0),
    arm: box(0.13, 0.55, 0.14, -0.26),
    rifle: box(0.06, 0.08, 1.0, 0),
    smg: box(0.07, 0.12, 0.62, 0),
    mag: box(0.04, 0.16, 0.05, -0.1),
    helmetUS, brimUS, helmetDE, skirtDE,
    mats: {
      allies: { uni: L(0x6b6544), pants: L(0x5e5a3e), helmet: L(0x4d5434), gear: L(0x7d7350) },
      axis: { uni: L(0x5b6166), pants: L(0x4f5458), helmet: L(0x484d48), gear: L(0x2e2a24) },
      skin: L(0xc99a78), boot: L(0x2a2018), wood: L(0x5a3e26), metal: L(0x25262a),
    },
    marker: new THREE.MeshBasicMaterial({ color: 0x66bbff, transparent: true, opacity: 0.85, depthTest: false }),
    markerGeo: (() => { const g = new THREE.ConeGeometry(0.07, 0.14, 4); g.rotateX(Math.PI); return g; })(),
  };
  return ASSETS;
}

// Merge simple geometries (with transforms + flat colors) into one vertex-colored geometry.
function mergeParts(parts) {
  const pos = [], nrm = [], col = [];
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (const p of parts) {
    let g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    o.position.set(...(p.p || [0, 0, 0])); o.rotation.set(...(p.r || [0, 0, 0])); o.scale.set(...(p.s || [1, 1, 1]));
    o.updateMatrix(); g.applyMatrix4(o.matrix);
    c.setHex(p.c);
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const COLORS = {
  allies: { uni: 0x6b6544, pants: 0x5e5a3e, helmet: 0x4d5434, gear: 0x7d7350 },
  axis: { uni: 0x5b6166, pants: 0x4f5458, helmet: 0x484d48, gear: 0x2e2a24 },
  skin: 0xc99a78, boot: 0x2a2018, wood: 0x5a3e26, metal: 0x25262a,
};
const GEO_CACHE = {};
let SOLDIER_MAT = null;
function soldierGeos(team, cls) {
  const key = team + cls;
  if (GEO_CACHE[key]) return GEO_CACHE[key];
  const A = assets(), M = COLORS[team], S = COLORS;
  const leg = mergeParts([{ g: A.leg, c: M.pants }, { g: A.boot, c: S.boot, p: [0, 0, 0.03] }]);
  const up = [
    { g: A.torso, c: M.uni, p: [0, 0.3, 0] }, { g: A.belt, c: M.gear, p: [0, 0.3, 0] }, { g: A.pack, c: M.gear, p: [0, 0.36, -0.2] },
    { g: A.head, c: S.skin, p: [0, 0.76, 0] },
  ];
  if (team === 'allies') up.push({ g: A.helmetUS, c: M.helmet, p: [0, 0.82, 0] }, { g: A.brimUS, c: M.helmet, p: [0, 0.825, 0] });
  else up.push({ g: A.helmetDE, c: M.helmet, p: [0, 0.83, 0] }, { g: A.skirtDE, c: M.helmet, p: [0, 0.8, -0.01] });
  const upper = mergeParts(up);
  const gunG = cls === 'assault' ? A.smg : A.rifle;
  const gunC = cls === 'assault' && team === 'axis' ? S.metal : S.wood;
  const arm = [
    { g: A.arm, c: M.uni, p: [-0.27, 0, 0.05], r: [-1.2, 0, 0.25] },
    { g: A.arm, c: M.uni, p: [0.24, 0, 0], r: [-1.0, 0, -0.1] },
    { g: gunG, c: gunC, p: [0.05, -0.12, 0.42] },
  ];
  if (cls === 'support') arm.push({ g: A.mag, c: S.metal, p: [0.05, team === 'axis' ? -0.17 : 0, 0.52], s: team === 'axis' ? [2, 0.6, 2] : [1, 1, 1] });
  if (cls === 'assault') arm.push({ g: A.mag, c: S.metal, p: [0.05, -0.2, 0.47] });
  const arms = mergeParts(arm);
  return (GEO_CACHE[key] = { leg, upper, arms });
}

export function buildSoldierModel(team, cls) {
  if (!SOLDIER_MAT) SOLDIER_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
  const G = soldierGeos(team, cls);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hipY = 0.9;
  const legL = new THREE.Mesh(G.leg, SOLDIER_MAT); legL.position.set(-0.11, hipY, 0); body.add(legL);
  const legR = new THREE.Mesh(G.leg, SOLDIER_MAT); legR.position.set(0.11, hipY, 0); body.add(legR);
  const upper = new THREE.Mesh(G.upper, SOLDIER_MAT); upper.position.set(0, hipY + 0.05, 0); body.add(upper);
  upper.castShadow = true;
  const arms = new THREE.Mesh(G.arms, SOLDIER_MAT); arms.position.set(0, 0.55, 0); upper.add(arms);
  const head = new THREE.Object3D();
  root.userData = { body, legL, legR, upper, head, arms };
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
    const flag = b.world.flags[this.squad.obj];
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
      goal = { flag: this.squad.obj }; speed = 4.2;
      // squad cohesion: slow down if far ahead of leader
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
            const f = b.world.flags[fi];
            if (Math.hypot(goal.x - f.x, goal.z - f.z) < 15) [mx, mz] = b.world.flowDir(this.pos.x, this.pos.z, fi);
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

    const wantCrouch = (this.state === 'engage' && (this.coverReached ? (this.cover && this.cover.low) : !goal) && this.suppress > 0.2) || (this.state === 'hold' && this.holdReached) || (this.state === 'engage' && !goal && this.cls === 'support');
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
    if (this.state === 'engage' && tgt && this.visible) {
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
    const range = b.viewRange;
    const ex = this.pos.x, ez = this.pos.z, eyeY = this.eyeY();
    let best = null, bd = Infinity;
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const cands = [];
    for (const o of b.combatants) {
      if (!o.alive || o.team === this.team) continue;
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

  _decide() {
    const b = this.b;
    const tgt = this.target && this.target.alive ? this.target : null;
    const flag = b.world.flags[this.squad.obj];
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
    this.walkPhase += dt * sp * 2.6;
    const sw = Math.min(1, sp / 3) * 0.7;
    if (this.crouch) {
      P.upper.position.y = 0.55; P.legL.position.y = 0.5; P.legR.position.y = 0.5;
      P.legL.rotation.x = -1.3 + Math.sin(this.walkPhase) * sw * 0.4; P.legR.rotation.x = -0.2 - Math.sin(this.walkPhase) * sw * 0.4;
      P.upper.rotation.x = 0.25;
    } else {
      P.upper.position.y = 0.95; P.legL.position.y = 0.9; P.legR.position.y = 0.9;
      P.legL.rotation.x = Math.sin(this.walkPhase) * sw; P.legR.rotation.x = -Math.sin(this.walkPhase) * sw;
      P.upper.rotation.x = sp > 3.5 ? 0.2 : 0.05;
    }
    P.arms.rotation.x = -this.pitch * 0.8 + (this.reloadT > 0 ? 0.5 : (this.state === 'engage' ? 0 : 0.35));
    P.head.rotation.x = -this.pitch * 0.5;
  }
}

// First-person player: controller, weapon handling and view model.
import * as THREE from 'three';
import { WEAPONS, CLASSES } from './weapons.js';
import { rayAABB } from './soldier.js';
import { viewModelGroups } from './models.js';
import { photo } from './textures.js';
import { clamp } from '../util.js';
import { audio } from '../audio.js';

const _d = new THREE.Vector3();

function buildViewModel(team, cls) {
  const g = new THREE.Group();
  const G = viewModelGroups(team, cls);
  const add = (geo, mat) => { if (!geo) return; const m = new THREE.Mesh(geo, mat); m.renderOrder = 5; g.add(m); };
  const woodMap = photo('planks', 'diff');
  add(G.wood, new THREE.MeshStandardMaterial({ map: woodMap, normalMap: photo('planks', 'nor'), color: woodMap ? 0xc89a70 : 0x6a4527, roughness: 0.55, metalness: 0 }));
  add(G.metal, new THREE.MeshStandardMaterial({ color: 0x2d3034, roughness: 0.32, metalness: 0.85 }));
  add(G.cloth, new THREE.MeshLambertMaterial({ vertexColors: true, map: photo('fabric', 'diff', { gray: 0.9, contrast: 0.8 }) }));
  add(G.skin, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 5), new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.scale.set(1, 1, 2.4);
  flash.position.copy(G.muzzle).add(new THREE.Vector3(0, 0, -0.04));
  flash.visible = false; g.add(flash);
  g.userData.flash = flash;
  g.userData.sightY = G.sightY;
  return g;
}

export class Player {
  constructor(battle, camera) {
    this.b = battle; this.cam = camera;
    this.team = battle.playerTeam;
    this.isPlayer = true;
    this.name = 'You';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.alive = false;
    this.kills = 0; this.deaths = 0;
    this.keys = {};
    this.mouse = { left: false, right: false };
    this.sens = parseFloat(localStorage.getItem('rtb.sens') || '1');
    this.light = new THREE.PointLight(0xffbb66, 0, 12, 2);
    camera.add(this.light);
    this.vmRoot = new THREE.Group(); camera.add(this.vmRoot);
    this.crouch = false;
    this.suppress = 0;
    this.firedT = -9;
  }

  get moving() { return Math.hypot(this.vel.x, this.vel.z) > 1; }
  eyeY() { return this.pos.y + (this.crouchAmt ? 1.65 - this.crouchAmt * 0.6 : 1.65); }
  headPos(out = _d) { return out.set(this.pos.x, this.pos.y + (this.crouch ? 1.15 : 1.62), this.pos.z); }
  rayHit(o, d) {
    const top = this.crouch ? 1.3 : 1.8;
    const t = rayAABB(o, d, { x: this.pos.x - 0.3, y: this.pos.y, z: this.pos.z - 0.3 }, { x: this.pos.x + 0.3, y: this.pos.y + top, z: this.pos.z + 0.3 });
    return t < 0 ? null : { t, head: o.y + d.y * t > this.pos.y + top - 0.3 };
  }

  spawn(x, z, cls) {
    this.cls = cls;
    this.w = WEAPONS[this.team][cls];
    this.pos.set(x, this.b.world.groundAt(x, z, 50), z);
    this.vel.set(0, 0, 0);
    this.health = 100; this.alive = true;
    this.mag = this.w.mag; this.ammo = this.w.reserve;
    this.grenades = CLASSES[cls].grenades;
    this.reloadT = 0; this.fireCd = 0; this.bloom = 0; this.recoil = 0; this.kick = 0;
    this.crouch = false; this.crouchAmt = 0; this.ads = 0; this.stamina = 1; this.lastHurt = -99;
    this.deadT = 0; this.onGround = true; this.semiReady = true; this.bob = 0;
    // face toward the enemy side
    const att = this.team === this.b.attTeam;
    this.yaw = (att ? 0 : Math.PI) + (this.b.world.attSign < 0 ? Math.PI : 0);
    this.pitch = 0;
    this.vmRoot.clear();
    this.vm = buildViewModel(this.team, cls);
    this.vmRoot.add(this.vm);
    this.vmRoot.visible = true;
  }

  onMouseMove(e) {
    if (!this.alive) return;
    const s = 0.0022 * this.sens * (this.ads > 0.5 ? 0.6 : 1);
    this.yaw -= e.movementX * s;
    this.pitch = clamp(this.pitch - e.movementY * s, -1.5, 1.5);
  }

  damage(dmg, attacker, fromPos) {
    if (!this.alive) return;
    this.health -= dmg;
    this.lastHurt = this.b.time;
    audio.hurt();
    if (fromPos) this.b.hud.damageFrom(Math.atan2(fromPos.x - this.pos.x, fromPos.z - this.pos.z) - this.yaw - Math.PI);
    if (this.health <= 0) this.b.onKill(this, attacker);
  }
  die() {
    this.alive = false; this.deaths++; this.deadT = 0;
    this.vmRoot.visible = false;
    this.light.intensity = 0;
  }

  update(dt) {
    const b = this.b, w = this.w, K = this.keys;
    if (!this.alive) {
      this.deadT += dt;
      const y = this.pos.y + Math.max(0.3, 1.6 - this.deadT * 3);
      this.cam.position.set(this.pos.x, y, this.pos.z);
      this.cam.rotation.set(this.pitch, this.yaw, Math.min(0.9, this.deadT * 2), 'YXZ');
      return;
    }
    this.suppress = Math.max(0, this.suppress - dt * 0.5);
    // regen
    if (b.time - this.lastHurt > 6 && this.health < 100) this.health = Math.min(100, this.health + dt * 8);

    // ---- movement ----
    const fwd = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
    const str = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
    this.crouch = !!(K.KeyC || K.ControlLeft);
    this.crouchAmt += ((this.crouch ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 10);
    this.ads += ((this.mouse.right && this.reloadT <= 0 ? 1 : 0) - this.ads) * Math.min(1, dt * 12);
    const sprint = K.ShiftLeft && fwd > 0 && !this.crouch && this.ads < 0.3 && this.stamina > 0.05;
    let speed = this.crouch ? 2.1 : sprint ? 6.6 : 4.3;
    if (this.ads > 0.5) speed = Math.min(speed, 2.6);
    if (b.world.water && b.world.H(this.pos.x, this.pos.z) < -0.3) speed *= 0.6;
    this.stamina = clamp(this.stamina + (sprint && (fwd || str) ? -dt * 0.18 : dt * 0.25), 0, 1);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // camera looks down -Z at yaw 0: forward = (-sin, -cos)
    let mx = -sy * fwd + cy * str, mz = -cy * fwd - sy * str;
    const L = Math.hypot(mx, mz); if (L > 0) { mx /= L; mz /= L; }
    const acc = this.onGround ? 12 : 2;
    this.vel.x += (mx * speed - this.vel.x) * Math.min(1, dt * acc);
    this.vel.z += (mz * speed - this.vel.z) * Math.min(1, dt * acc);
    if (K.Space && this.onGround && !this.crouch) { this.vel.y = 6.0; this.onGround = false; }
    this.vel.y -= 20 * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.pos.y += this.vel.y * dt;
    b.world.collide(this.pos, 0.35, this.crouch ? 1.2 : 1.8);
    const g = b.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= g) {
      if (this.pos.y < g - 0.01 && g - this.pos.y < 0.7) this.pos.y += (g - this.pos.y) * Math.min(1, dt * 18); // step smoothing
      else this.pos.y = g;
      if (this.pos.y < g - 0.7) this.pos.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > g + 0.05) this.onGround = this.pos.y - g < 0.06;
    if (this.onGround && this.pos.y > g && this.pos.y - g < 0.25 && this.vel.y <= 0) this.pos.y = g;

    // ---- weapon ----
    this.fireCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 2.5);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.kick *= Math.pow(0.0005, dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const need = w.mag - this.mag, n = Math.min(need, this.ammo); this.mag += n; this.ammo -= n; }
    }
    if (K.KeyR && this.reloadT <= 0 && this.mag < w.mag && this.ammo > 0) this.startReload();
    if (!this.mouse.left) this.semiReady = true;
    if (this.mouse.left && this.fireCd <= 0 && this.reloadT <= 0 && (w.auto || this.semiReady) && !sprint) {
      if (this.mag > 0) this.shoot();
      else { if (this.semiReady) audio.click(); this.semiReady = false; if (this.ammo > 0) this.startReload(); }
    }

    // ---- camera ----
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround) this.bob += dt * sp * 1.9;
    const bobY = Math.sin(this.bob * 2) * 0.035 * Math.min(1, sp / 4) * (1 - this.ads * 0.8);
    const eye = this.pos.y + 1.65 - this.crouchAmt * 0.6 + bobY;
    this.cam.position.set(this.pos.x, eye, this.pos.z);
    const sh = this.suppress * 0.006;
    this.cam.rotation.set(this.pitch + this.kick + (Math.random() - 0.5) * sh, this.yaw + (Math.random() - 0.5) * sh, 0, 'YXZ');
    const fov = 75 - this.ads * (this.cls === 'rifleman' ? 27 : 18);
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }

    // ---- view model ----
    const vm = this.vm;
    const hip = [0.115, -0.15, -0.33], ads = [0, -vm.userData.sightY, -0.09];
    const a = this.ads;
    const swayX = Math.sin(this.bob) * 0.012 * Math.min(1, sp / 4) * (1 - a);
    const swayY = Math.abs(Math.cos(this.bob)) * 0.01 * Math.min(1, sp / 4) * (1 - a);
    vm.position.set(hip[0] + (ads[0] - hip[0]) * a + swayX, hip[1] + (ads[1] - hip[1]) * a - swayY + (sprint ? -0.05 : 0), hip[2] + (ads[2] - hip[2]) * a + this.recoil * 0.035);
    let rx = this.recoil * 0.12, ry = 0, rz = 0;
    if (this.reloadT > 0) { const t = 1 - this.reloadT / w.reload; const k = Math.sin(Math.min(1, t) * Math.PI); rx -= k * 0.7; rz += k * 0.4; vm.position.y -= k * 0.05; }
    if (sprint) { ry = 0.5; rx -= 0.2; }
    vm.rotation.set(rx, ry + 0.07 * (1 - a), rz + 0.04 * (1 - a));
    const fl = vm.userData.flash;
    if (fl.visible && b.time - this.firedT > 0.04) { fl.visible = false; this.light.intensity = 0; }
  }

  startReload() {
    if (this.reloadT > 0) return;
    this.reloadT = this.w.reload;
    audio.reload();
  }

  shoot() {
    const b = this.b, w = this.w;
    this.mag--; this.semiReady = false;
    this.fireCd = w.rof;
    this.firedT = b.time;
    const moving = Math.hypot(this.vel.x, this.vel.z) / 4.3;
    let spread = w.spread + w.moveSpread * Math.min(1, moving) + this.bloom * 0.02 + (this.onGround ? 0 : 0.06);
    spread *= (1 - this.ads * 0.65) * (this.crouch ? 0.75 : 1);
    if (this.ads < 0.5) spread += 0.008;
    const dir = new THREE.Vector3();
    this.cam.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, this.cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    const origin = this.cam.position.clone();
    b.playerShot(origin, dir, this);
    this.bloom = Math.min(1.5, this.bloom + (w.auto ? 0.25 : 0.6));
    this.recoil = 1;
    const kickAmt = w.recoil * (this.crouch ? 0.7 : 1) * (1 - this.ads * 0.3);
    this.pitch = Math.min(1.5, this.pitch + kickAmt * (0.6 + Math.random() * 0.4));
    this.yaw += (Math.random() - 0.5) * kickAmt * 0.5;
    this.kick += kickAmt * 0.3;
    const fl = this.vm.userData.flash; fl.visible = true; fl.rotation.z = Math.random() * 3;
    this.light.intensity = 25;
    audio.gunshot(w.sound, 0, 0);
    if (this.mag === 0 && this.ammo > 0 && !w.auto) setTimeout(() => this.alive && this.startReload(), 250);
  }

  muzzleWorld(out) {
    const fl = this.vm.userData.flash;
    return fl.getWorldPosition(out);
  }
}

// Particles, tracers, explosions, decals, weather.
import * as THREE from 'three';

const VS = `
#include <fog_pars_vertex>
attribute float alpha; attribute float size; attribute vec3 color;
varying float vA; varying vec3 vC;
uniform float scale;
void main(){
  vA = alpha; vC = color;
  vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = size * scale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `
#include <fog_pars_fragment>
varying float vA; varying vec3 vC;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d,d);
  if (r > 0.25) discard;
  float a = vA * smoothstep(0.25, 0.05, r);
  gl_FragColor = vec4(vC, a);
  #include <fog_fragment>
}`;

class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 600 } }]),
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, fog: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
    this.geo = g;
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, grav = 0, grow = 0, drag = 0) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.a0[i] = a; this.alpha[i] = a;
    this.grav[i] = grav; this.grow[i] = grow; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      const dr = 1 - this.drag[i] * dt;
      this.vel[k] *= dr; this.vel[k + 2] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.life[i] <= 0 ? 0 : this.a0[i] * Math.min(1, t * 2.5);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.alpha.needsUpdate = a.size.needsUpdate = a.color.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, world, camera) {
    this.scene = scene; this.world = world; this.camera = camera;
    this.smoke = new Particles(scene, 2500, false);
    this.fire = new Particles(scene, 1200, true);
    // tracers
    this.maxTr = 160;
    this.trPos = new Float32Array(this.maxTr * 6);
    this.tr = Array.from({ length: this.maxTr }, () => ({ on: false }));
    this.trNext = 0;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trGeo = tg;
    const tl = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    tl.frustumCulled = false; scene.add(tl);
    // flash lights pool
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 30, 1.6);
      scene.add(l); this.lights.push({ l, t: 0 });
    }
    // decals
    this.decals = [];
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x15120e, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decalGeo = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    this.weather = null;
  }

  tracer(sx, sy, sz, ex, ey, ez) {
    const dx = ex - sx, dy = ey - sy, dz = ez - sz, L = Math.hypot(dx, dy, dz);
    if (L < 3) return;
    const t = this.tr[this.trNext]; const idx = this.trNext; this.trNext = (this.trNext + 1) % this.maxTr;
    Object.assign(t, { on: true, sx, sy, sz, dx: dx / L, dy: dy / L, dz: dz / L, L, d: 1.5, idx });
  }
  muzzle(x, y, z, big = false) {
    this.fire.spawn(x, y, z, 0, 0.5, 0, 0.05, big ? 1.6 : 1.1, 1, 0.75, 0.35, 1);
    this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 0.5, 0.6, (Math.random() - 0.5) * 0.5, 0.8, 0.5, 0.6, 0.6, 0.6, 0.25, 0, 1.2, 1);
  }
  impact(x, y, z, kind = 'dirt') {
    const snow = this.world.cfg.winter || this.world.cfg.weather === 'snow';
    const c = kind === 'stone' ? [0.6, 0.58, 0.55] : snow && kind === 'dirt' ? [0.9, 0.92, 0.95] : kind === 'water' ? [0.75, 0.82, 0.88] : [0.42, 0.36, 0.28];
    for (let i = 0; i < 4; i++) this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 2, Math.random() * 3 + (kind === 'water' ? 3 : 1), (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.4, 0.35 + Math.random() * 0.2, c[0], c[1], c[2], 0.8, 6, 0.8, 2);
  }
  blood(x, y, z) {
    for (let i = 0; i < 6; i++) this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5, 0.4 + Math.random() * 0.3, 0.18 + Math.random() * 0.15, 0.5, 0.04, 0.04, 0.9, 9, 0.2, 1);
  }
  explosion(x, y, z, big = false) {
    const s = big ? 1.6 : 1;
    for (let i = 0; i < 26 * s; i++) {
      const a = Math.random() * 6.28, sp = Math.random() * 7 * s;
      this.fire.spawn(x, y + 0.5, z, Math.cos(a) * sp, Math.random() * 6 * s, Math.sin(a) * sp, 0.25 + Math.random() * 0.3, 2 + Math.random() * 2 * s, 1, 0.55 + Math.random() * 0.3, 0.2, 1, 0, 3, 3);
    }
    for (let i = 0; i < 30 * s; i++) {
      const a = Math.random() * 6.28, sp = Math.random() * 4 * s;
      const g = 0.18 + Math.random() * 0.15;
      this.smoke.spawn(x, y + 0.5, z, Math.cos(a) * sp, Math.random() * 5 * s + 1, Math.sin(a) * sp, 2 + Math.random() * 2.5, 2 + Math.random() * 2 * s, g, g * 0.95, g * 0.9, 0.75, -0.3, 2.2, 1.2);
    }
    for (let i = 0; i < 24 * s; i++) {
      const a = Math.random() * 6.28, sp = 3 + Math.random() * 7;
      this.smoke.spawn(x, y + 0.3, z, Math.cos(a) * sp, 5 + Math.random() * 9, Math.sin(a) * sp, 1.2 + Math.random() * 0.6, 0.25 + Math.random() * 0.3, 0.28, 0.22, 0.16, 1, 14, 0, 0.2);
    }
    const L = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    L.l.position.set(x, y + 2, z); L.t = 0.35; L.l.intensity = big ? 220 : 140;
    // scorch decal
    const d = new THREE.Mesh(this.decalGeo, this.decalMat);
    d.position.set(x, this.world.H(x, z) + 0.06, z); d.scale.setScalar(big ? 3.2 : 2.2);
    this.scene.add(d); this.decals.push(d);
    if (this.decals.length > 40) this.scene.remove(this.decals.shift());
  }
  smokeMarker(x, y, z, color = [0.8, 0.3, 0.3]) {
    for (let i = 0; i < 4; i++) this.smoke.spawn(x + (Math.random() - 0.5), y + 0.3, z + (Math.random() - 0.5), (Math.random() - 0.5), 1.5 + Math.random(), (Math.random() - 0.5), 3, 1.5, color[0], color[1], color[2], 0.6, -0.2, 1.5, 0.5);
  }

  setWeather(kind) {
    if (kind !== 'rain' && kind !== 'snow') return;
    const n = kind === 'rain' ? 2500 : 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: kind === 'rain' ? 0xaabbcc : 0xffffff, size: kind === 'rain' ? 0.06 : 0.12, transparent: true, opacity: kind === 'rain' ? 0.55 : 0.9, depthWrite: false });
    const p = new THREE.Points(g, m); p.frustumCulled = false;
    this.scene.add(p);
    this.weather = { p, pos, n, speed: kind === 'rain' ? 22 : 2.2, kind };
  }

  update(dt) {
    this.smoke.update(dt); this.fire.update(dt);
    // tracers
    for (const t of this.tr) {
      const k = t.idx * 6;
      if (!t.on) continue;
      t.d += dt * 520;
      if (t.d - 4 > t.L) { t.on = false; this.trPos.fill(0, k, k + 6); continue; }
      const a = Math.max(0, t.d - 4), b = Math.min(t.L, t.d);
      this.trPos[k] = t.sx + t.dx * a; this.trPos[k + 1] = t.sy + t.dy * a; this.trPos[k + 2] = t.sz + t.dz * a;
      this.trPos[k + 3] = t.sx + t.dx * b; this.trPos[k + 4] = t.sy + t.dy * b; this.trPos[k + 5] = t.sz + t.dz * b;
    }
    this.trGeo.attributes.position.needsUpdate = true;
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity *= Math.pow(0.002, dt); if (L.t <= 0) L.l.intensity = 0; } }
    if (this.weather) {
      const w = this.weather, c = this.camera.position;
      for (let i = 0; i < w.n; i++) {
        const k = i * 3;
        w.pos[k + 1] -= w.speed * dt * (0.8 + (i % 5) * 0.1);
        if (w.kind === 'snow') { w.pos[k] += Math.sin(i + w.pos[k + 1] * 0.5) * dt * 0.5; }
        if (w.pos[k + 1] < c.y - 10) { w.pos[k + 1] = c.y + 20; w.pos[k] = c.x + (Math.random() - 0.5) * 60; w.pos[k + 2] = c.z + (Math.random() - 0.5) * 60; }
      }
      w.p.geometry.attributes.position.needsUpdate = true;
    }
  }
}

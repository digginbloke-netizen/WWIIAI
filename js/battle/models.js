// Organic low-poly models: soldiers, firearms, foliage, props.
// Everything is merged into vertex-colored geometry so each soldier stays a handful of draw calls.
import * as THREE from 'three';
import { buildGun, GUN_COLORS } from './guns.js';

const _o = new THREE.Object3D();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// parts: [{ g, c, p?, r?, s?, m? }] -> single non-indexed geometry with vertex colors
export function mergeParts(parts) {
  const pos = [], nrm = [], col = [], uvs = [];
  for (const p of parts) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    if (p.m) g.applyMatrix4(p.m);
    else {
      _o.position.set(...(p.p || [0, 0, 0])); _o.rotation.set(...(p.r || [0, 0, 0])); _o.scale.set(...(p.s || [1, 1, 1]));
      _o.updateMatrix(); g.applyMatrix4(_o.matrix);
    }
    _c.setHex(p.c);
    const P = g.attributes.position, N = g.attributes.normal, VC = p.keepColor ? g.attributes.color : null, UV = g.attributes.uv;
    const us = p.uvScale || 1;
    const jit = p.jitter || 0;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      if (UV) uvs.push(UV.getX(i) * us, UV.getY(i) * us); else uvs.push(P.getX(i) + P.getZ(i), P.getY(i));
      const k = jit ? 1 + (Math.sin(i * 12.9898 + P.getY(i) * 78.233) * 0.5) * jit : 1;
      if (VC) col.push(VC.getX(i), VC.getY(i), VC.getZ(i));
      else col.push(_c.r * k, _c.g * k, _c.b * k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}

// ---------- primitive helpers ----------
const capCache = {};
function capsule(r, len, rs = 8) {
  const k = `${r}|${len}|${rs}`;
  return capCache[k] || (capCache[k] = new THREE.CapsuleGeometry(r, len, 3, rs));
}
// A capsule spanning two points
function limb(a, b, r, c, rs = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A), L = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  return { g: capsule(r, Math.max(0.01, L), rs), c, m };
}
function sphere(r, ws = 10, hs = 7) { return new THREE.SphereGeometry(r, ws, hs); }
function cylX(r1, r2, len, seg = 8) { const g = new THREE.CylinderGeometry(r1, r2, len, seg); g.rotateX(Math.PI / 2); return g; } // along Z
function roundBox(w, h, d, r = 0.008) {
  const s = new THREE.Shape();
  const x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y);
  s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, h / 2, x, h / 2); s.lineTo(-x, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -d / 2);
  return g;
}
// 2D side profile (x = forward along the gun, y = up) extruded to thickness `w`; result points down -Z.
function profile(pts, w, bevel = 0.006) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: w - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(w - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // shape +x -> world -z (forward)
  return g;
}
const at = (g, x, y, z) => { const c = g.clone(); c.translate(x, y, z); return c; };

// ---------- soldiers ----------
export const UNIFORM = {
  allies: { uni: 0x8f855a, pants: 0x7d7452, helmet: 0x666d47, gear: 0xa89a6c, boot: 0x5e4430 },
  axis: { uni: 0x7d847f, pants: 0x6c7270, helmet: 0x5d625c, gear: 0x3b342c, boot: 0x2a2520 },
};
const SKIN = 0xc99a78;

function helmet(team) {
  const pts = team === 'allies'
    ? [[0, 0.118], [0.05, 0.114], [0.09, 0.096], [0.118, 0.062], [0.132, 0.02], [0.136, -0.008], [0.152, -0.02], [0.156, -0.026]]
    : [[0, 0.122], [0.05, 0.118], [0.09, 0.1], [0.117, 0.066], [0.128, 0.024], [0.13, -0.01], [0.142, -0.045], [0.16, -0.075]];
  // rim first so the lathe's faces point outward
  const g = new THREE.LatheGeometry(pts.slice().reverse().map(([x, y]) => new THREE.Vector2(x, y)), 14);
  g.scale(1, 1, 1.1);
  return g;
}

const cache = {};
// Returns { thigh, shin, upper, arms } geometries for a team/class.
export function soldierGeometry(team, cls) {
  const key = team + cls;
  if (cache[key]) return cache[key];
  const U = UNIFORM[team];
  // legs hang from a hip pivot; shins hang from a knee pivot 0.43 below
  const thigh = mergeParts([{ g: capsule(0.082, 0.3), c: U.pants, p: [0, -0.215, 0], jitter: 0.06 }]);
  const shinParts = [{ g: capsule(0.068, 0.3), c: U.pants, p: [0, -0.2, 0], jitter: 0.06 }];
  if (team === 'allies') shinParts.push({ g: capsule(0.074, 0.1), c: 0x8a7a5a, p: [0, -0.3, 0] }); // leggings
  else shinParts.push({ g: capsule(0.072, 0.14), c: U.boot, p: [0, -0.3, 0] }); // jackboots
  shinParts.push({ g: capsule(0.062, 0.14), c: U.boot, p: [0, -0.42, 0.045], r: [Math.PI / 2, 0, 0], s: [1.05, 1, 0.75] });
  const shin = mergeParts(shinParts);
  // upper body, pivot at hips
  const up = [
    { g: capsule(0.14, 0.1), c: U.pants, p: [0, 0.04, 0], r: [0, 0, Math.PI / 2], s: [1, 1, 0.8] },
    { g: capsule(0.165, 0.26), c: U.uni, p: [0, 0.3, 0], s: [1.15, 1, 0.72], jitter: 0.05 },
    { g: new THREE.CylinderGeometry(0.175, 0.175, 0.055, 14), c: U.gear, p: [0, 0.14, 0], s: [1.08, 1, 0.75] },
    { g: sphere(0.075), c: U.uni, p: [-0.2, 0.47, 0] }, { g: sphere(0.075), c: U.uni, p: [0.2, 0.47, 0] },
    { g: new THREE.CylinderGeometry(0.048, 0.055, 0.09, 8), c: SKIN, p: [0, 0.56, 0.0] },
    { g: sphere(0.103, 12, 9), c: SKIN, p: [0, 0.665, 0.01], s: [0.92, 1.08, 1] },
    { g: new THREE.ConeGeometry(0.018, 0.04, 5), c: SKIN, p: [0, 0.66, 0.11], r: [Math.PI / 2, 0, 0] },
    { g: sphere(0.012, 6, 4), c: 0x2a2420, p: [-0.035, 0.685, 0.093] }, { g: sphere(0.012, 6, 4), c: 0x2a2420, p: [0.035, 0.685, 0.093] },
    { g: new THREE.BoxGeometry(0.05, 0.006, 0.01), c: 0x8a5a48, p: [0, 0.625, 0.098] },
    { g: helmet(team), c: U.helmet, p: [0, team === 'allies' ? 0.69 : 0.685, 0] },
    // webbing straps over the shoulders
    { g: new THREE.BoxGeometry(0.035, 0.36, 0.012), c: U.gear, p: [-0.1, 0.32, 0.125], r: [0.08, 0, -0.08] },
    { g: new THREE.BoxGeometry(0.035, 0.36, 0.012), c: U.gear, p: [0.1, 0.32, 0.125], r: [0.08, 0, 0.08] },
    // ammo pouches on the belt
    { g: roundBox(0.08, 0.07, 0.04, 0.01), c: U.gear, p: [-0.11, 0.17, 0.13] },
    { g: roundBox(0.08, 0.07, 0.04, 0.01), c: U.gear, p: [0.11, 0.17, 0.13] },
  ];
  if (team === 'allies') {
    up.push({ g: roundBox(0.26, 0.24, 0.1, 0.03), c: U.gear, p: [0, 0.36, -0.15] }); // pack
    up.push({ g: new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), c: 0x55603a, p: [0.15, 0.1, -0.09] }); // canteen
  } else {
    up.push({ g: roundBox(0.16, 0.12, 0.07, 0.02), c: 0x5a5a40, p: [-0.15, 0.12, -0.08] }); // bread bag
    up.push({ g: new THREE.CylinderGeometry(0.055, 0.055, 0.22, 10), c: 0x4a5048, p: [0.08, 0.2, -0.15] }); // gas-mask canister
    up.push({ g: roundBox(0.07, 0.13, 0.04, 0.015), c: 0x2a241f, p: [-0.06, 0.36, -0.14] }); // entrenching tool
  }
  const upper = mergeParts(up);
  // arms + weapon in firing pose, pivot at shoulder height (0.47 above hips)
  const gun = buildGun(team, cls);
  const grip = [0.075, -0.12, 0.33];
  // gun model faces -Z; soldiers face +Z: rotate 180 degrees, then put its grip in the right hand
  const rot = (v) => [-v[0], v[1], -v[2]];
  const gr = rot(gun.grip), T = [grip[0] - gr[0], grip[1] - gr[1], grip[2] - gr[2]];
  const fr = rot(gun.fore), fore = [fr[0] + T[0], fr[1] + T[1] - 0.015, fr[2] + T[2]];
  const arms = [
    limb([0.2, 0, 0], [0.24, -0.22, 0.12], 0.06, U.uni), limb([0.24, -0.22, 0.12], grip, 0.05, U.uni),
    limb([-0.2, 0, 0], [-0.16, -0.24, 0.24], 0.06, U.uni), limb([-0.16, -0.24, 0.24], fore, 0.05, U.uni),
    { g: sphere(0.042, 8, 6), c: SKIN, p: [grip[0], grip[1] - 0.01, grip[2]] },
    { g: sphere(0.042, 8, 6), c: SKIN, p: fore },
  ];
  const gm = new THREE.Matrix4().makeRotationY(Math.PI).premultiply(new THREE.Matrix4().makeTranslation(...T));
  for (const p of gun.parts) arms.push({ g: p.g, c: GUN_COLORS[p.mat] ?? 0x333333, m: gm });
  const armsG = mergeParts(arms);
  return (cache[key] = { thigh, shin, upper, arms: armsG });
}

// ---------- foliage & props ----------
function displace(g, amp, freq, seed = 1) {
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * freq + seed) * Math.cos(v.y * freq * 1.3 + seed * 2) * Math.sin(v.z * freq * 0.9 + seed * 3);
    v.multiplyScalar(1 + n * amp);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
export function blobGeometry(detail = 1, seed = 1, amp = 0.28) {
  return displace(new THREE.IcosahedronGeometry(1, detail), amp, 3.1, seed);
}
export function pineGeometry() {
  const parts = [];
  const tiers = [[1.9, 2.4, 2.4], [1.5, 2.1, 3.7], [1.05, 1.8, 4.9], [0.6, 1.3, 5.9]];
  tiers.forEach(([r, h, y], i) => {
    const g = displace(new THREE.ConeGeometry(r, h, 9, 2), 0.12, 2.5, i + 1);
    parts.push({ g, c: [0x2c4a2a, 0x2f4f2c, 0x34552f, 0x3a5c33][i], p: [0, y, 0], jitter: 0.12 });
  });
  return mergeParts(parts);
}
export function oakGeometry() {
  const parts = [];
  const blobs = [[0, 5.2, 0, 2.1], [1.3, 4.6, 0.4, 1.5], [-1.2, 4.7, -0.3, 1.6], [0.3, 4.4, 1.3, 1.4], [-0.4, 4.5, -1.3, 1.4], [0.2, 6.2, 0.1, 1.4]];
  blobs.forEach(([x, y, z, r], i) => parts.push({ g: blobGeometry(1, i * 1.7 + 1, 0.22), c: [0x3f5e2a, 0x46672e, 0x3a5726][i % 3], p: [x, y, z], s: [r, r * 0.85, r], jitter: 0.15 }));
  // a couple of visible branches
  parts.push({ g: new THREE.CylinderGeometry(0.07, 0.12, 1.8, 5), c: 0x4a3a2a, p: [0.6, 4.0, 0.2], r: [0, 0, -0.8] });
  parts.push({ g: new THREE.CylinderGeometry(0.07, 0.12, 1.8, 5), c: 0x4a3a2a, p: [-0.5, 4.0, -0.2], r: [0.2, 0, 0.8] });
  return mergeParts(parts);
}
export function trunkGeometry() {
  const g = new THREE.CylinderGeometry(0.16, 0.3, 1, 7, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 3) * 0.03); }
  g.computeVertexNormals();
  g.translate(0, 0.5, 0);
  return g;
}
export function grassTexture(color = '#5d7a3a') {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 4 + Math.random() * 56, h = 30 + Math.random() * 32, lean = (Math.random() - 0.5) * 18;
    g.strokeStyle = `hsl(${78 + Math.random() * 20},${30 + Math.random() * 20}%,${22 + Math.random() * 20}%)`;
    g.lineWidth = 1.5 + Math.random() * 1.5;
    g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function grassGeometry() {
  const a = new THREE.PlaneGeometry(1, 0.6); a.translate(0, 0.3, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const c = a.clone(); c.rotateY(Math.PI / 4);
  const g = new THREE.BufferGeometry();
  const merged = [a, b, c].map((x) => x.toNonIndexed());
  const cat = (k, n) => { const arr = []; for (const m of merged) arr.push(...m.attributes[k].array); return new THREE.Float32BufferAttribute(arr, n); };
  g.setAttribute('position', cat('position', 3));
  g.setAttribute('uv', cat('uv', 2));
  // point normals up so the tufts light like the ground beneath them
  const n = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}
export function sandbagGeometry() {
  const g = new THREE.SphereGeometry(1, 8, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // flatten into a pillow: squash top/bottom, keep ends round
    const y = p.getY(i); p.setY(i, Math.sign(y) * Math.pow(Math.abs(y), 1.6));
  }
  g.computeVertexNormals();
  return g;
}
export function tankWreckGeometry(intact = false) {
  const D = intact ? 0x8a7d52 : 0x3b3b33, R = intact ? 0x3a3a34 : 0x4a3428, T = intact ? 0x2e2e2a : 0x2a2a26;
  const hull = new THREE.Shape([[-3.1, 0.5], [-2.6, 0.0], [2.5, 0.0], [3.2, 0.6], [2.7, 1.25], [-2.8, 1.25]].map(([x, y]) => new THREE.Vector2(x, y)));
  const hg = new THREE.ExtrudeGeometry(hull, { depth: 2.5, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  hg.translate(0, 0, -1.25);
  const parts = [{ g: hg, c: D, jitter: 0.2 }];
  for (const s of [-1, 1]) {
    parts.push({ g: roundBox(6.0, 0.7, 0.45, 0.25), c: T, p: [0, 0.35, s * 1.38] });
    for (let k = 0; k < 6; k++) parts.push({ g: new THREE.CylinderGeometry(0.32, 0.32, 0.12, 10), c: R, p: [-2.2 + k * 0.9, 0.35, s * 1.62], r: [Math.PI / 2, 0, 0] });
  }
  const tur = new THREE.LatheGeometry([[0, 0], [1.15, 0], [1.2, 0.3], [1.0, 0.75], [0, 0.78]].map(([x, y]) => new THREE.Vector2(x, y)), 12);
  parts.push({ g: tur, c: D, p: [-0.2, 1.25, 0], jitter: 0.2 });
  const barrel = new THREE.CylinderGeometry(0.08, 0.1, 3.0, 8); barrel.rotateZ(Math.PI / 2); barrel.translate(1.5, 0, 0);
  parts.push({ g: barrel, c: T, p: [0.6, 1.6, 0], r: [0, 0.3, -0.15] });
  return mergeParts(parts);
}

// ---------- enemy assets (local coords: +z faces the Allied side) ----------
const FG = 0x5c615c, DG = 0x8a7d52, CRATE = 0x5a4a30, OLIVE = 0x4a5233;
function wheel(r, w, c, x, y, z) { return { g: new THREE.CylinderGeometry(r, r, w, 12), c, p: [x, y, z], r: [0, 0, Math.PI / 2] }; }
function howitzer(x, z) {
  const P = [];
  P.push(wheel(0.62, 0.16, 0x2a2a26, x - 0.85, 0.62, z), wheel(0.62, 0.16, 0x2a2a26, x + 0.85, 0.62, z));
  P.push({ g: new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6), c: FG, p: [x, 0.62, z], r: [0, 0, Math.PI / 2] });
  P.push({ g: roundBox(1.7, 1.0, 0.06, 0.04), c: FG, p: [x, 1.15, z + 0.25], r: [-0.15, 0, 0] });
  const barrel = new THREE.CylinderGeometry(0.075, 0.09, 2.9, 10); barrel.rotateX(Math.PI / 2 - 0.38); barrel.translate(0, 0.55, 1.3);
  P.push({ g: barrel, c: FG, p: [x, 0.85, z] });
  P.push({ g: roundBox(0.32, 0.3, 1.4, 0.05), c: FG, p: [x, 1.05, z + 0.1], r: [-0.38, 0, 0] });
  P.push({ g: roundBox(0.16, 0.14, 2.6, 0.03), c: FG, p: [x - 0.35, 0.35, z - 1.4], r: [0.18, 0.18, 0] });
  P.push({ g: roundBox(0.16, 0.14, 2.6, 0.03), c: FG, p: [x + 0.35, 0.35, z - 1.4], r: [0.18, -0.18, 0] });
  for (let k = 0; k < 3; k++) P.push({ g: roundBox(0.6, 0.25, 0.4, 0.03), c: CRATE, p: [x + 1.6, 0.13 + k * 0.26, z - 1.0] });
  return P;
}
function truck(x, z, ry) {
  const P = [];
  const m = new THREE.Matrix4().makeRotationY(ry).premultiply(new THREE.Matrix4().makeTranslation(x, 0, z));
  const add = (g, c, px, py, pz, rx = 0, rz = 0) => { _o.position.set(px, py, pz); _o.rotation.set(rx, 0, rz); _o.scale.set(1, 1, 1); _o.updateMatrix(); P.push({ g, c, m: m.clone().multiply(_o.matrix) }); };
  add(roundBox(2.1, 0.5, 6.2, 0.05), 0x2a2a26, 0, 0.75, 0);
  add(roundBox(2.0, 1.2, 1.5, 0.15), DG, 0, 1.55, 2.0);           // cab
  add(roundBox(1.4, 0.8, 1.3, 0.12), DG, 0, 1.3, 3.3);            // hood
  add(new THREE.BoxGeometry(1.8, 0.5, 0.05), 0x334455, 0, 1.85, 2.76); // windscreen
  add(roundBox(2.2, 0.6, 3.6, 0.04), DG, 0, 1.3, -1.0);           // bed
  const canopy = new THREE.CylinderGeometry(1.1, 1.1, 3.6, 12, 1, false, -Math.PI / 2, Math.PI); canopy.rotateX(Math.PI / 2);
  add(canopy, 0x6a6a48, 0, 1.6, -1.0);
  for (const zz of [2.6, -0.6, -2.0]) for (const xx of [-1.0, 1.0]) add(new THREE.CylinderGeometry(0.48, 0.48, 0.3, 12), 0x1e1e1c, xx, 0.48, zz, 0, Math.PI / 2);
  return P;
}
// Returns { parts, boxes: [[x0,z0,x1,z1,h]], r }
export function truckGeometry() { return mergeParts(truck(0, 0, 0)); }
export function assetModel(type) {
  const P = [], B = [];
  if (type === 'artillery') {
    P.push(...howitzer(-5, 0), ...howitzer(5, 0));
    B.push([-6.1, -2.8, -3.9, 1.6, 1.6], [3.9, -2.8, 6.1, 1.6, 1.6]);
    return { parts: P, boxes: B, r: 8 };
  }
  if (type === 'flak') {
    P.push({ g: roundBox(7, 0.3, 0.6, 0.05), c: FG, p: [0, 0.2, 0] }, { g: roundBox(0.6, 0.3, 7, 0.05), c: FG, p: [0, 0.2, 0] });
    P.push({ g: new THREE.CylinderGeometry(0.45, 0.6, 1.2, 12), c: FG, p: [0, 0.9, 0] });
    P.push({ g: roundBox(1.0, 0.7, 1.6, 0.08), c: FG, p: [0, 1.7, -0.2] });
    const b = new THREE.CylinderGeometry(0.09, 0.12, 5.6, 10); b.rotateX(Math.PI / 2 - 0.62); b.translate(0, 1.6, 2.2);
    P.push({ g: b, c: FG, p: [0, 1.7, 0] });
    P.push({ g: roundBox(2.2, 1.3, 0.06, 0.04), c: FG, p: [0, 1.9, 0.8], r: [-0.12, 0, 0] });
    for (let k = 0; k < 4; k++) P.push({ g: roundBox(0.9, 0.3, 0.45, 0.03), c: CRATE, p: [-2.4, 0.15 + (k % 2) * 0.31, -2 + (k >> 1) * 0.5] });
    B.push([-1.2, -1.2, 1.2, 1.2, 2.4]);
    return { parts: P, boxes: B, r: 5 };
  }
  if (type === 'fuel') {
    const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.88, 12);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) for (let l = 0; l < ((i + j) % 3 === 0 ? 2 : 1); l++) {
      P.push({ g: drum, c: (i * 3 + j) % 5 === 0 ? 0x6a3a22 : 0x3e4a34, p: [-5 + i * 0.66, 0.44 + l * 0.9, -1 + j * 0.66] });
    }
    P.push(...truck(3.5, 0, Math.PI / 2 * 0));
    const tank = new THREE.CylinderGeometry(1.0, 1.0, 3.4, 14); tank.rotateX(Math.PI / 2);
    P.push({ g: tank, c: 0x4a4a40, p: [3.5, 2.1, -1.0] });
    B.push([-5.4, -1.4, -2.6, 0.7, 1.9], [2.4, -3.2, 4.6, 3.4, 2.8]);
    return { parts: P, boxes: B, r: 7 };
  }
  if (type === 'ammo') {
    const piles = [[-3, -1], [1.5, -2], [0, 2.5]];
    for (const [px, pz] of piles) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (let l = 0; l < 3 - j; l++) {
      P.push({ g: roundBox(0.95, 0.42, 0.55, 0.03), c: (i + l) % 2 ? CRATE : OLIVE, p: [px - 1 + i * 1.0, 0.22 + l * 0.43, pz - 0.3 + j * 0.6], jitter: 0.1 });
    }
    // camouflage net on poles
    for (const [px, pz] of [[-5, -4], [4, -4], [-5, 5], [4, 5]]) P.push({ g: new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), c: 0x4a3a2a, p: [px, 1.3, pz] });
    const net = new THREE.PlaneGeometry(10, 10, 8, 8); net.rotateX(-Math.PI / 2);
    const np = net.attributes.position; for (let i = 0; i < np.count; i++) np.setY(i, -Math.abs(Math.sin(np.getX(i) * 0.6) * Math.cos(np.getZ(i) * 0.5)) * 0.6);
    net.computeVertexNormals();
    P.push({ g: net, c: 0x4a5a33, p: [-0.5, 2.6, 0.5], jitter: 0.3 });
    B.push([-4.6, -1.7, -1.4, -0.1, 1.4], [-0.1, -2.7, 3.1, -1.1, 1.4], [-1.6, 1.8, 1.6, 3.4, 1.4]);
    return { parts: P, boxes: B, r: 7, net: true };
  }
  if (type === 'radio') {
    P.push({ g: roundBox(5, 2.6, 4, 0.08), c: 0x7a7060, p: [0, 1.3, 0], jitter: 0.08 });
    const roof = new THREE.CylinderGeometry(0.01, 3.6, 1.2, 4); roof.rotateY(Math.PI / 4); roof.scale(1, 1, 0.82);
    P.push({ g: roof, c: 0x4e4a48, p: [0, 3.2, 0] });
    P.push({ g: new THREE.BoxGeometry(1.0, 1.9, 0.08), c: 0x3a2a20, p: [0, 0.95, 2.01] });
    P.push({ g: new THREE.CylinderGeometry(0.06, 0.1, 15, 6), c: 0x55555a, p: [4.0, 7.5, -1.5] });
    for (let k = 0; k < 4; k++) P.push({ g: new THREE.BoxGeometry(1.6 - k * 0.3, 0.05, 0.05), c: 0x55555a, p: [4.0, 9 + k * 1.6, -1.5] });
    P.push({ g: roundBox(1.2, 0.9, 0.8, 0.06), c: FG, p: [3.0, 0.45, 1.5] });
    B.push([-2.5, -2, 2.5, 2, 3.8], [2.4, 1.1, 3.6, 1.9, 0.9]);
    return { parts: P, boxes: B, r: 6, mast: [4.0, -1.5] };
  }
  if (type === 'trucks') {
    P.push(...truck(-4, 0, 0), ...truck(0, 0.5, 0.05), ...truck(4.2, -0.3, -0.05));
    B.push([-5.1, -3.1, -2.9, 4.0, 2.6], [-1.1, -2.6, 1.1, 4.5, 2.6], [3.1, -3.4, 5.3, 3.7, 2.6]);
    return { parts: P, boxes: B, r: 8 };
  }
  if (type === 'tank') {
    const tg = tankWreckGeometry(true);
    P.push({ g: tg, c: 0xffffff, p: [-3, 0, 0], r: [0, Math.PI / 2, 0], keepColor: true });
    P.push({ g: tg, c: 0xffffff, p: [3.4, 0, 0.8], r: [0, Math.PI / 2 + 0.1, 0], keepColor: true });
    B.push([-4.6, -3.2, -1.4, 3.2, 2.2], [1.8, -2.4, 5.0, 4.0, 2.2]);
    return { parts: P, boxes: B, r: 7 };
  }
  // ---- strategic targets (raid missions) ----
  const BRICK = 0x7a4a38, STEELG = 0x4a4e4c, SOOT = 0x2c2a28, CONC = 0x8a8880;
  if (type === 'hall') {
    P.push({ g: roundBox(18, 8, 11, 0.1), c: BRICK, p: [0, 4, 0], jitter: 0.08 });
    for (let k = 0; k < 4; k++) { // sawtooth roof
      const g = new THREE.CylinderGeometry(0.01, 2.6, 2.2, 3); g.rotateZ(Math.PI / 2); g.scale(1, 1, 3.9);
      P.push({ g, c: 0x55585a, p: [-6.75 + k * 4.5, 9, 0], r: [0, 0, -0.3] });
    }
    P.push({ g: roundBox(5, 5, 0.3, 0.05), c: 0x3a3226, p: [0, 2.5, 5.55] });
    P.push({ g: new THREE.CylinderGeometry(0.7, 0.9, 20, 10), c: BRICK, p: [7, 10, -3.5] });
    B.push([-9, -5.5, 9, 5.5, 10], [6.2, -4.3, 7.8, -2.7, 20]);
    return { parts: P, boxes: B, r: 11 };
  }
  if (type === 'boiler') {
    P.push({ g: roundBox(7, 4, 5, 0.1), c: BRICK, p: [0, 2, 0], jitter: 0.08 });
    const tank = new THREE.CylinderGeometry(1.5, 1.5, 6, 14); tank.rotateZ(Math.PI / 2);
    P.push({ g: tank, c: SOOT, p: [0, 5.3, 0] });
    P.push({ g: new THREE.CylinderGeometry(0.55, 0.7, 18, 10), c: BRICK, p: [-2.6, 9, -1.5] });
    B.push([-3.5, -2.5, 3.5, 2.5, 6.8], [-3.2, -2.1, -2, -0.9, 18]);
    return { parts: P, boxes: B, r: 6 };
  }
  if (type === 'generator') {
    P.push({ g: roundBox(5, 3, 3.5, 0.08), c: CONC, p: [0, 1.5, 0] });
    for (let k = 0; k < 3; k++) { P.push({ g: roundBox(1.2, 2.2, 1.2, 0.06), c: STEELG, p: [-1.6 + k * 1.6, 4.1, 0] }); P.push({ g: new THREE.CylinderGeometry(0.12, 0.18, 0.8, 8), c: 0x8a6a4a, p: [-1.6 + k * 1.6, 5.6, 0] }); }
    B.push([-2.5, -1.75, 2.5, 1.75, 5.2]);
    return { parts: P, boxes: B, r: 5 };
  }
  if (type === 'loco') {
    const boiler = new THREE.CylinderGeometry(0.9, 0.9, 7, 14); boiler.rotateX(Math.PI / 2);
    P.push({ g: roundBox(2.6, 0.8, 12, 0.1), c: SOOT, p: [0, 1.2, 0] });
    P.push({ g: boiler, c: 0x1e2022, p: [0, 2.5, 1.5] });
    P.push({ g: roundBox(2.6, 2.4, 2.4, 0.1), c: 0x1e2022, p: [0, 3.0, -3.2] });   // cab
    P.push({ g: roundBox(2.8, 0.15, 2.8, 0.05), c: 0x2a2a2a, p: [0, 4.3, -3.2] });
    P.push({ g: new THREE.CylinderGeometry(0.35, 0.3, 1.3, 10), c: SOOT, p: [0, 3.9, 4.3] });   // smokestack
    P.push({ g: new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10), c: SOOT, p: [0, 3.6, 1.8] });  // dome
    P.push({ g: roundBox(2.5, 2.2, 3.8, 0.1), c: 0x2a2c2a, p: [0, 2.1, -6.6] });   // tender
    P.push({ g: new THREE.CylinderGeometry(0.92, 0.92, 0.1, 14), c: 0x8a2a20, p: [0, 2.5, 5.0], r: [Math.PI / 2, 0, 0] }); // smokebox door
    for (const z of [3.2, 1.4, -0.4]) for (const x of [-1.25, 1.25]) P.push({ g: new THREE.CylinderGeometry(0.7, 0.7, 0.14, 16), c: 0x8a2a20, p: [x, 0.75, z], r: [0, 0, Math.PI / 2] });
    B.push([-1.4, -8.5, 1.4, 5.2, 4.5]);
    return { parts: P, boxes: B, r: 8 };
  }
  if (type === 'signal') {
    P.push({ g: roundBox(5, 3, 5, 0.08), c: BRICK, p: [0, 1.5, 0], jitter: 0.08 });
    P.push({ g: roundBox(5.4, 2.6, 5.4, 0.08), c: 0x7a6a50, p: [0, 4.3, 0] });
    for (const [x, z] of [[0, 2.72], [0, -2.72]]) P.push({ g: new THREE.BoxGeometry(4.2, 1.4, 0.06), c: 0x2a3036, p: [x, 4.5, z] });
    const roof = new THREE.CylinderGeometry(0.01, 4.2, 1.4, 4); roof.rotateY(Math.PI / 4);
    P.push({ g: roof, c: 0x4e4a48, p: [0, 6.3, 0] });
    B.push([-2.7, -2.7, 2.7, 2.7, 7]);
    return { parts: P, boxes: B, r: 5 };
  }
  if (type === 'storage') {
    P.push({ g: new THREE.CylinderGeometry(6, 6, 7, 28), c: 0x7a7c74, p: [0, 3.5, 0], jitter: 0.05 });
    P.push({ g: new THREE.CylinderGeometry(5.6, 6.05, 0.8, 28), c: 0x6a6c66, p: [0, 7.3, 0] });
    for (let k = 0; k < 10; k++) P.push({ g: new THREE.BoxGeometry(0.5, 0.05, 0.05), c: 0x3a3a3a, p: [6.05, 0.6 + k * 0.65, 0] });
    P.push({ g: new THREE.CylinderGeometry(0.25, 0.25, 9, 8), c: 0x4a4a44, p: [7, 1.2, 0], r: [Math.PI / 2, 0, 0] });
    B.push([-6, -6, 6, 6, 7.7]);
    return { parts: P, boxes: B, r: 8 };
  }
  if (type === 'pump') {
    P.push({ g: roundBox(5, 3.2, 4, 0.08), c: CONC, p: [0, 1.6, 0] });
    for (let k = 0; k < 3; k++) P.push({ g: new THREE.CylinderGeometry(0.22, 0.22, 10, 8), c: 0x5a4a3a, p: [-1 + k, 0.5 + k * 0.3, 6], r: [Math.PI / 2, 0, 0] });
    P.push({ g: roundBox(1.5, 2, 1.5, 0.06), c: 0x8a3020, p: [3.4, 1, 0] });
    B.push([-2.5, -2, 2.5, 2, 3.4]);
    return { parts: P, boxes: B, r: 5 };
  }
  return { parts: P, boxes: B, r: 5 };
}

// First-person weapon split by material, with hands placed on the gun's grip and fore-end.
export function viewModelGroups(team, cls) {
  const U = UNIFORM[team];
  const gun = buildGun(team, cls);
  const groups = { wood: [], metal: [], park: [], dark: [], brass: [], canvas: [], cloth: [], skin: [] };
  for (const p of gun.parts) {
    const key = p.mat === 'wood2' ? 'wood' : p.mat;
    groups[key].push({ g: p.g, c: GUN_COLORS[p.mat] ?? 0x333333, uvScale: 3 });
  }
  const [gx, gy, gz] = gun.grip, [fx, fy, fz] = gun.fore;
  // right hand wrapped around the pistol grip, left hand cradling the fore-end
  groups.skin.push({ g: sphere(0.036, 12, 9), c: SKIN, p: [gx + 0.004, gy, gz + 0.006], s: [1, 1.25, 1.2] });
  groups.skin.push({ g: sphere(0.036, 12, 9), c: SKIN, p: [fx - 0.012, fy - 0.012, fz], s: [1.05, 0.95, 1.5] });
  for (let k = 0; k < 3; k++) {
    groups.skin.push({ g: capsule(0.0105, 0.03, 6), c: SKIN, p: [gx - 0.02, gy - 0.012 - k * 0.017, gz - 0.025], r: [0, 0, Math.PI / 2] });
    groups.skin.push({ g: capsule(0.0105, 0.034, 6), c: SKIN, p: [fx + 0.026, fy - 0.004, fz - 0.03 + k * 0.022], r: [0, 0, Math.PI / 2 - 0.3] });
  }
  groups.skin.push({ g: capsule(0.011, 0.03, 6), c: SKIN, p: [gx - 0.012, gy + 0.03, gz - 0.02], r: [Math.PI / 2, 0, 0] }); // trigger finger
  groups.cloth.push(limb([gx + 0.01, gy - 0.02, gz + 0.04], [gx + 0.1, gy - 0.17, gz + 0.3], 0.042, U.uni, 12));
  groups.cloth.push(limb([fx - 0.02, fy - 0.03, fz + 0.03], [fx - 0.24, fy - 0.2, fz + 0.3], 0.044, U.uni, 12));
  groups.cloth.push({ g: new THREE.CylinderGeometry(0.046, 0.046, 0.035, 12), c: U.uni, p: [gx + 0.025, gy - 0.05, gz + 0.09], r: [Math.PI / 2 - 0.55, 0, 0] });
  const out = {};
  for (const [k, v] of Object.entries(groups)) out[k] = v.length ? mergeParts(v) : null;
  out.gun = gun;
  out.muzzle = new THREE.Vector3(0, gun.boreY, -gun.muzzleU);
  out.sightY = gun.sightY;
  return out;
}

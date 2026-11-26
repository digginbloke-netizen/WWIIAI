// First-person battle: scene setup, teams, flags, commanders, combat resolution.
import * as THREE from 'three';
import { World, HALF } from './world.js';
import './sector.js';
import './nav.js';
import { Effects } from './effects.js';
import { Bot } from './soldier.js';
import { Player } from './player.js';
import { HUD } from './hud.js';
import { CLASSES, DIFFICULTY, GRENADE } from './weapons.js';
import { WEATHER } from '../campaign/data.js';
import { audio } from '../audio.js';
import { clamp, mulberry32 } from '../util.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Period film look: muted colour, warm highlights, vignette and grain.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, hurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; uniform float hurt; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 0.74 - hurt * 0.5);
      c *= vec3(1.05, 1.0, 0.9);
      vec3 cc = clamp(c, 0.0, 1.0);
      c = mix(c, cc * cc * (3.0 - 2.0 * cc), 0.12);
      float v = smoothstep(0.92, 0.3, length((vUv - 0.5) * vec2(1.15, 1.0)));
      c *= mix(0.72, 1.0, v);
      float g = h(floor(vUv * res) + fract(time * 13.7)) - 0.5;
      c += g * 0.045 * (0.4 + l);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

let renderer = null;
function getRenderer(container) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  }
  if (renderer.domElement.parentElement !== container) container.prepend(renderer.domElement);
  return renderer;
}

const CLS_MIX = ['rifleman', 'rifleman', 'rifleman', 'assault', 'assault', 'support'];

export class Battle {
  constructor(cfg, container, hudRoot, callbacks) {
    this.cfg = cfg;
    this.container = container;
    this.cb = callbacks;
    this.playerTeam = 'allies';
    this.attTeam = cfg.attacker;
    this.defTeam = cfg.attacker === 'allies' ? 'axis' : 'allies';
    this.diff = DIFFICULTY[cfg.difficulty] || DIFFICULTY.normal;
    this.time = 0;
    this.timeLimit = 14 * 60;
    this.keys = {};
    this.running = false;
    this.over = false;
    this.paused = true;
    this.grenades = [];
    this.shells = [];
    this.planes = [];
    this.artyMarks = [];
    this.rng = mulberry32(cfg.seed ^ 0x9e3779b9);

    // tickets (scaled campaign troops)
    const maxT = Math.max(cfg.alliedTroops, cfg.axisTroops);
    this.scale = Math.min(1.6, 150 / Math.max(1, maxT));
    this.tickets = { allies: Math.max(8, Math.round(cfg.alliedTroops * this.scale)), axis: Math.max(8, Math.round(cfg.axisTroops * this.scale)) };
    this.tickets0 = { ...this.tickets };
    this.support = { art: cfg.alliedArt || 0, air: cfg.alliedAir || 0 };
    this.enemyArt = cfg.axisArt || 0;
    this.enemyArtT = 60 + this.rng() * 40;

    this._setupScene();
    this.world = new World(this.scene, cfg);
    this.effects = new Effects(this.scene, this.world, this.camera);
    this.effects.setWeather(cfg.weather);
    // flags: defenders hold B & C, A is neutral
    this.world.flags.forEach((f, i) => {
      f.owner = i === 0 ? null : this.defTeam;
      f.progress = i === 0 ? 0 : (this.defTeam === 'allies' ? 1 : -1);
      f.contested = false;
      this._flagMesh(f);
    });
    if (cfg.terrain === 'beach' && cfg.amphibious) this._landingCraft();

    const vis = { clear: 160, overcast: 140, rain: 105, fog: 55, snow: 90 }[cfg.weather] || 140;
    this.viewRange = vis * (cfg.terrain === 'forest' ? 0.6 : 1);

    this.player = new Player(this, this.camera);
    this.bots = [];
    this.squads = { allies: [], axis: [] };
    this.cap = cfg.botCap || 24;
    this._setupForces();
    this.commandT = 0; this.bleedT = 0; this.respawnT = 0; this.breakT = 0;

    this.hud = new HUD(hudRoot, this);
    this._bindInput();
    this.lastT = performance.now();
    this.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, caps: 0 };
  }

  // Front-line battle forces (also used for the live front inside a mission).
  _setupForces(cap = this.cap, frontOnly = false) {
    for (const team of ['allies', 'axis']) {
      const pl = team === this.playerTeam && !frontOnly ? 1 : 0;
      const n = Math.min(cap - pl, this.tickets[team] - pl);
      const nSquads = Math.max(1, Math.ceil(n / 6));
      for (let s = 0; s < nSquads; s++) this.squads[team].push({ team, members: [], obj: 1 });
      for (let k = 0; k < n; k++) {
        const bot = new Bot(this, team, CLS_MIX[k % CLS_MIX.length]);
        const sq = this.squads[team][k % nSquads];
        sq.members.push(bot); bot.squadRef = sq;
        this.bots.push(bot);
      }
    }
    this.combatants = [...this.bots, this.player];
    this._commander('allies', true); this._commander('axis', true);
    for (const bot of this.bots) if (bot.squadRef.role === undefined) this._spawnBot(bot, true);
  }

  // ---------- scene ----------
  _setupScene() {
    const cfg = this.cfg;
    const w = WEATHER[cfg.weather] || WEATHER.clear;
    this.renderer = getRenderer(this.container);
    const scene = new THREE.Scene();
    this.scene = scene;
    const tod = this.rng() < 0.75 ? 'day' : this.rng() < 0.5 ? 'dusk' : 'dawn';
    this.tod = tod;
    let sky = new THREE.Color(0x9fb4c8), sun = new THREE.Color(0xfff1d6), sunI = 2.8, hemiI = 1.7;
    if (cfg.weather === 'overcast' || cfg.weather === 'rain') { sky.set(0x8a929a); sunI = 1.2; hemiI = 2.2; }
    if (cfg.weather === 'fog') { sky.set(0xa0a6a8); sunI = 0.8; hemiI = 2.3; }
    if (cfg.weather === 'snow') { sky.set(0xb4bcc4); sunI = 1.0; hemiI = 2.0; }
    if (tod === 'dusk' || tod === 'dawn') { sky.lerp(new THREE.Color(0xd08a5a), 0.45); sun.set(0xffb070); sunI *= 0.85; hemiI *= 0.85; }
    scene.background = sky;
    scene.fog = new THREE.FogExp2(sky.getHex(), w.fog);
    this.skyColor = sky;
    const hemi = new THREE.HemisphereLight(sky.clone().lerp(new THREE.Color(0xffffff), 0.35), 0x6b6248, hemiI);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(sun, sunI);
    const el = tod === 'day' ? 0.9 : 0.35, az = this.rng() * Math.PI * 2;
    this.sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    this.sunColor = sun.clone();
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const sc = dir.shadow.camera; sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    dir.shadow.bias = -0.0006; dir.shadow.normalBias = 0.03;
    scene.add(dir); scene.add(dir.target);
    this.sun = dir;
    // sky dome: gradient, sun glow and drifting procedural clouds
    const cover = { clear: 0.32, overcast: 0.72, rain: 0.85, fog: 0.8, snow: 0.82 }[cfg.weather] ?? 0.5;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: sky.clone().multiplyScalar(0.78) }, bot: { value: sky.clone().lerp(new THREE.Color(0xffffff), 0.22) },
        sunDir: { value: new THREE.Vector3() }, sunCol: { value: sun.clone() }, cover: { value: cover }, time: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol; uniform float cover; uniform float time; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float hgt = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(bot, top, smoothstep(0.0, 0.55, hgt));
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          col += sunCol * (pow(sd, 600.0) * 4.0 + pow(sd, 12.0) * 0.25);
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.12) * 0.9 + vec2(time * 0.004, time * 0.0015);
            float n = fbm(uv * 1.4);
            float c = smoothstep(1.0 - cover - 0.05, 1.0 - cover + 0.35, n);
            float shade = 0.65 + 0.5 * fbm(uv * 1.4 + 0.35);
            vec3 cc = mix(vec3(0.55), vec3(1.0), shade) * (0.75 + 0.25 * sunCol);
            col = mix(col, mix(col, cc, 0.85), c * smoothstep(0.0, 0.18, d.y));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    dome.material.uniforms.sunDir.value.copy(this.sunDir);
    scene.add(dome); this.dome = dome;
    // image-based reflections for metal (weapons) from the sky
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(dome.geometry, dome.material));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = this.envRT.texture;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1500);
    scene.add(this.camera);
  }

  _flagMesh(f) {
    const g = new THREE.Group();
    const y = this.world.H(f.x, f.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 6), new THREE.MeshLambertMaterial({ color: 0x777777 }));
    pole.position.y = 4.5; g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4, 8, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    cloth.position.set(1.15, 8.2, 0); g.add(cloth);
    // ground ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(f.radius - 0.25, f.radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.position.y = 0.15; g.add(ring);
    g.position.set(f.x, y, f.z);
    this.scene.add(g);
    f.mesh = { g, cloth, ring, h: 8.2 };
    this._flagLook(f);
  }
  _flagLook(f) {
    const c = f.owner === 'allies' ? 0x3a6ab0 : f.owner === 'axis' ? 0xa83228 : 0xdddddd;
    f.mesh.cloth.material.color.setHex(c);
    f.mesh.ring.material.color.setHex(c);
  }

  _landingCraft() {
    // Higgins-style landing craft: tapered hull with a dropped bow ramp
    const hullShape = new THREE.Shape([[-4.2, 0.2], [-3.9, -0.6], [3.4, -0.6], [3.9, 0.0], [3.9, 1.3], [-4.0, 1.4]].map(([x, y]) => new THREE.Vector2(x, y)));
    const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 3.0, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
    hull.translate(0, 0, -1.5); hull.rotateY(Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a6250 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2e322a });
    for (let k = 0; k < 6; k++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(hull, mat));
      const well = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 6.6), dark); well.position.y = 1.0; g.add(well);
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 2.2), mat); ramp.position.set(0, 0.2, -5.0); ramp.rotation.x = 0.45; g.add(ramp);
      const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.8), mat); cockpit.position.set(0.7, 1.7, 3.4); g.add(cockpit);
      g.position.set(-70 + k * 28 + (this.rng() - 0.5) * 10, -0.9, 106 + this.rng() * 10);
      g.rotation.y = (this.rng() - 0.5) * 0.3;
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(g);
    }
  }


  // ---------- input ----------
  _bindInput() {
    this._kd = (e) => {
      if (this.over) return;
      if (e.code === 'Tab') e.preventDefault();
      this.keys[e.code] = true; this.player.keys[e.code] = true;
      if (!this.player.alive || this.paused) return;
      if (e.code === 'KeyG') this._playerGrenade();
      if (e.code === 'KeyB') this._playerArtillery();
      if (e.code === 'KeyV') this._playerAir();
      if (e.code === 'KeyM') this.hud.toggleMap();
      if (this.onKey) this.onKey(e.code);
    };
    this._ku = (e) => { this.keys[e.code] = false; this.player.keys[e.code] = false; };
    this._mm = (e) => { if (document.pointerLockElement === this.renderer.domElement && !this.paused) this.player.onMouseMove(e); };
    this._md = (e) => {
      if (this.paused || this.over || !this.player.alive) return;
      if (document.pointerLockElement !== this.renderer.domElement) { if (e.target === this.renderer.domElement) this.lockPointer(); return; }
      if (e.button === 0) this.player.mouse.left = true;
      if (e.button === 2) this.player.mouse.right = true;
    };
    this._mu = (e) => { if (e.button === 0) this.player.mouse.left = false; if (e.button === 2) this.player.mouse.right = false; };
    this._plc = () => {
      if (document.pointerLockElement !== this.renderer.domElement && !this.paused && !this.over && this.player.alive) this.cb.onPause();
    };
    this._cm = (e) => e.preventDefault();
    this._rs = () => this.resize();
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('mousemove', this._mm);
    window.addEventListener('mousedown', this._md);
    window.addEventListener('mouseup', this._mu);
    window.addEventListener('contextmenu', this._cm);
    window.addEventListener('resize', this._rs);
    document.addEventListener('pointerlockchange', this._plc);
  }
  lockPointer() {
    const el = this.renderer.domElement;
    try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  _setupPost() {
    const q = localStorage.getItem('rtb.gfx') || 'high';
    this.composer = null;
    if (q === 'low') return;
    const w = window.innerWidth, h = window.innerHeight;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (q === 'high') {
      const ao = new GTAOPass(this.scene, this.camera, w, h);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 12 });
      ao.updatePdMaterial({ radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.6;
      c.addPass(ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.32, 0.45, 0.88);
    c.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    c.addPass(new OutputPass());
    this.composer = c;
  }
  render(dt) {
    if (this.composer) {
      const u = this.grade.uniforms;
      u.time.value = this.time; u.res.value.set(window.innerWidth, window.innerHeight);
      u.hurt.value = this.player && this.player.alive ? Math.max(0, 1 - this.player.health / 60) : 0;
      this.composer.render(dt);
    } else this.renderer.render(this.scene, this.camera);
  }
  resize() {
    if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ---------- lifecycle ----------
  start() {
    this.running = true;
    this._setupPost();
    this.resize();
    audio.ambient(true);
    // show initial camera overview at our spawn
    const sp = this.world.insert || this.spawnPoints('allies')[0];
    const look = this.world.flags[1] || this.world.assets.find((a) => a.primary) || { x: 0, z: 0 };
    this.camera.position.set(sp.x, this.world.H(sp.x, sp.z) + 25, sp.z + (this.playerTeam === this.attTeam ? 25 : -25) * this.world.attSign);
    this.camera.lookAt(look.x, 0, look.z);
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastT) / 1000);
      this.lastT = now;
      if (!this.paused) this.update(dt);
      else if (!this.player.alive) { this.effects.update(dt * 0.3); }
      this.dome.material.uniforms.time.value = this.time;
      this.render(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // spawn points the team may use
  spawnPoints(team) {
    const att = team === this.attTeam;
    const hq = att ? this.world.spawns.att : this.world.spawns.def;
    const pts = [{ x: hq.x, z: hq.z, label: 'HQ', flag: null }];
    for (const f of this.world.flags) {
      if (f.owner !== team || f.contested) continue;
      const enemyNear = this.combatants.some((c) => c.alive && c.team !== team && Math.hypot(c.pos.x - f.x, c.pos.z - f.z) < 30);
      if (!enemyNear) pts.push({ x: f.x, z: f.z, label: `Flag ${f.letter}`, flag: f });
    }
    return pts;
  }

  deployPlayer(cls, spIndex) {
    const pts = this.spawnPoints(this.playerTeam);
    const sp = pts[clamp(spIndex, 0, pts.length - 1)];
    const p = this._safeSpot(sp.x, sp.z, sp.flag ? 6 : 8);
    const alliedAlive = this.bots.filter((b) => b.alive && b.team === this.playerTeam).length;
    if (this.tickets[this.playerTeam] - alliedAlive < 1) {
      // take over a slot: retire one queued bot spawn
      const b = this.bots.find((b) => !b.alive && b.team === this.playerTeam);
      if (!b && alliedAlive >= this.tickets[this.playerTeam]) return false;
    }
    this.player.spawn(p.x, p.z, cls);
    this.paused = false;
    this.lockPointer();
    this.hud.message(`<small>${this.cfg.region}</small><br>${this.playerTeam === this.attTeam ? 'ATTACK — capture the flags' : 'DEFEND — hold the flags'}`, 3);
    return true;
  }

  _safeSpot(x, z, r) {
    for (let k = 0; k < 20; k++) {
      const p = { x: x + (this.rng() - 0.5) * r * 2, y: 0, z: z + (this.rng() - 0.5) * r * 2 };
      p.y = this.world.H(p.x, p.z);
      const q = { ...p };
      if (!this.world.collide(q, 0.5)) return p;
    }
    return { x, y: this.world.H(x, z), z };
  }

  _spawnBot(bot, initial = false) {
    const team = bot.team;
    const sq = bot.squadRef;
    let pts = this.spawnPoints(team);
    if (initial) {
      // defenders start spread over their flags; attackers at HQ
      if (team === this.defTeam) pts = pts.filter((p) => p.flag) .concat(pts);
      else pts = [pts[0]];
    }
    // spawn point nearest to squad objective
    const obj = this.world.flags[sq.obj];
    let best = pts[0], bd = Infinity;
    for (const p of pts) {
      const d = Math.hypot(p.x - obj.x, p.z - obj.z) + (p.flag ? 0 : 10) + this.rng() * 25;
      if (d < bd) { bd = d; best = p; }
    }
    const s = this._safeSpot(best.x, best.z, best.flag ? 7 : 12);
    bot.spawn(s.x, s.z, sq);
  }

  // ---------- commander AI ----------
  _commander(team, initial = false) {
    const flags = this.world.flags;
    const att = team === this.attTeam;
    const enemy = team === 'allies' ? 'axis' : 'allies';
    const threat = flags.map((f) => this.combatants.filter((c) => c.alive && c.team === enemy && Math.hypot(c.pos.x - f.x, c.pos.z - f.z) < 35).length);
    const ours = flags.map((f) => this.combatants.filter((c) => c.alive && c.team === team && Math.hypot(c.pos.x - f.x, c.pos.z - f.z) < 25).length);
    // frontline flag from attacker's perspective: first flag (A..C) not owned by attackers
    const order = flags.map((f, i) => i);
    const front = order.find((i) => flags[i].owner !== this.attTeam);
    const assigned = flags.map(() => 0);
    for (const sq of this.squads[team]) {
      const alive = sq.members.filter((m) => m.alive);
      let cx = 0, cz = 0;
      if (alive.length) { for (const m of alive) { cx += m.pos.x; cz += m.pos.z; } cx /= alive.length; cz /= alive.length; }
      else { const hq = att ? this.world.spawns.att : this.world.spawns.def; cx = hq.x; cz = hq.z; }
      let best = sq.obj, bs = -Infinity;
      flags.forEach((f, i) => {
        const owned = f.owner === team;
        let s;
        if (owned) s = threat[i] > 0 ? 2.2 + threat[i] * 0.25 - ours[i] * 0.1 : 0.4;
        else s = f.owner === null ? 3.2 : 2.8;
        if (att && i === front) s += 1.6;
        if (att && front !== undefined && i > front && !owned) s -= 1.2; // don't bypass the front line
        if (!att && !owned) s += (i === 0 ? -0.6 : 0.6);
        if (!att && owned && i === front) s += 0.8; // reinforce the contested front
        s -= Math.hypot(cx - f.x, cz - f.z) / 90;
        s -= assigned[i] * (initial ? 0.9 : 0.6);
        if (i === sq.obj) s += 0.3; // hysteresis
        if (s > bs) { bs = s; best = i; }
      });
      if (initial && !att) best = 1 + (this.squads[team].indexOf(sq) % 2);
      sq.obj = best; assigned[best]++;
    }
  }

  // ---------- update ----------
  update(dt) {
    this.time += dt;
    const p = this.player;
    p.update(dt);
    if (this.world.servePaths) this.world.servePaths(this.world.big ? 5 : 4);
    this._updateBots(dt);
    this._flags(dt);
    this._projectiles(dt);
    this.effects.update(dt);
    // flag cloth wave
    for (const f of this.world.flags) {
      const pos = f.mesh.cloth.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + 1.1; pos.setZ(i, Math.sin(this.time * 4 + x * 2.5) * 0.12 * x); }
      pos.needsUpdate = true;
    }
    // sun/shadow follows camera
    const c = this.camera.position;
    this.sun.position.set(c.x + this.sunDir.x * 120, c.y + this.sunDir.y * 120, c.z + this.sunDir.z * 120);
    this.sun.target.position.set(c.x, c.y, c.z);
    this.dome.position.copy(c);
    if (this.world.big) this.world.updateLOD(c);

    this._modeUpdate(dt);
    this.hud.update(dt);
  }

  _modeUpdate(dt) {
    this.commandT -= dt;
    if (this.commandT <= 0) { this.commandT = 3; this._commander('allies'); this._commander('axis'); this._spotting(); }
    this._reinforce(dt);
    this._bleed(dt);
    this._enemySupport(dt);
    // end conditions
    if (!this.over) {
      if (this.tickets.allies <= 0) this.end('axis', 'Allied forces have been exhausted.');
      else if (this.tickets.axis <= 0) this.end('allies', 'The German defenders have been wiped out.');
      else if (this.time >= this.timeLimit) {
        const fa = this.world.flags.filter((f) => f.owner === this.attTeam).length;
        const w = fa >= 2 ? this.attTeam : this.defTeam;
        this.end(w, 'Time has run out.');
      } else {
        const allAtt = this.world.flags.every((f) => f.owner === this.attTeam);
        this.breakT = allAtt ? this.breakT + dt : 0;
        if (this.breakT > 45) this.end(this.attTeam, 'The attackers have broken through and hold every objective.');
      }
    }
  }

  _updateBots(dt) { for (const b of this.bots) b.update(dt); }

  fireRocket(o, d, p) {
    if (!this.rockets) this.rockets = [];
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4a4a3a }));
    const pos = o.clone().addScaledVector(d, 0.8);
    mesh.position.copy(pos); this.scene.add(mesh);
    this.rockets.push({ pos, vel: d.clone().multiplyScalar(85), mesh, t: 0 });
    for (let i = 0; i < 10; i++) this.effects.smoke.spawn(o.x - d.x, o.y - d.y * 0.5, o.z - d.z, -d.x * 4 + (Math.random() - 0.5) * 2, 0.5, -d.z * 4 + (Math.random() - 0.5) * 2, 1.5, 1.2, 0.75, 0.73, 0.7, 0.5, 0, 1.5, 1);
    audio.explosion(3, 0, false);
    this.stats.shots++;
  }

  _spotting() {
    // enemies seen by any allied bot are shown on the minimap
    for (const b of this.bots) {
      if (b.alive && b.team === this.playerTeam && b.visible && b.target && !b.target.isPlayer) b.target.spottedT = this.time;
    }
  }

  _flags(dt) {
    for (const f of this.world.flags) {
      let na = 0, nx = 0;
      for (const c of this.combatants) {
        if (!c.alive) continue;
        if ((c.pos.x - f.x) ** 2 + (c.pos.z - f.z) ** 2 < f.radius * f.radius) { if (c.team === 'allies') na++; else nx++; }
      }
      f.contested = na > 0 && nx > 0;
      const diff = na - nx;
      if (diff !== 0) {
        const rate = clamp(Math.abs(diff), 1, 4) * 0.045 * Math.sign(diff);
        const before = f.owner;
        f.progress = clamp(f.progress + rate * dt, -1, 1);
        if (f.owner === 'allies' && f.progress <= 0) f.owner = null;
        if (f.owner === 'axis' && f.progress >= 0) f.owner = null;
        if (f.progress >= 1 && f.owner !== 'allies') f.owner = 'allies';
        if (f.progress <= -1 && f.owner !== 'axis') f.owner = 'axis';
        if (before !== f.owner) {
          this._flagLook(f);
          if (f.owner) {
            const ours = f.owner === this.playerTeam;
            this.hud.message(`${ours ? 'We captured' : 'The enemy captured'} flag ${f.letter}`, 2.5);
            if (ours && Math.hypot(this.player.pos.x - f.x, this.player.pos.z - f.z) < f.radius && this.player.alive) this.stats.caps++;
          } else this.hud.message(`Flag ${f.letter} neutralized`, 2);
        }
      }
    }
  }

  _bleed(dt) {
    this.bleedT += dt;
    if (this.bleedT < 1) return;
    this.bleedT = 0;
    const fa = this.world.flags.filter((f) => f.owner === 'allies').length;
    const fx = this.world.flags.filter((f) => f.owner === 'axis').length;
    const step = (team, n) => {
      // holding all three flags bleeds the enemy quickly, two flags slowly
      const rate = n === 3 ? 1 / 3 : n === 2 ? 1 / 9 : 0;
      const enemy = team === 'allies' ? 'axis' : 'allies';
      this._bleedAcc = this._bleedAcc || { allies: 0, axis: 0 };
      this._bleedAcc[enemy] += rate;
      while (this._bleedAcc[enemy] >= 1) { this._bleedAcc[enemy] -= 1; this.tickets[enemy] = Math.max(0, this.tickets[enemy] - 1); }
    };
    if (fa > fx) step('allies', fa); else if (fx > fa) step('axis', fx);
  }

  _reinforce(dt) {
    this.respawnT -= dt;
    if (this.respawnT > 0) return;
    this.respawnT = 1.5;
    for (const team of ['allies', 'axis']) {
      const aliveBots = this.bots.filter((b) => b.alive && b.team === team).length;
      const playerSlot = team === this.playerTeam ? 1 : 0;
      const maxAlive = Math.min(this.cap - playerSlot, this.tickets[team] - playerSlot);
      if (aliveBots >= maxAlive) continue;
      const dead = this.bots.filter((b) => !b.alive && b.team === team && b.deadT > 6);
      let n = Math.min(maxAlive - aliveBots, 3, dead.length);
      for (let k = 0; k < n; k++) this._spawnBot(dead[k]);
    }
  }

  // ---------- combat ----------
  sound(kind, pos) {
    const c = this.camera.position;
    const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz);
    const rx = Math.cos(this.player.yaw), rz = -Math.sin(this.player.yaw);
    const pan = d > 0.1 ? (dx * rx + dz * rz) / d : 0;
    audio.gunshot(kind, d, pan * 0.8);
  }

  bulletNear(ox, oy, oz, ux, uy, uz, len, shooter) {
    const p = this.player;
    if (!p.alive || shooter.team === p.team) return;
    const hx = p.pos.x - ox, hy = p.pos.y + 1.5 - oy, hz = p.pos.z - oz;
    const t = clamp(hx * ux + hy * uy + hz * uz, 0, len);
    const dx = hx - ux * t, dy = hy - uy * t, dz = hz - uz * t;
    const d = Math.hypot(dx, dy, dz);
    if (d < 2.5 && t > 3) {
      p.suppress = Math.min(1, p.suppress + 0.25);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      audio.whiz(clamp(-(dx * rx + dz * rz), -1, 1));
    }
  }

  playerShot(o, d, p) {
    const w = p.w;
    this.stats.shots++;
    const wt = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, w.range);
    let best = wt, hitBot = null, head = false;
    for (const b of this.bots) {
      if (!b.alive || b.team === p.team) continue;
      const cx = b.pos.x - o.x, cy = b.pos.y + 1 - o.y, cz = b.pos.z - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z;
      if (t < 0 || t > best) continue;
      const px = cx - d.x * t, py = cy - d.y * t, pz = cz - d.z * t;
      if (px * px + py * py + pz * pz > 1.6) continue;
      const h = b.rayHit(o, d);
      if (h && h.t < best) { best = h.t; hitBot = b; head = h.head; }
    }
    const end = best === Infinity ? w.range : best;
    const ex = o.x + d.x * end, ey = o.y + d.y * end, ez = o.z + d.z * end;
    const m = p.muzzleWorld(new THREE.Vector3());
    if (!w.auto || this.stats.shots % 2 === 0) this.effects.tracer(m.x, m.y, m.z, ex, ey, ez);
    this.effects.muzzle(m.x, m.y, m.z, false);
    if (hitBot) {
      this.stats.hits++;
      let dmg = w.dmg * (head ? 2.2 : 1);
      if (end > w.range * 0.6) dmg *= 0.8;
      const willDie = hitBot.health - dmg <= 0;
      this.effects.blood(ex, ey, ez);
      hitBot.damage(dmg, p, p.pos);
      if (willDie) hitBot.killedByHead = head;
      this.hud.hitmarker(head, willDie);
      audio.hit();
    } else if (best !== Infinity) {
      this.effects.impact(ex, ey, ez, this.world.lastHit === 'terrain' ? (this.world.water && ey < 0 ? 'water' : 'dirt') : 'stone');
    }
    // suppress enemies near the bullet's path
    for (const b of this.bots) {
      if (!b.alive || b.team === p.team || b === hitBot) continue;
      const cx = b.pos.x - o.x, cy = b.pos.y + 1.2 - o.y, cz = b.pos.z - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z;
      if (t < 0 || t > end + 2) continue;
      const px = cx - d.x * t, py = cy - d.y * t, pz = cz - d.z * t;
      if (px * px + py * py + pz * pz < 9) { b.suppress = Math.min(1, b.suppress + 0.3); b.threat = p; b.lastHurt = this.time - 2; }
    }
  }

  onKill(victim, killer) {
    if (!victim.alive) return;
    victim.die();
    this.tickets[victim.team] = Math.max(0, this.tickets[victim.team] - 1);
    if (killer && killer !== victim) killer.kills++;
    const wname = killer ? (killer._lastWeapon || (killer.w && killer.w.name) || '') : '';
    this.hud.kill(killer, victim, wname, victim.killedByHead);
    this.killLog = this.killLog || {}; this.killLog[wname] = (this.killLog[wname] || 0) + 1;
    victim.killedByHead = false;
    if (killer && killer.isPlayer && victim !== killer) this.stats.kills++;
    if (victim.isPlayer) {
      this.stats.deaths++;
      this.hud.message(`Killed by ${killer && killer !== victim ? killer.name : 'your own grenade'}`, 3);
      setTimeout(() => { if (!this.over && !this.player.alive) { document.exitPointerLock && document.exitPointerLock(); this.cb.onPlayerDead(); } }, 2500);
    }
    for (const b of this.bots) if (b.target === victim) { b.target = null; b.visible = false; }
  }

  throwGrenade(origin, vel, owner) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 6), new THREE.MeshLambertMaterial({ color: owner.team === 'axis' ? 0x3a3a30 : 0x3e4a2e }));
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.grenades.push({ pos: origin.clone(), vel: vel.clone(), t: GRENADE.fuse * (owner.isPlayer ? 1 : 0.8 + this.rng() * 0.3), owner, mesh });
  }

  _playerGrenade() {
    const p = this.player;
    if (p.grenades <= 0) return;
    p.grenades--;
    const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
    const o = this.camera.position.clone().addScaledVector(d, 0.5);
    const v = d.clone().multiplyScalar(17).add(new THREE.Vector3(0, 4, 0)).add(new THREE.Vector3(p.vel.x, 0, p.vel.z));
    this.throwGrenade(o, v, p);
  }

  _aimPoint(maxD = 400) {
    const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
    const o = this.camera.position;
    const t = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxD);
    if (t === Infinity) return null;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  _playerArtillery() {
    if (this.support.art <= 0) { this.hud.message('No artillery support available', 1.5); return; }
    const a = this._aimPoint();
    if (!a) { this.hud.message('Invalid target', 1); return; }
    this.support.art--;
    this.callArtillery(this.playerTeam, a.x, a.z, 10, 14, { byPlayer: true });
    this.hud.message('Artillery barrage requested — rounds inbound', 2.5);
  }

  // opts: { delay (s before the first round lands), show (mark on the map), byPlayer (credit the player) }
  callArtillery(team, x, z, shells, spread, opts = {}) {
    const delay = opts.delay ?? 4;
    const mark = { x, z, t: delay + shells * 0.6 + 2 };
    if (opts.show !== false) this.artyMarks.push(mark);
    for (let k = 0; k < shells; k++) {
      const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * spread;
      this.shells.push({ t: delay + k * (opts.interval ?? 0.6) + this.rng() * 0.6, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, team, whistled: false, mark, byPlayer: !!opts.byPlayer });
    }
  }

  _playerAir() {
    if (this.support.air <= 0) { this.hud.message('No air support available', 1.5); return; }
    const a = this._aimPoint(500);
    if (!a) { this.hud.message('Invalid target', 1); return; }
    this.support.air--;
    this.hud.message('Air strike inbound!', 2.5);
    // plane flies from our side across the target
    const ang = Math.atan2(a.x - this.player.pos.x, a.z - this.player.pos.z);
    const dx = Math.sin(ang), dz = Math.cos(ang);
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: 0x4a5340 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.4, 9, 8).rotateX(Math.PI / 2), m); g.add(fus);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 2), m); wing.position.z = 0.5; g.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.15, 1.2), m); tail.position.z = -4; g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 1.2), m); fin.position.set(0, 0.8, -4); g.add(fin);
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.7, 5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff })); star.position.set(4, 0.12, 0.5); g.add(star);
    g.rotation.y = ang;
    const start = { x: a.x - dx * 400, z: a.z - dz * 400 };
    g.position.set(start.x, 70, start.z);
    this.scene.add(g);
    this.planes.push({ g, x: start.x, z: start.z, dx, dz, tx: a.x, tz: a.z, dropped: 0, t: 0, team: this.playerTeam, sounded: false });
  }

  _enemySupport(dt) {
    if (this.enemyArt <= 0) return;
    this.enemyArtT -= dt;
    if (this.enemyArtT > 0) return;
    this.enemyArtT = 80 + this.rng() * 60;
    // target the flag with the most player-team soldiers around it
    const enemy = this.playerTeam === 'allies' ? 'axis' : 'allies';
    let best = null, bn = 2;
    for (const f of this.world.flags) {
      const n = this.combatants.filter((c) => c.alive && c.team === this.playerTeam && Math.hypot(c.pos.x - f.x, c.pos.z - f.z) < 25).length;
      const own = this.combatants.filter((c) => c.alive && c.team === enemy && Math.hypot(c.pos.x - f.x, c.pos.z - f.z) < 20).length;
      if (n > bn && own < 2) { bn = n; best = f; }
    }
    if (!best) { this.enemyArtT = 15; return; }
    this.enemyArt--;
    this.callArtillery(enemy, best.x, best.z, 8, 16);
    this.hud.message('⚠ Enemy artillery incoming!', 3);
  }

  explode(x, y, z, radius, dmg, owner, big = false) {
    this.effects.explosion(x, y, z, big);
    const c = this.camera.position;
    const d = Math.hypot(x - c.x, y - c.y, z - c.z);
    const rx = Math.cos(this.player.yaw), rz = -Math.sin(this.player.yaw);
    audio.explosion(d, d > 0.1 ? clamp(((x - c.x) * rx + (z - c.z) * rz) / d, -1, 1) * 0.7 : 0, big);
    if (d < 40 && this.player.alive) this.player.suppress = Math.min(1, this.player.suppress + (1 - d / 40) * 0.9);
    for (const t of this.combatants) {
      if (!t.alive) continue;
      const dd = Math.hypot(t.pos.x - x, t.pos.y + 0.8 - y, t.pos.z - z);
      if (dd < radius * 2.5 && t.suppress !== undefined) t.suppress = Math.min(1, t.suppress + 0.6);
      if (dd > radius) continue;
      if (owner && t.team === owner.team && t !== owner) continue; // no team damage
      let dm = dmg * Math.pow(1 - dd / radius, 1.5);
      if (!this.world.los(x, y + 0.6, z, t.pos.x, t.pos.y + 1.0, t.pos.z)) dm *= 0.2;
      if (t.crouch) dm *= 0.8;
      if (owner) owner._lastWeapon = big ? 'Artillery' : 'Grenade';
      t.damage(dm, owner || null, { x, z });
    }
    if (owner) owner._lastWeapon = null;
  }

  _projectiles(dt) {
    const W = this.world;
    for (const g of this.grenades) {
      g.t -= dt;
      g.vel.y -= 9.8 * dt;
      const sp = g.vel.length();
      if (sp > 0.01) {
        const step = sp * dt;
        const ux = g.vel.x / sp, uy = g.vel.y / sp, uz = g.vel.z / sp;
        const ht = W.raycast(g.pos.x, g.pos.y, g.pos.z, ux, uy, uz, step + 0.1, true);
        if (ht !== Infinity) { g.vel.x *= -0.35; g.vel.z *= -0.35; g.vel.y *= 0.5; }
        else g.pos.addScaledVector(g.vel, dt);
      }
      const gy = W.groundAt(g.pos.x, g.pos.z, g.pos.y) + 0.05;
      if (g.pos.y < gy) { g.pos.y = gy; g.vel.y = Math.abs(g.vel.y) * 0.3; g.vel.x *= 0.55; g.vel.z *= 0.55; if (Math.abs(g.vel.y) < 0.5) g.vel.y = 0; }
      g.mesh.position.copy(g.pos); g.mesh.rotation.x += dt * sp; g.mesh.rotation.z += dt * sp * 0.5;
      if (g.t <= 0) {
        this.scene.remove(g.mesh); g.mesh.geometry.dispose();
        g.owner._lastWeapon = 'Grenade';
        this.explode(g.pos.x, g.pos.y, g.pos.z, GRENADE.radius, GRENADE.dmg, g.owner);
      }
    }
    this.grenades = this.grenades.filter((g) => g.t > 0);
    // bots flee grenades nearby
    for (const g of this.grenades) {
      if (g.t > 1.8) continue;
      for (const b of this.bots) {
        if (!b.alive || b.flee === g) continue;
        if (Math.hypot(b.pos.x - g.pos.x, b.pos.z - g.pos.z) < 6 && Math.random() < 0.5) {
          b.flee = g;
          const a = Math.atan2(b.pos.x - g.pos.x, b.pos.z - g.pos.z);
          b.holdPt = { x: b.pos.x + Math.sin(a) * 8, z: b.pos.z + Math.cos(a) * 8 };
          b.state = 'hold'; b.holdReached = false; b.think = 1.2;
        }
      }
    }
    for (const s of this.shells) {
      s.t -= dt;
      if (!s.whistled && s.t < 1.6) {
        s.whistled = true;
        if (Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z) < 60 && this.rng() < 0.5) audio.whistle();
      }
      if (s.t <= 0) {
        const y = W.H(s.x, s.z);
        const owner = s.byPlayer ? this.player : null;
        if (owner) owner._lastWeapon = 'Artillery';
        this.explode(s.x, y, s.z, 9, 230, owner || { team: s.team, name: 'Artillery', kills: 0, isPlayer: false }, true);
      }
    }
    this.shells = this.shells.filter((s) => s.t > 0);
    for (const m of this.artyMarks) m.t -= dt;
    this.artyMarks = this.artyMarks.filter((m) => m.t > 0);
    for (const pl of this.planes) {
      pl.t += dt;
      pl.x += pl.dx * 75 * dt; pl.z += pl.dz * 75 * dt;
      pl.g.position.set(pl.x, 70 - Math.max(0, 1 - Math.abs(Math.hypot(pl.x - pl.tx, pl.z - pl.tz) - 0) / 300) * 30, pl.z);
      const along = (pl.x - pl.tx) * pl.dx + (pl.z - pl.tz) * pl.dz;
      if (!pl.sounded && along > -260) { pl.sounded = true; audio.plane(0); }
      if (pl.dropped < 5 && along > -60 + pl.dropped * 24) {
        pl.dropped++;
        const bx = pl.x + pl.dx * 40, bz = pl.z + pl.dz * 40;
        this.shells.push({ t: 1.2, x: bx + (this.rng() - 0.5) * 8, z: bz + (this.rng() - 0.5) * 8, team: pl.team, whistled: true });
      }
      if (pl.t > 12) { this.scene.remove(pl.g); pl.done = true; }
    }
    this.planes = this.planes.filter((p) => !p.done);
  }

  // ---------- end ----------
  end(winner, reason) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.reason = reason;
    document.exitPointerLock && document.exitPointerLock();
    this.player.mouse.left = false;
    setTimeout(() => this.cb.onEnd(this.result()), 1500);
  }

  // Convert battle state to campaign casualties.
  result(forcedWinner) {
    const att = this.attTeam, def = this.defTeam;
    const lossA = (this.tickets0[att] - this.tickets[att]) / this.scale;
    const lossD = (this.tickets0[def] - this.tickets[def]) / this.scale;
    const cfgAtt = att === 'allies' ? this.cfg.alliedTroops : this.cfg.axisTroops;
    const cfgDef = def === 'allies' ? this.cfg.alliedTroops : this.cfg.axisTroops;
    const winner = forcedWinner || this.winner;
    let attLoss = Math.round(lossA), defLoss = Math.round(lossD);
    // the losing side's remaining forces are partially destroyed during the retreat
    if (winner === att) defLoss = Math.round(lossD + (cfgDef - lossD) * 0.4);
    else attLoss = Math.round(lossA + (cfgAtt - lossA) * 0.25);
    return {
      winner, mode: 'fps', reason: this.reason,
      attLoss: clamp(attLoss, 0, cfgAtt), defLoss: clamp(defLoss, 0, cfgDef),
      kills: this.stats.kills, deaths: this.stats.deaths, stats: { ...this.stats },
      tickets: { ...this.tickets }, tickets0: { ...this.tickets0 },
    };
  }

  // Player leaves: remaining fight is simulated from the current state.
  retreatResolve() {
    const fl = (t) => this.world.flags.filter((f) => f.owner === t).length;
    const pa = this.tickets[this.attTeam] * (1 + 0.3 * fl(this.attTeam)) * (0.85 + this.rng() * 0.3);
    const pd = this.tickets[this.defTeam] * (1.25 + 0.3 * fl(this.defTeam)) * (0.85 + this.rng() * 0.3);
    const winner = pa > pd ? this.attTeam : this.defTeam;
    const loser = winner === this.attTeam ? this.defTeam : this.attTeam;
    const lt = this.tickets[loser];
    this.tickets[winner] = Math.max(1, Math.round(this.tickets[winner] - lt * 0.45));
    this.tickets[loser] = Math.round(lt * 0.3);
    this.winner = winner;
    this.reason = 'You left the field; your commanders fought on.';
    this.over = true;
    return this.result(winner);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    audio.ambient(false);
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mousedown', this._md);
    window.removeEventListener('mouseup', this._mu);
    window.removeEventListener('contextmenu', this._cm);
    window.removeEventListener('resize', this._rs);
    document.removeEventListener('pointerlockchange', this._plc);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (!m.map) m.dispose(); }
    });
    if (this.composer) { for (const p of this.composer.passes) if (p.dispose) p.dispose(); this.composer.dispose(); }
    if (this.envRT) this.envRT.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.clear();
  }
}

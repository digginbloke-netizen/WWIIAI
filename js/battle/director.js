// Operations director: keeps both armies busy in the sector with squads that have their own hidden
// objectives. Allied assaults, engineer sabotage teams, recon patrols, forward observers and
// reinforcements; German reinforcement columns, counterattacks, trench raids (Stosstrupps),
// observers, security patrols and supply parties. What they achieve feeds the strategic battle.
import { clamp } from '../util.js';
import { HALF } from './world.js';
import { ASSET_TYPES } from '../campaign/data.js';

const MIX = ['rifleman', 'rifleman', 'assault', 'support', 'rifleman', 'assault'];
const SAPPERS = ['assault', 'rifleman', 'assault', 'rifleman', 'support'];
const D = {};
const pickW = (cands) => {
  const tot = cands.reduce((a, c) => a + c.w, 0); if (tot <= 0) return null;
  let r = Math.random() * tot; for (const c of cands) { r -= c.w; if (r <= 0) return c; } return cands[cands.length - 1];
};
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

D._dirInit = function () {
  const cfg = this.cfg, w = this.world;
  const front = !!cfg.front || cfg.depth === 0;
  const cap = clamp(cfg.botCap || 28, 8, 60);
  const strength = clamp((cfg.garrison || 40) / 40, 0.6, 1.6);
  this.dir = {
    front, cap, strength, ops: [], report: [],
    pool: { allies: front ? Math.round(cap * 4) : cfg.depth === 1 ? 10 : 0, axis: Math.round(cap * (front ? 3 : 1.5) * strength) },
    t: 18, newsT: -99,
  };
  for (const s of w.strongpoints) s.owner = 'axis';
  for (const sq of this.msquads) {
    if (sq.team === 'axis' && sq.role === 'guard') sq.full = sq.members.length;
    if (sq.role === 'assault' || sq.role === 'fpatrol') sq.mobile = true;
  }
  // the opening assaults/counterattacks are operations too
  for (const o of this.aiObjectives) if (o.squad) this.dir.ops.push({ type: o.team === 'allies' ? 'assault' : 'counterattack', team: o.team, sq: o.squad, target: o.target, obj: o, state: 'move' });
};

D._mobileAlive = function (team) {
  let n = 0;
  for (const b of this.bots) if (b.alive && b.team === team && b.squadRef && b.squadRef.mobile) n++;
  return n;
};

D._director = function (dt) {
  const d = this.dir; if (!d) return;
  this._dirOps(dt);
  // fresh companies reach the sector every few minutes
  d.regenT = (d.regenT ?? 300) - dt;
  if (d.regenT <= 0) {
    d.regenT = 300;
    if (d.front) d.pool.allies += Math.round(d.cap * 0.6);
    if (d.front || this.cfg.depth === 1) d.pool.axis += Math.round(d.cap * (d.front ? 0.5 : 0.25) * d.strength);
    else d.pool.axis += Math.round(d.cap * 0.25 * d.strength);
  }
  d.t -= dt; if (d.t > 0) return;
  d.t = 28 + Math.random() * 22;
  for (const team of ['axis', 'allies']) {
    if (d.pool[team] <= 0 || this._mobileAlive(team) >= d.cap) continue;
    const op = team === 'allies' ? this._pickAllied() : this._pickGerman();
    if (op) this._launch(team, op);
  }
};

// ---------- choosing operations ----------
D._busy = function (target) { return this.dir.ops.some((o) => o.target === target && (o.state === 'move' || o.state === 'act')); };
// a building a team could garrison or form up in: has doors and windows, no enemies close by,
// and nobody else already headed for it. test(B) narrows the choice.
D._pickBuilding = function (team, test) {
  const w = this.world;
  if (!w.buildings || !w.buildings.length) return null;
  const used = new Set(this.dir.ops.filter((o) => o.bld !== undefined && o.state !== 'over').map((o) => o.bld));
  const c = w.buildings.filter((B) => B.ok && !B.bunker && B.posts.length >= 3 && !used.has(B.idx) && test(B) &&
    !this.bots.some((b) => b.alive && Math.hypot(b.pos.x - B.cx, b.pos.z - B.cz) < (b.team === team ? 12 : 40)));
  return c.length ? c[Math.floor(Math.random() * c.length)] : null;
};
D._pickAllied = function () {
  const w = this.world, d = this.dir, c = [];
  const sp = w.strongpoints;
  if (d.front) {
    // assault the German position closest to the Allied side that nobody is already attacking
    const tgts = sp.filter((s) => s.owner === 'axis' && s.kind !== 'pow' && !this._busy(s)).sort((a, b) => b.z - a.z);
    const defending = this.cfg.front && this.cfg.front.attacker === 'axis';
    if (defending || !this.cfg.front) {
      const posts = w.wpAllies.filter((t) => !this._busy(t) && this.bots.filter((b) => b.alive && b.team === 'allies' && near(b.pos, t) < 25).length < 3);
      if (posts.length) c.push({ w: defending ? 3 : 1.2, type: 'defend', target: posts[Math.floor(Math.random() * posts.length)], n: 6 });
    }
    if (tgts.length) c.push({ w: defending ? 0.8 : !this.cfg.front ? 1.4 : 3, type: 'assault', target: tgts[Math.floor(Math.random() * Math.min(2, tgts.length))], n: 8 + Math.floor(Math.random() * 3) });
    // two platoons link up at a house short of the objective, then go in together
    if (tgts.length) {
      const t = tgts[0];
      const B = this._pickBuilding('allies', (B) => B.cz > t.z + 40 && B.cz < t.z + 260 && Math.abs(B.cx - t.x) < 220);
      if (B) c.push({ w: 1.3, type: 'rendezvous', target: t, bld: B.idx, n: 10 });
    }
    // turn a house on the Allied side into a strongpoint
    // houses near Allied-held positions, or anywhere on the Allied side of the German line
    const ref = [...sp.filter((s) => s.owner === 'allies'), ...w.wpAllies];
    const lineZ = Math.max(-Infinity, ...sp.filter((s) => s.owner === 'axis').map((s) => s.z));
    const hB = this._pickBuilding('allies', (B) => B.cz > lineZ + 50 || ref.some((r) => Math.hypot(r.x - B.cx, r.z - B.cz) < 90));
    if (hB) c.push({ w: defending ? 2.2 : 1.0, type: 'garrison', bld: hB.idx, target: { x: hB.cx, z: hB.cz }, n: Math.min(6, hB.posts.length) });
    // hold what has been taken
    const held = sp.filter((s) => s.owner === 'allies' && !this._busy(s) && this.bots.filter((b) => b.alive && b.team === 'allies' && near(b.pos, s) < s.r + 12).length < 4);
    if (held.length) c.push({ w: 3.5, type: 'reinforce', target: held[0], n: 6 });
    const bat = this.batteries && this.batteries.some((b) => b.team === 'allies' && b.alive);
    if (bat && !d.ops.some((o) => o.type === 'fo' && o.team === 'allies' && o.state !== 'over')) {
      const vp = w.wpAllies.slice().sort((a, b) => a.z - b.z)[0];
      if (vp) c.push({ w: 1.3, type: 'fo', target: vp, n: 2 });
    }
    c.push({ w: 1.4, type: 'recon', n: 4 });
  }
  // engineers / OSS teams go for German assets (not the Rangers' own target)
  const assets = w.assets.filter((a) => a.alive && !a.sub && !a.primary && !this._busy(a));
  if (assets.length) {
    const a = assets.sort((p, q) => q.z - p.z)[Math.floor(Math.random() * Math.min(3, assets.length))];
    c.push({ w: d.front ? 1.0 : 3, type: 'sabotage', target: a, n: d.front ? 5 : 3 });
  }
  if (!d.front) c.push({ w: 1, type: 'recon', n: 3 });
  return pickW(c);
};
D._pickGerman = function () {
  const w = this.world, d = this.dir, c = [];
  // reinforce garrisons that have been bled
  const weak = this.msquads.filter((sq) => sq.team === 'axis' && (sq.role === 'guard' || (sq.role === 'garrison' && sq.fixed)) && sq.full && sq.members.filter((b) => b.alive).length < sq.full * 0.5 && !d.ops.some((o) => o.join === sq && o.state === 'move'));
  if (weak.length) { const sq = weak[0], t = w.targets[sq.obj]; const sp = w.strongpoints.find((s) => s.nav === t); if (!sp || sp.owner === 'axis') c.push({ w: 3, type: 'reinforce', target: t, join: sq, n: Math.max(3, Math.min(8, sq.full - sq.members.filter((b) => b.alive).length)) }); }
  // retake lost positions
  const lost = w.strongpoints.filter((s) => s.owner === 'allies' && !this._busy(s));
  if (lost.length) {
    c.push({ w: 4, type: 'counterattack', target: lost[0], n: 9 + Math.floor(Math.random() * 3) });
    const t = lost[0];
    const B = this._pickBuilding('axis', (B) => B.cz < t.z - 40 && B.cz > t.z - 260 && Math.abs(B.cx - t.x) < 220);
    if (B) c.push({ w: 2, type: 'rendezvous', target: t, bld: B.idx, n: 10 });
  }
  // occupy houses near German positions and make strongpoints of them
  {
    const ref = [...w.strongpoints.filter((s) => s.owner === 'axis'), ...w.wpAxis];
    const B = this._pickBuilding('axis', (B) => ref.some((r) => Math.hypot(r.x - B.cx, r.z - B.cz) < 90));
    if (B) c.push({ w: d.front ? 1.6 : 1.1, type: 'garrison', bld: B.idx, target: { x: B.cx, z: B.cz }, n: Math.min(6, B.posts.length) });
  }
  if (d.front) {
    if (this.cfg.front && this.cfg.front.attacker === 'axis' && !d.ops.some((o) => o.type === 'counterattack' && o.state === 'move')) c.push({ w: 2, type: 'counterattack', target: w.wpAllies[Math.floor(Math.random() * w.wpAllies.length)], n: 10 });
    c.push({ w: 1.3, type: 'probe', n: 5 });
    const bat = this.batteries && this.batteries.some((b) => b.team === 'axis' && b.alive);
    if (bat && !d.ops.some((o) => o.type === 'fo' && o.team === 'axis' && o.state !== 'over')) {
      const vp = w.wpAxis.slice().sort((a, b) => b.z - a.z)[0];
      if (vp) c.push({ w: 1.2, type: 'fo', target: vp, n: 2 });
    }
  }
  c.push({ w: 1, type: 'patrol', n: 4 });
  const dumps = w.assets.filter((a) => a.alive && !a.sub);
  if (dumps.length) c.push({ w: 0.8, type: 'supply', target: dumps[Math.floor(Math.random() * dumps.length)], n: 4 });
  return pickW(c);
};

// ---------- launching ----------
D._edgeSpawn = function (team, nearX) {
  const p = this.player.pos, cam = this.camera.position;
  const z = team === 'allies' ? HALF - 25 : -HALF + 25;
  let best = null;
  for (let k = 0; k < 8; k++) {
    const x = clamp((nearX ?? 0) + (Math.random() - 0.5) * (k < 4 ? 260 : 2 * HALF), -HALF + 30, HALF - 30);
    const dd = Math.min(Math.hypot(x - p.x, z - p.z), Math.hypot(x - cam.x, z - cam.z));
    if (!best || dd > best.dd) best = { x, z, dd };
    if (dd > 160) break;
  }
  return best;
};
D._launch = function (team, op) {
  const w = this.world, d = this.dir;
  const n = Math.max(1, Math.min(op.n, d.pool[team], d.cap - this._mobileAlive(team) + 2));
  if (n < (op.type === 'fo' ? 1 : 2)) return;
  d.pool[team] -= n;
  const tx = op.target ? op.target.x : (Math.random() - 0.5) * HALF;
  const at = this._edgeSpawn(team, tx);
  const props = { mobile: true, op, leg: 0 };
  const idx = (t) => (t.nav ? t.nav.idx : w.targets.indexOf(t));
  const fwdA = w.wpAxis.slice().sort((a, b) => b.z - a.z), rearA = fwdA[fwdA.length - 1];
  const fwdAl = w.wpAllies.slice().sort((a, b) => a.z - b.z);
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
  switch (op.type) {
    case 'assault': case 'counterattack': case 'reinforce': case 'defend': case 'fo': case 'sabotage':
      Object.assign(props, { role: 'assault', obj: idx(op.target) }); break;
    case 'recon': { // out to look at the German line and back
      const look = fwdA.slice(0, 3).sort(() => Math.random() - 0.5).slice(0, 2);
      Object.assign(props, { role: 'route', route: [...look.map((t) => t.idx), rnd(w.wpAllies).idx], once: true, speed: 2.4 }); break;
    }
    case 'probe': // Stosstrupp: into the Allied side and back
      Object.assign(props, { role: 'route', route: [fwdA[0].idx, rnd(fwdAl.slice(0, 3)).idx, fwdA[0].idx, rearA.idx], once: true, speed: 2.8 }); break;
    case 'patrol': {
      const r3 = w.wpAxis.slice().sort(() => Math.random() - 0.5).slice(0, 3).map((t) => t.idx);
      Object.assign(props, { role: 'route', route: [...r3, rearA.idx], once: true, speed: 2.0 }); break;
    }
    case 'supply':
      Object.assign(props, { role: 'route', route: [idx(op.target), rearA.idx], once: true, speed: 2.2 }); break;
  }
  // garrisons face the enemy side of the sector
  const face = { x: op.target ? op.target.x : 0, z: team === 'allies' ? -HALF : HALF };
  if (op.type === 'garrison' || op.type === 'rendezvous') Object.assign(props, { role: 'garrison', bld: op.bld, face });
  const classes = op.type === 'sabotage' ? SAPPERS : op.type === 'fo' ? ['rifleman', 'assault'] : MIX;
  const raise = (sq, k, m, p) => {
    for (let i = 0; i < m; i++) {
      const b = this._bot(team, classes[(i + k) % classes.length], sq, p.x, p.z, 8);
      b.alert = !(team === 'axis' && (op.type === 'patrol' || op.type === 'supply' || op.type === 'reinforce' || op.type === 'garrison'));
      b.yaw = team === 'allies' ? Math.PI : 0;
    }
  };
  const sq = this._squad(team, props);
  let sq2 = null;
  if (op.type === 'rendezvous' && n >= 4) {
    // the second platoon comes in from another part of the line
    const m = Math.floor(n / 2);
    sq2 = this._squad(team, { ...props });
    const at2 = this._edgeSpawn(team, clamp(tx + (at.x < tx ? 1 : -1) * (90 + Math.random() * 80), -HALF + 30, HALF - 30));
    raise(sq, 0, n - m, at); raise(sq2, 1, m, at2);
  } else raise(sq, 0, n, at);
  this.combatants = [...this.bots, this.player];
  const rec = { ...op, team, sq, sq2, state: 'move', t0: this.time, held: 0 };
  // objectives the strategic battle cares about (weights feed frontBias)
  const W = { assault: 0.15, counterattack: 0.15, rendezvous: 0.15, recon: 0.05, probe: 0.04, sabotage: 0.05 }[op.type];
  if (W) {
    const label = { assault: 'assault', counterattack: 'counterattack', rendezvous: team === 'allies' ? 'assault' : 'counterattack', recon: 'recon', probe: 'raid', sabotage: 'sabotage' }[op.type];
    rec.obj = { team, target: op.target || null, label, held: 0, done: false, squad: sq, w: W, manual: !op.target || op.type === 'sabotage' };
    this.aiObjectives.push(rec.obj);
  }
  d.ops.push(rec);
};

// ---------- running operations ----------
D._setRole = function (sq, role, obj) {
  sq.role = role; if (obj !== undefined) sq.obj = obj;
  for (const b of sq.members) if (b.alive) { b.role = role; if (b.holdPt && b.holdPt.occ === b) b.holdPt.occ = null; b.holdPt = null; }
};
D._retireFar = function (sq) {
  const cam = this.camera.position;
  for (const b of sq.members) {
    if (!b.alive || b.state === 'engage') continue;
    if (Math.hypot(b.pos.x - cam.x, b.pos.z - cam.z) > 130) { b.alive = false; b.retired = true; b.model.visible = false; this.dir.pool[b.team]++; }
  }
};
D._report = function (text, type, minor = false) {
  const d = this.dir;
  d.report.push(text);
  // keep the field radio quiet: setbacks only every so often, successes always
  if (minor && this.time - d.newsT < 90) return;
  d.newsT = this.time;
  if (this.cb.onNews) this.cb.onNews(text, type);
};
D._dirOps = function (dt) {
  const w = this.world;
  for (const op of this.dir.ops) {
    if (op.state === 'over') continue;
    if (op.sq2 && !op.sq.members.some((b) => b.alive)) { op.sq = op.sq2; op.sq2 = null; if (op.obj) op.obj.squad = op.sq; }
    const sq = op.sq, alive = sq.members.filter((b) => b.alive);
    if (!alive.length) {
      if (op.state === 'move' && !sq.members.some((b) => b.retired) && !sq.anyRetired) {
        if (op.type === 'assault') this._report(`An Allied assault on a German position has been beaten back`, 'bad', true);
        if (op.type === 'counterattack' || (op.type === 'rendezvous' && op.team === 'axis')) this._report(`A German counterattack has been thrown back`, 'good', true);
        if (op.type === 'rendezvous' && op.team === 'allies') this._report(`An Allied assault on a German position has been beaten back`, 'bad', true);
        if (op.type === 'sabotage') this._report(`An Allied engineer team was wiped out before reaching its target`, 'bad', true);
      }
      op.state = 'over'; sq.mobile = false; continue;
    }
    const lead = alive[0];
    switch (op.type) {
      case 'assault': case 'counterattack':
        if (op.obj && op.obj.done) { op.state = 'over'; sq.mobile = false; this._setRole(sq, 'guard'); }
        break;
      case 'reinforce': case 'defend': {
        if (near(lead.pos, op.target) < (op.target.r || op.target.radius || 10) + 6) {
          if (op.join) { // fold into the depleted garrison
            for (const b of alive) { b.squad = op.join; b.squadRef = op.join; b.role = op.join.role; b.holdPt = null; op.join.members.push(b); }
            sq.members = []; op.join.full = Math.max(op.join.full, op.join.members.filter((b) => b.alive).length);
          } else this._setRole(sq, 'guard');
          op.state = 'over'; sq.mobile = false;
        }
        break;
      }
      case 'garrison': {
        // in position once most of the squad is inside
        const inside = alive.filter((b) => w.bldAt(b.pos.x, b.pos.z) === op.bld).length;
        if (inside >= Math.max(1, Math.ceil(alive.length * 0.6)) || this.time - op.t0 > 420) { op.state = 'over'; sq.mobile = false; }
        break;
      }
      case 'rendezvous': {
        if (op.state === 'act') { if (op.obj && op.obj.done) { op.state = 'over'; sq.mobile = false; this._setRole(sq, 'guard'); } break; }
        const B = w.buildings[op.bld];
        const there = (q) => { const a = q.members.filter((b) => b.alive); return a.length > 0 && a.filter((b) => Math.hypot(b.pos.x - B.cx, b.pos.z - B.cz) < 20).length >= Math.ceil(a.length * 0.6); };
        const a1 = there(sq), a2 = !op.sq2 || there(op.sq2);
        if ((a1 || a2) && op.metT === undefined) op.metT = this.time;
        if ((a1 && a2) || (op.metT !== undefined && this.time - op.metT > 150) || this.time - op.t0 > 480) {
          // linked up: one force, on to the objective
          if (op.sq2) {
            for (const b of op.sq2.members) if (b.alive) { b.squad = sq; b.squadRef = sq; sq.members.push(b); }
            op.sq2.members = []; op.sq2.mobile = false; op.sq2 = null;
          }
          const t = op.target;
          this._setRole(sq, 'assault', t.nav ? t.nav.idx : w.targets.indexOf(t));
          op.state = 'act';
          if (op.team === 'axis') this._report('German infantry has formed up in a village for a counterattack', 'bad', true);
          else this._report('Two Allied platoons have linked up and are moving to attack', 'good', true);
        }
        break;
      }
      case 'fo': // observers spot for their guns once in position
        op.active = near(lead.pos, op.target) < 18;
        break;
      case 'sabotage': {
        const a = op.target;
        if (!a.alive) {
          if (op.state === 'move') { op.state = 'act'; this._setRole(sq, 'route'); sq.route = [w.wpAllies[0].idx]; sq.once = true; sq.leg = 0; sq.speed = 3.4; }
          else if (sq.leg >= sq.route.length) this._retireFar(sq);
          break;
        }
        const at = alive.some((b) => near(b.pos, a) < a.r + 5);
        const guards = this.bots.some((b) => b.alive && b.team === 'axis' && near(b.pos, a) < a.r + 14);
        op.held = at && !guards ? op.held + dt : Math.max(0, op.held - dt * 0.5);
        if (op.held > 12) {
          a.hp = 0; this._destroyAsset(a, null);
          if (op.obj) op.obj.done = true;
          const T = ASSET_TYPES[a.type];
          this._report(`Allied engineers have blown up a German ${(T ? T.label : 'position').toLowerCase()}`, 'good');
        }
        break;
      }
      default: { // route operations: recon, probe, patrol, supply
        if (sq.leg >= sq.route.length) {
          if (op.obj && !op.obj.done && alive.length >= 2) {
            op.obj.done = true;
            if (op.type === 'recon') this._report('An Allied patrol has come back with a picture of the German line', 'good');
            if (op.type === 'probe') this._report('A German trench raid has hit the Allied side of the sector', 'bad');
          }
          this._retireFar(sq);
        }
      }
    }
    if (op.type !== 'fo' && this.time - op.t0 > 600 && op.state === 'move' && sq.role === 'route') this._retireFar(sq); // stragglers
  }
};

// German and Allied observers: is a team in position?
D._observer = function (team) {
  return this.dir ? this.dir.ops.find((o) => o.type === 'fo' && o.team === team && o.active && o.sq.members.some((b) => b.alive)) : null;
};

export const DIRECTOR = D;

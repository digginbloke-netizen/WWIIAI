// In-battle HUD: crosshair, health, ammo, tickets, flags, minimap, kill feed, scoreboard.
import { HALF } from './world.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class HUD {
  constructor(root, battle) {
    this.b = battle;
    this.root = root;
    root.innerHTML = `
      <div id="vignette"></div><div id="hurtfx"></div>
      <div id="xhair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b></b></div>
      <div id="hitm"></div>
      <div id="dmgdir"></div>
      <div id="topbar">
        <div class="tk ally"><span class="nm">ALLIES</span><div class="bar"><i></i></div><b></b></div>
        <div id="flagsHud"></div>
        <div class="tk axis"><b></b><div class="bar"><i></i></div><span class="nm">AXIS</span></div>
      </div>
      <div id="timer"></div>
      <div id="centerMsg"></div>
      <div id="capture"><span></span><div class="bar"><i></i></div></div>
      <canvas id="minimap" width="200" height="200"></canvas>
      <div id="killfeed"></div>
      <div id="objectives"></div>
      <div id="news"></div>
      <div id="chat"></div>
      <div id="scope"><i class="h"></i><i class="v"></i></div>
      <div id="frontclock"></div>
      <div id="prompt"></div>
      <div id="squadHud"></div>
      <div id="status"><div class="hp"><span>HEALTH</span><div class="bar"><i></i></div></div><div class="st"><div class="bar"><i></i></div></div></div>
      <div id="weapon"><div class="wn"></div><div class="am"><b></b> / <span></span></div><div class="gr"></div><div class="sp"></div></div>
      <div id="help">${battle.isMission ? 'WASD move · Shift sprint · C crouch · RMB aim · R reload · G grenade · F demo charge · E interact/extract · Q squad hold/follow · H medkit · B radio · M sector map · Esc menu' : 'WASD move · Shift sprint · C crouch · Space jump · RMB aim · R reload · G grenade · B artillery · V air strike · Tab score · M map · Esc menu'}</div>
      <div id="scoreboard"></div>`;
    this.$ = (s) => root.querySelector(s);
    this.feed = [];
    this.mm = this.$('#minimap');
    this.mctx = this.mm.getContext('2d');
    this.big = false;
    this.msgT = 0; this.hitT = 0;
    this._mapBase();
  }

  _mapBase() {
    const w = this.b.world;
    const R = w.big ? 1024 : 240;
    const c = document.createElement('canvas'); c.width = R; c.height = R;
    const g = c.getContext('2d');
    const s = R / (HALF * 2);
    this.baseScale = s;
    g.fillStyle = w.cfg.winter ? '#a9b0b6' : w.cfg.terrain === 'beach' && !w.big ? '#7d7458' : '#4b5636';
    g.fillRect(0, 0, R, R);
    if (w.water) { g.fillStyle = '#3d5a66'; g.fillRect(0, (92 + w.waterOffset() + HALF) * s, R, R); }
    if (w.roads) {
      g.strokeStyle = '#8a7650'; g.lineCap = 'round';
      for (const rd of w.roads) { g.lineWidth = Math.max(1.5, rd.w * s); g.beginPath(); rd.pts.forEach(([x, z], i) => (i ? g.lineTo((x + HALF) * s, (z + HALF) * s) : g.moveTo((x + HALF) * s, (z + HALF) * s))); g.stroke(); }
    }
    g.fillStyle = 'rgba(30,50,25,0.55)';
    for (const t of w.trees) if (Math.abs(t.x) < HALF && Math.abs(t.z) < HALF) g.fillRect((t.x + HALF) * s - 1.5, (t.z + HALF) * s - 1.5, 3, 3);
    for (const o of w.obstacles) {
      if (o.type !== 'box') continue;
      if (Math.abs(o.x0) > HALF + 5 || Math.abs(o.z0) > HALF + 5) continue;
      g.fillStyle = o.mat === 'hedge' ? '#2b3a1f' : o.mat === 'sandbag' ? '#9a8a60' : o.mat === 'fence' ? '#5a4a3a' : '#2d2a26';
      g.fillRect((o.x0 + HALF) * s, (o.z0 + HALF) * s, Math.max(1, (o.x1 - o.x0) * s), Math.max(1, (o.z1 - o.z0) * s));
    }
    this.mapBase = c;
  }

  message(t, dur = 2.5) { const m = this.$('#centerMsg'); m.innerHTML = t; m.style.opacity = 1; this.msgT = dur; }
  hitmarker(head, kill) {
    const h = this.$('#hitm'); h.className = kill ? 'kill' : head ? 'head' : 'hit'; h.style.opacity = 1; this.hitT = 0.25;
  }
  damageFrom(rel) {
    const el = document.createElement('div'); el.className = 'dmgarc';
    el.style.transform = `translate(-50%,-50%) rotate(${-rel}rad)`;
    this.$('#dmgdir').appendChild(el);
    setTimeout(() => el.remove(), 900);
    const h = this.$('#hurtfx'); h.style.opacity = 0.6; setTimeout(() => (h.style.opacity = 0), 120);
  }
  kill(killer, victim, weapon, head) {
    const pt = this.b.playerTeam;
    const cls = (s) => (s.isPlayer ? 'me' : s.team === pt ? 'fr' : 'en');
    this.feed.unshift({ html: `<span class="${killer ? cls(killer) : ''}">${killer ? esc(killer.name) : ''}</span> <i>[${esc(weapon)}${head ? ' ✸' : ''}]</i> <span class="${cls(victim)}">${esc(victim.name)}</span>`, t: 6 });
    if (this.feed.length > 6) this.feed.pop();
  }

  update(dt) {
    const b = this.b, p = b.player;
    // fades
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.$('#centerMsg').style.opacity = 0; }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.$('#hitm').style.opacity = 0; }
    if (b.isMission) this._mission();
    // tickets
    const T = b.tickets, T0 = b.tickets0;
    const ta = this.$('.tk.ally'), tx = this.$('.tk.axis');
    ta.querySelector('b').textContent = T.allies; tx.querySelector('b').textContent = T.axis;
    ta.querySelector('i').style.width = (100 * T.allies / T0.allies) + '%';
    tx.querySelector('i').style.width = (100 * T.axis / T0.axis) + '%';
    // flags
    this.$('#flagsHud').innerHTML = b.world.flags.map((f) => {
      const c = f.owner === 'allies' ? 'ally' : f.owner === 'axis' ? 'axis' : 'neu';
      const pr = Math.abs(f.progress);
      const pc = f.progress > 0 ? 'ally' : 'axis';
      return `<div class="fl ${c}${f.contested ? ' cont' : ''}"><b>${f.letter}</b><i class="${pc}" style="height:${pr * 100}%"></i></div>`;
    }).join('');
    const tl = Math.max(0, b.timeLimit - b.time);
    this.$('#timer').textContent = `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
    // capture status
    const cap = this.$('#capture');
    const f = p.alive ? b.world.flags.find((f) => Math.hypot(f.x - p.pos.x, f.z - p.pos.z) < f.radius) : null;
    if (f) {
      cap.style.display = 'block';
      const mine = f.owner === p.team;
      cap.querySelector('span').textContent = f.contested ? `CONTESTED ${f.letter}` : mine ? `HOLDING ${f.letter}` : `CAPTURING ${f.letter}`;
      cap.querySelector('i').style.width = (Math.abs(f.progress) * 100) + '%';
      cap.querySelector('i').className = f.progress > 0 ? 'ally' : 'axis';
    } else cap.style.display = 'none';
    // player status
    if (p.alive) {
      this.$('#status .hp i').style.width = Math.max(0, p.health) + '%';
      this.$('#status .hp i').style.background = p.health < 35 ? '#c33' : '#d8d0b0';
      this.$('#status .st i').style.width = (p.stamina * 100) + '%';
      this.$('#weapon .wn').textContent = p.w.name;
      this.$('#weapon .am b').textContent = p.reloadT > 0 ? '--' : p.mag;
      this.$('#weapon .am span').textContent = p.ammo;
      this.$('#weapon .gr').textContent = `Grenades ${'●'.repeat(p.grenades)}${'○'.repeat(Math.max(0, 3 - p.grenades))}`;
      this.$('#weapon .sp').innerHTML = b.isMission ? `${b.support.art ? `[B] Artillery ×${b.support.art} · ` : ''}[F] Demo charges ${'■'.repeat(p.satchels || 0)} · [Q] Squad ${b.squadHold ? 'HOLD' : 'FOLLOW'}` : `[B] Artillery ×${b.support.art} · [V] Air ×${b.support.air}`;
      const sp = (p.w.spread + p.bloom * 0.02 + (p.moving ? p.w.moveSpread : 0)) * (1 - p.ads * 0.65);
      const gap = 6 + sp * 600;
      const xh = this.$('#xhair');
      xh.style.setProperty('--gap', gap + 'px');
      xh.style.opacity = p.ads > 0.6 ? 0 : 1;
      const low = Math.max(0, 1 - p.health / 60);
      this.$('#vignette').style.opacity = Math.min(1, low * 0.9 + p.suppress * 0.5);
    }
    this.root.classList.toggle('dead', !p.alive);
    // kill feed
    for (const k of this.feed) k.t -= dt;
    this.feed = this.feed.filter((k) => k.t > 0);
    const kf = this.feed.map((k) => `<div style="opacity:${Math.min(1, k.t)}">${k.html}</div>`).join('');
    if (kf !== this._kf) { this.$('#killfeed').innerHTML = kf; this._kf = kf; }
    this._minimap();
    if (b.keys.Tab) this._scoreboard(); else this.$('#scoreboard').style.display = 'none';
  }

  _minimap() {
    const b = this.b, p = b.player, g = this.mctx, w = b.world;
    const big = this.big;
    const S = big ? 560 : 200;
    if (this.mm.width !== S) { this.mm.width = S; this.mm.height = S; this.mm.classList.toggle('big', big); }
    // on full sectors the small map follows the player; M shows the whole sector
    const local = w.big && !big;
    const span = local ? 340 : HALF * 2;
    const cx = local ? p.pos.x : 0, cz = local ? p.pos.z : 0;
    const sc = S / span;
    const X = (x) => (x - cx) * sc + S / 2, Z = (z) => (z - cz) * sc + S / 2;
    g.fillStyle = '#1f2418'; g.fillRect(0, 0, S, S);
    g.globalAlpha = 0.92;
    const bs = this.baseScale;
    g.drawImage(this.mapBase, (cx - span / 2 + HALF) * bs, (cz - span / 2 + HALF) * bs, span * bs, span * bs, 0, 0, S, S);
    g.globalAlpha = 1;
    g.font = `bold ${big ? 13 : 10}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const f of w.flags) {
      g.beginPath(); g.arc(X(f.x), Z(f.z), f.radius * sc, 0, 6.28);
      g.fillStyle = f.owner === 'allies' ? 'rgba(70,130,220,0.35)' : f.owner === 'axis' ? 'rgba(200,60,50,0.35)' : 'rgba(230,230,230,0.25)';
      g.fill(); g.strokeStyle = '#eee'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#fff'; g.fillText(f.letter, X(f.x), Z(f.z));
    }
    if (b.isMission) {
      g.strokeStyle = '#7dff8a'; g.lineWidth = 2; g.strokeRect(X(w.exfil.x) - 6, Z(w.exfil.z) - 6, 12, 12);
      g.fillStyle = '#7dff8a'; g.fillText('EXFIL', X(w.exfil.x), Z(w.exfil.z) - 12);
      for (const a of w.assets) {
        if (!a.known && !a.primary) continue;
        const x = X(a.x), z = Z(a.z);
        g.fillStyle = !a.alive ? '#555' : a.primary ? '#ffd04a' : '#ff8a5a';
        g.beginPath(); g.moveTo(x, z - 7); g.lineTo(x + 7, z); g.lineTo(x, z + 7); g.lineTo(x - 7, z); g.closePath(); g.fill();
        g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
      }
      if (w.sites.ops) w.sites.ops.forEach((o, i) => { g.strokeStyle = o.done ? '#555' : '#7fd0ff'; g.lineWidth = 2; g.beginPath(); g.arc(X(o.x), Z(o.z), 7, 0, 6.28); g.stroke(); g.fillStyle = '#7fd0ff'; g.fillText(String(i + 1), X(o.x), Z(o.z)); });
      if (w.sites.hq) { g.fillStyle = '#ffd04a'; g.fillText('HQ', X(w.sites.hq.x), Z(w.sites.hq.z)); }
      if (w.sites.pow) { g.fillStyle = '#9fe0a0'; g.fillText('POW', X(w.sites.pow.x), Z(w.sites.pow.z)); }
      if (w.sites.defend) { const d = w.sites.defend; g.strokeStyle = '#7fd0ff'; g.lineWidth = 2; g.beginPath(); g.arc(X(d.x), Z(d.z), 8, 0, 6.28); g.stroke(); g.fillStyle = '#7fd0ff'; g.fillText('HOLD', X(d.x), Z(d.z) - 12); }
      if (w.sites.convoy) { g.strokeStyle = 'rgba(255,208,74,0.5)'; g.setLineDash([4, 4]); g.lineWidth = 2; g.beginPath(); w.sites.convoy.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); g.setLineDash([]); }
      for (const v of b.vehicles || []) if (v.mesh.visible && (v.alive ? Math.hypot(v.x - p.pos.x, v.z - p.pos.z) < 250 : true)) { g.fillStyle = v.alive ? '#ffd04a' : '#555'; g.fillRect(X(v.x) - 4, Z(v.z) - 3, 8, 6); }
    }
    for (const s of b.bots) {
      if (!s.alive) continue;
      if (s.role === 'follow') { g.fillStyle = s.unarmed ? '#c8ffc8' : '#7dff8a'; g.beginPath(); g.arc(X(s.pos.x), Z(s.pos.z), 3, 0, 6.28); g.fill(); continue; }
      if (s.team === b.playerTeam) { if (s.role !== 'captive') { g.fillStyle = '#7fc0ff'; g.fillRect(X(s.pos.x) - 2, Z(s.pos.z) - 2, 4, 4); } }
      else if (b.time - (s.spottedT || -9) < 2 || b.time - (s.firedT || -9) < 1.2) { g.fillStyle = '#ff5544'; g.fillRect(X(s.pos.x) - 2, Z(s.pos.z) - 2, 4, 4); }
    }
    for (const a of b.artyMarks) { g.strokeStyle = 'rgba(255,200,0,0.9)'; g.beginPath(); g.arc(X(a.x), Z(a.z), 14 * sc, 0, 6.28); g.stroke(); }
    if (p.alive) {
      const x = X(p.pos.x), z = Z(p.pos.z);
      g.save(); g.translate(x, z); g.rotate(-p.yaw + Math.PI);
      g.fillStyle = '#ffe066'; g.beginPath(); g.moveTo(0, 7); g.lineTo(5, -5); g.lineTo(-5, -5); g.closePath(); g.fill();
      g.restore();
    }
  }


  toggleMap() { this.big = !this.big; }

  // battle chatter subtitles
  chat(name, text, friendly) {
    const el = document.createElement('div'); el.className = friendly ? 'fr' : 'en';
    const n = document.createElement('b'); n.textContent = name + ': '; el.appendChild(n);
    el.appendChild(document.createTextNode(text));
    const box = this.$('#chat'); box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 600); }, 3500);
  }

  // front news reaching the squad in the field
  news(text, type = 'info') {
    const el = document.createElement('div'); el.className = type;
    el.textContent = 'FRONT: ' + text;
    const box = this.$('#news'); box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 700); }, 7000);
  }

  _mission() {
    const b = this.b;
    this.$('#topbar').style.display = 'none';
    this.$('#timer').style.display = 'none';
    const rows = [`<div class="obh">${b.stealth ? '<span class="stealth">UNDETECTED</span>' : '<span class="alarm">ALARM</span>'}</div>`];
    for (const [txt, done] of b.objectiveText()) rows.push(`<div class="${done ? 'done' : ''}">${txt}</div>`);
    const extra = b.world.assets.filter((a) => !a.sub && !a.primary && a.known);
    for (const a of extra) rows.push(`<div class="sec ${a.alive ? '' : 'done'}">◆ ${a.type === 'trucks' ? 'Truck park' : a.type[0].toUpperCase() + a.type.slice(1)} (secondary)</div>`);
    rows.push(`<div class="sec">${b.objectiveDone() ? '➜ ' : ''}Extract at EXFIL [E]</div>`);
    if (b.medkits) rows.push('<div class="sec">[H] Medical kit ready</div>');
    const html = rows.join('');
    if (html !== this._ob) { this.$('#objectives').innerHTML = html; this._ob = html; }
    const fc = b.frontCountdown !== undefined ? `FRONT UPDATE ${Math.max(0, Math.ceil(b.frontCountdown))}s · ${b.frontDate || ''}` : '';
    if (fc !== this._fc) { this.$('#frontclock').textContent = fc; this._fc = fc; }
    this.$('#scope').style.display = b.player.alive && b.player.scoped ? 'block' : 'none';
    const pr = b.prompt || '';
    if (pr !== this._pr) { this.$('#prompt').textContent = pr; this.$('#prompt').style.display = pr ? 'block' : 'none'; this._pr = pr; }
    const sq = b.roster.map((m, i) => {
      const bot = b.rangers.find((r) => r.rosterIdx === i);
      const hp = i === b.controlIdx ? (b.player.alive ? b.player.health : 0) : bot && bot.alive ? bot.health : 0;
      const nm = m.name === 'You' ? 'You' : m.name;
      return `<div class="${hp <= 0 ? 'down' : ''}${i === b.controlIdx ? ' me' : ''}"><span>${m.rank} ${nm}</span><i style="width:${Math.max(0, hp) * 0.6}px"></i></div>`;
    }).join('');
    if (sq !== this._sq) { this.$('#squadHud').innerHTML = sq; this._sq = sq; }
  }

  _scoreboard() {
    const b = this.b, el = this.$('#scoreboard');
    el.style.display = 'flex';
    const row = (s) => `<tr class="${s.isPlayer ? 'me' : ''} ${s.alive ? '' : 'deadr'}"><td>${esc(s.name)}</td><td>${s.kills}</td><td>${s.deaths}</td></tr>`;
    const side = (team) => [...b.bots.filter((s) => s.team === team), ...(b.player.team === team ? [b.player] : [])].sort((a, c) => c.kills - a.kills);
    const tbl = (team, title) => `<div><h3>${title} — ${b.tickets[team]} tickets</h3><table><tr><th>Name</th><th>K</th><th>D</th></tr>${side(team).slice(0, 26).map(row).join('')}</table></div>`;
    el.innerHTML = tbl('allies', 'Allies') + tbl('axis', 'Wehrmacht');
  }
}

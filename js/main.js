// App controller: switches between title, campaign map and first-person battles.
import * as C from './campaign/campaign.js';
import * as F from './campaign/front.js';
import * as O from './campaign/ops.js';
import { CampaignUI } from './campaign/campaignUI.js';
import { REGIONS, TERRAIN_INFO, WEATHER, ASSET_TYPES } from './campaign/data.js';
import { Battle } from './battle/battle.js';
import { Mission, SUB_LABEL } from './battle/mission.js';
import { CLASSES, WEAPONS } from './battle/weapons.js';
import { audio } from './audio.js';
import { loadPhotos } from './battle/textures.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

const app = {
  state: null,
  battle: null,
  battleRef: null,
  ui: null,
  cls: localStorage.getItem('rtb.cls') || 'rifleman',
  spawnIdx: 0,

  tickAcc: 0,
  frontPaused: false,

  init() {
    this.ui = new CampaignUI(this);
    // real-time front clock
    let last = performance.now();
    setInterval(() => {
      const now = performance.now(), dt = Math.min(1, (now - last) / 1000); last = now;
      if (!this._clockRunning()) return;
      // in the field an operation lasts hours, not months: the front advances a day per minute
      const T = this.battle && this.battle.isMission ? 60 : F.TICK_SECONDS;
      this.tickAcc += dt;
      if (this.battle && this.battle.isMission) this.battle.frontCountdown = T - this.tickAcc;
      if (this.tickAcc >= T) { this.tickAcc -= T; this._frontTick(); }
    }, 200);
    const sv = C.loadCampaign();
    $('#btnContinue').style.display = sv && sv.phase !== 'over' ? '' : 'none';
    $('#btnContinue').onclick = () => { audio.init(); this.openCampaign(C.loadCampaign()); };
    $('#btnNew').onclick = () => {
      audio.init();
      if (C.loadCampaign() && !confirm('Start a new campaign? Your saved campaign will be replaced.')) return;
      const s = C.newCampaign(this.settings());
      F.startFront(s); O.initOps(s); this.tickAcc = 0; this.frontPaused = false;
      C.saveCampaign(s); this.openCampaign(s);
    };
    $('#btnHow').onclick = () => { const h = $('#how'); h.hidden = !h.hidden; };
    const sens = localStorage.getItem('rtb.sens'); if (sens) $('#setSens').value = sens;
    const vol = localStorage.getItem('rtb.vol'); if (vol) { $('#setVol').value = vol; audio.setVolume(+vol); }
    const diff = localStorage.getItem('rtb.diff'); if (diff) $('#setDiff').value = diff;
    const bots = localStorage.getItem('rtb.bots'); if (bots) $('#setBots').value = bots;
    const gfx = localStorage.getItem('rtb.gfx'); if (gfx) $('#setGfx').value = gfx;
    const chat = localStorage.getItem('rtb.chatter'); $('#setChat').value = chat === 'off' ? 'off' : 'subs';
    $('#setChat').onchange = (e) => localStorage.setItem('rtb.chatter', e.target.value);
    $('#setGfx').onchange = (e) => localStorage.setItem('rtb.gfx', e.target.value);
    this.photos = loadPhotos(); // photo textures load in the background
    const tick = localStorage.getItem('rtb.tick'); if (tick) $('#setTick').value = tick;
    F.setTickSeconds($('#setTick').value);
    $('#setTick').onchange = (e) => { localStorage.setItem('rtb.tick', e.target.value); F.setTickSeconds(e.target.value); this.tickAcc = 0; };
    $('#setSens').oninput = (e) => localStorage.setItem('rtb.sens', e.target.value);
    $('#setVol').oninput = (e) => { localStorage.setItem('rtb.vol', e.target.value); audio.setVolume(+e.target.value); };
    $('#setDiff').onchange = (e) => { localStorage.setItem('rtb.diff', e.target.value); if (this.state) this.state.settings.difficulty = e.target.value; };
    $('#setBots').onchange = (e) => { localStorage.setItem('rtb.bots', e.target.value); if (this.state) this.state.settings.botCap = +e.target.value; };
  },

  settings() { return { difficulty: $('#setDiff').value, botCap: +$('#setBots').value }; },

  showTitle() {
    this.ui.close();
    const sv = C.loadCampaign();
    $('#btnContinue').style.display = sv && sv.phase !== 'over' ? '' : 'none';
    show('title');
  },

  openCampaign(s) {
    if (!s.strategic) O.initOps(s); // older saves
    this.state = s;
    // apply current menu settings to a loaded campaign
    s.settings = this.settings();
    show('campaign');
    this.ui.open(s);
  },

  // ---------- battles ----------
  startBattle(b) {
    const cfg = C.battleConfig(this.state, b);
    this.battleRef = b;
    this._launch(cfg);
  },

  _clockRunning() {
    const s = this.state;
    if (!s || s.phase === 'over' || s.day === undefined) return false;
    if (document.querySelector('#title').classList.contains('active')) return false;
    if (this.battle) return this.battle.isMission && !this.battle.paused && !this.battle.over;
    return !this.frontPaused;
  },
  toggleFrontPause() { this.frontPaused = !this.frontPaused; audio.ui(); this.ui.refresh(); },

  _frontTick() {
    const s = this.state, b = this.battle;
    // the battle the Rangers are watching feeds its strategic counterpart
    if (b && b.isMission && b.cfg.front) F.setFrontState(s, b.cfg.front.battleId, b.frontBias(), null);
    const ev = F.frontTick(s);
    if (b && b.isMission) { const d = C.currentDate(s); b.frontDate = d.toUTCString().slice(5, 16); }
    if (b && b.isMission) {
      const region = b.cfg.regionIdx;
      // the log only carries news from the Rangers' own sector and province-wide events: pass on the headlines
      for (const e of ev) if (e.type !== 'info' || /offensive begins/i.test(e.text)) b.hud.news(e.text, e.type);
      if (s.regions[region].owner === 'allies' && !b.sectorTaken) { b.sectorTaken = true; b.hud.message(`${REGIONS[region].name} has been taken by Allied forces!`, 4); }
    } else if (document.querySelector('#campaign').classList.contains('active')) this.ui.onTick(ev);
  },

  // Briefing for a mission on the board, then launch it.
  briefMission(missionId) {
    const s = this.state, el = $('#battles');
    const mission = (s.board || []).find((m) => m.id === missionId);
    if (!mission) return;
    if (!s.squad.some((m) => m.status === 'active')) { this.ui.toast('The squad is refitting — replacements arrive at the start of next week.'); return; }
    const region = mission.region, r = REGIONS[region];
    const b = s.battles.find((x) => x.to === region || x.from === region);
    const depth = C.missionDepth(s)[region];
    const T = O.MISSION_TYPES[mission.type];
    const assets = s.assets[region] || [];
    el.style.display = 'flex';
    el.innerHTML = `<div class="modal"><div class="stamp">${esc(T.label.toUpperCase())} · ${esc(TERRAIN_INFO[r.terrain].label)} · ${esc(WEATHER[s.weather].label)}</div>
      <h2>${esc(r.name)}</h2>
      <div class="asset"><span class="ic">${T.icon}</span><span class="tx"><b>${esc(mission.title)}</b><small>${esc(mission.desc)}</small></span></div>
      <p>${mission.type === 'defense' ? `An Allied-held sector under German attack (${b ? b.att : '?'} German troops against ${s.regions[region].troops} defenders). Waves of infantry will come at the position after an artillery barrage.` : depth ? `This sector lies <b>${depth} sector${depth > 1 ? 's' : ''} behind enemy lines</b>: you are on your own.` : 'A front-line sector: friendly units are operating in the area, on their own orders.'}
      ${b && mission.type !== 'defense' ? `<br>${b.attacker === 'allies' ? 'An Allied offensive' : 'A German attack'} is under way here. Expect heavy fighting somewhere in the sector.` : ''}</p>
      <p class="muted">The sector is a full square kilometre. ${mission.type === 'defense' ? 'Allied' : 'Estimated'} garrison: ${s.regions[region].troops} troops. ${assets.length ? `Other enemy assets reported: ${assets.map((a) => esc(ASSET_TYPES[a.type].label.toLowerCase())).join(', ')}.` : ''}
      Deadline: ${mission.deadline - s.day} days. Reward: ${mission.reward} points.</p>
      <div class="row end"><button id="brCancel">Back</button><button id="brGo" class="primary big">Move out</button></div></div>`;
    el.querySelector('#brCancel').onclick = () => { el.style.display = 'none'; };
    el.querySelector('#brGo').onclick = () => {
      el.style.display = 'none';
      audio.init();
      this.missionRef = { region, mission }; this._missionClosed = false; this._effects = null;
      s.squadSector = region; // the company goes in: from now on you follow the fighting here
      this._launch(C.missionConfig(s, mission, this.cls, (m) => O.rangerSkill(s, m)), Mission);
    };
  },

  quickBattle() {
    const terr = Object.keys(TERRAIN_INFO);
    const ws = ['clear', 'overcast', 'rain', 'fog', 'snow'];
    const t = terr[Math.floor(Math.random() * terr.length)];
    const w = ws[Math.floor(Math.random() * ws.length)];
    const att = Math.random() < 0.6 ? 'allies' : 'axis';
    const names = REGIONS.filter((r) => r.terrain === t);
    const cfg = {
      region: names.length ? names[Math.floor(Math.random() * names.length)].name : 'Unknown',
      terrain: t, weather: w, winter: w === 'snow', attacker: att,
      alliedTroops: 90, axisTroops: 90, fort: 1, alliedArt: 2, alliedAir: WEATHER[w].air ? 1 : 0, axisArt: 1,
      supplied: true, seed: (Math.random() * 1e9) | 0, botCap: this.settings().botCap, difficulty: this.settings().difficulty,
      amphibious: t === 'beach' && att === 'allies',
    };
    this.battleRef = null; this.missionRef = null;
    this._launch(cfg);
  },

  _launch(cfg, Klass = Battle) {
    this.ui.close();
    show('battle');
    $('#loading').style.display = 'flex';
    $('#deploy').style.display = 'none'; $('#pause').style.display = 'none'; $('#bresult').style.display = 'none';
    Promise.race([this.photos, new Promise((r) => setTimeout(r, 15000))]).then(() => {
      try {
        this.battle = new Klass(cfg, $('#battle'), $('#hud'), {
          onPlayerDead: () => this.showDeploy(true),
          onPause: () => this.showPause(),
          onEnd: (r) => this.showBattleResult(r),
          onAsset: (a) => { if (this.missionRef && this.state) F.assetDestroyed(this.state, this.missionRef.region, a.id, a.primary); },
          onNews: (t, type) => { if (this.battle) this.battle.hud.news(t, type); },
        });
        window.__battle = this.battle;
        this.battle.start();
      } catch (e) {
        console.error(e);
        alert('Failed to start battle: ' + e.message);
        this.returnToCampaign(null);
        return;
      }
      $('#loading').style.display = 'none';
      this.spawnIdx = 0;
      this.showDeploy(false);
    });
  },

  showDeploy(afterDeath) {
    const b = this.battle; if (!b || b.over) return;
    const el = $('#deploy');
    el.style.display = 'flex';
    if (b.isMission) return this._missionDeploy(el, b);
    const cfg = b.cfg;
    const att = b.attTeam === b.playerTeam;
    let wait = afterDeath ? 5 : 0;
    const render = () => {
      if (!this.battle || b.over) { el.style.display = 'none'; return; }
      const pts = b.spawnPoints(b.playerTeam);
      if (this.spawnIdx >= pts.length) this.spawnIdx = 0;
      const html = `<div class="modal deploy">
        <div class="brief">
          <div class="stamp">${att ? 'ASSAULT' : 'DEFENSE'} · ${esc(TERRAIN_INFO[cfg.terrain].label)} · ${esc(WEATHER[cfg.weather].label)}${b.tod !== 'day' ? ' · ' + b.tod : ''}</div>
          <h2>${esc(cfg.region)}</h2>
          <p>${att ? 'Seize the objectives. Capture flags A, B and C — holding them bleeds the enemy.' : 'Hold the line. Keep the flags in Allied hands until the enemy assault breaks.'}${cfg.amphibious ? ' The landing craft are on the beach: get off the sand fast!' : ''}</p>
          <div class="forces"><div class="ally"><span>Allied tickets</span><b id="dpTa">${b.tickets.allies}</b></div><div class="axis"><span>German tickets</span><b id="dpTx">${b.tickets.axis}</b></div></div>
          <p class="muted">Support: ${b.support.art} artillery barrage(s) [B], ${b.support.air} air strike(s) [V]. Enemy artillery: ${b.enemyArt}.</p>
        </div>
        <h3>Choose kit</h3>
        <div class="kits">${Object.entries(CLASSES).map(([k, c]) => `<button class="kit ${k === this.cls ? 'sel' : ''}" data-cls="${k}"><b>${c.label}</b><span>${WEAPONS[b.playerTeam][k].name}</span><small>${c.desc}</small></button>`).join('')}</div>
        <h3>Spawn point</h3>
        <div class="spawns">${pts.map((p, i) => `<button class="sp ${i === this.spawnIdx ? 'sel' : ''}" data-sp="${i}">${p.label}</button>`).join('')}</div>
        <div class="row end">
          ${afterDeath ? '' : `<button id="dpBack">${this.battleRef ? 'Let commanders fight it' : 'Back to menu'}</button>`}
          <button id="dpGo" class="primary big" ${wait > 0 ? 'disabled' : ''}>${wait > 0 ? 'Reinforcements in ' + Math.ceil(wait) + 's' : 'DEPLOY'}</button>
        </div></div>`;
      // ticket counts change constantly: update them in place so buttons aren't replaced mid-click
      const key = html.replace(/<b id="dpT[ax]">\d+<\/b>/g, '');
      if (key === this._dpHtml && el.firstChild) {
        const ta = el.querySelector('#dpTa'), tx = el.querySelector('#dpTx');
        if (ta) ta.textContent = b.tickets.allies; if (tx) tx.textContent = b.tickets.axis;
        return;
      }
      this._dpHtml = key;
      el.innerHTML = html;
      el.querySelectorAll('[data-cls]').forEach((x) => x.onclick = () => { this.cls = x.dataset.cls; localStorage.setItem('rtb.cls', this.cls); render(); });
      el.querySelectorAll('[data-sp]').forEach((x) => x.onclick = () => { this.spawnIdx = +x.dataset.sp; render(); });
      const go = el.querySelector('#dpGo');
      go.onclick = () => {
        audio.init();
        if (b.deployPlayer(this.cls, this.spawnIdx)) { el.style.display = 'none'; clearInterval(this._dpTimer); }
        else go.textContent = 'No reinforcements available';
      };
      const back = el.querySelector('#dpBack');
      if (back) back.onclick = () => { clearInterval(this._dpTimer); this.leaveBattle(); };
    };
    this._dpHtml = null;
    render();
    clearInterval(this._dpTimer);
    this._dpTimer = setInterval(() => {
      if (el.style.display === 'none') { clearInterval(this._dpTimer); return; }
      if (wait > 0) { wait -= 1; render(); }
      else render(); // refresh spawn points / tickets (only redraws on change)
    }, 1000);
  },

  _missionDeploy(el, b) {
    const cfg = b.cfg;
    if (CLASSES[this.cls] && CLASSES[this.cls].unlock && !(this.state.kit && this.state.kit[CLASSES[this.cls].unlock])) this.cls = 'rifleman';
    const render = () => {
      el.innerHTML = `<div class="modal deploy"><div class="stamp">RANGERS LEAD THE WAY</div><h2>${esc(cfg.region)}</h2>
        <p>Insertion point reached. Your squad: ${b.roster.filter((m) => !m.leader).map((m) => esc(m.rank + ' ' + m.name)).join(', ')}.</p>
        <p><b>${esc(cfg.mission.title)}</b></p>
        <p class="muted">F demolition charge · E interact / extract · Q squad hold / follow · H medkit · B radio · M sector map. Rangers hold fire until the squad is detected.</p>
        <h3>Your kit</h3>
        <div class="kits">${Object.entries(CLASSES).filter(([, c]) => !c.unlock || (this.state.kit && this.state.kit[c.unlock])).map(([k, c]) => `<button class="kit ${k === this.cls ? 'sel' : ''}" data-cls="${k}"><b>${c.label}</b><span>${WEAPONS.allies[k].name}</span><small>${c.desc}</small></button>`).join('')}</div>
        <div class="row end"><button id="dpBack">Abort</button><button id="dpGo" class="primary big">INSERT</button></div></div>`;
      el.querySelectorAll('[data-cls]').forEach((x) => x.onclick = () => { this.cls = x.dataset.cls; localStorage.setItem('rtb.cls', this.cls); render(); });
      el.querySelector('#dpGo').onclick = () => { audio.init(); b.deployPlayer(this.cls); el.style.display = 'none'; };
      el.querySelector('#dpBack').onclick = () => { el.style.display = 'none'; this.returnToCampaign(null); };
    };
    render();
  },

  showPause() {
    const b = this.battle; if (!b) return;
    b.paused = true;
    const el = $('#pause');
    el.style.display = 'flex';
    el.innerHTML = `<div class="modal"><h2>Paused</h2>
      <label>Mouse sensitivity <input type="range" id="pSens" min="0.3" max="2.5" step="0.05" value="${b.player.sens}"></label>
      <label>Volume <input type="range" id="pVol" min="0" max="1" step="0.05" value="${audio.volume}"></label>
      <div class="row end"><button id="pLeave">${this.missionRef ? 'Pull the squad out' : this.battleRef ? 'Leave battle (commanders fight on)' : 'Quit to menu'}</button><button id="pResume" class="primary">Resume</button></div></div>`;
    el.querySelector('#pSens').oninput = (e) => { b.player.sens = +e.target.value; localStorage.setItem('rtb.sens', e.target.value); };
    el.querySelector('#pVol').oninput = (e) => { audio.setVolume(+e.target.value); localStorage.setItem('rtb.vol', e.target.value); };
    el.querySelector('#pResume').onclick = () => { el.style.display = 'none'; b.paused = false; b.lastT = performance.now(); b.lockPointer(); };
    el.querySelector('#pLeave').onclick = () => { el.style.display = 'none'; this.leaveBattle(); };
  },

  leaveBattle() {
    const b = this.battle;
    if (!b) return;
    if (!this.battleRef && !this.missionRef) { this.returnToCampaign(null); return; }
    const r = b.retreatResolve();
    this.showBattleResult(r);
  },

  showBattleResult(r) {
    const b = this.battle; if (!b) return;
    b.paused = true;
    $('#deploy').style.display = 'none'; $('#pause').style.display = 'none';
    clearInterval(this._dpTimer);
    if (r.mode === 'mission') return this._debrief(r, b);
    const won = r.winner === b.playerTeam;
    const acc = b.stats.shots ? Math.round(100 * b.stats.hits / b.stats.shots) : 0;
    let consequence = '';
    if (this.battleRef) {
      const name = REGIONS[this.battleRef.to].name;
      const alliedAtt = this.battleRef.attacker === 'allies';
      consequence = won ? (alliedAtt ? `${name} is now in Allied hands.` : `${name} holds firm.`) : (alliedAtt ? `The assault on ${name} has failed.` : `${name} has been lost.`);
    }
    const el = $('#bresult');
    el.style.display = 'flex';
    el.innerHTML = `<div class="modal result ${won ? 'win' : 'loss'}">
      <h1>${won ? 'VICTORY' : 'DEFEAT'}</h1>
      <p>${esc(r.reason || '')} ${esc(consequence)}</p>
      <div class="forces"><div class="ally"><span>Allied tickets left</span><b>${r.tickets.allies}/${r.tickets0.allies}</b></div><div class="axis"><span>German tickets left</span><b>${r.tickets.axis}/${r.tickets0.axis}</b></div></div>
      <div class="kv"><span>Your kills</span><b>${b.stats.kills}</b></div>
      <div class="kv"><span>Deaths</span><b>${b.stats.deaths}</b></div>
      <div class="kv"><span>Accuracy</span><b>${acc}%</b></div>
      <div class="kv"><span>Flags captured in person</span><b>${b.stats.caps}</b></div>
      ${this.battleRef ? `<div class="kv"><span>Campaign casualties</span><b>Attacker −${r.attLoss} · Defender −${r.defLoss}</b></div>` : ''}
      <div class="row end"><button class="primary big" id="brBack">${this.battleRef ? 'Return to campaign map' : 'Back to menu'}</button></div></div>`;
    el.querySelector('#brBack').onclick = () => this.returnToCampaign(r);
  },

  _debrief(r, b) {
    const el = $('#bresult');
    el.style.display = 'flex';
    const title = r.primaryDone ? (r.extracted ? 'MISSION ACCOMPLISHED' : 'OBJECTIVE COMPLETE — SQUAD LOST') : r.extracted ? 'MISSION INCOMPLETE' : 'MISSION FAILED';
    const dest = b.world.assets.filter((a) => !a.alive).map((a) => `${a.primary ? '★ ' : ''}${a.sub ? SUB_LABEL[a.type] : ASSET_TYPES[a.type].label}`);
    if (r.trucks) dest.push(`${r.trucks} truck${r.trucks > 1 ? 's' : ''}`);
    const acc = b.stats.shots ? Math.round(100 * b.stats.hits / b.stats.shots) : 0;
    if (!this._missionClosed && r.front && r.front.winner) F.setFrontState(this.state, r.front.battleId, r.front.bias, r.front.winner); // a battle the Rangers decided
    if (!this._missionClosed) { this._missionClosed = true; this._effects = [...O.missionOutcome(this.state, this.missionRef.mission, r), ...F.finishMission(this.state, r)]; }
    el.innerHTML = `<div class="modal result ${r.primaryDone ? 'win' : 'loss'}"><h1>${title}</h1>
      <p>${esc(r.reason || '')}</p>
      ${b.objectiveText().map(([t, d]) => `<div class="kv"><span>${t}</span><b class="${d ? 'good' : 'bad'}">${d ? 'done' : 'not done'}</b></div>`).join('')}
      <div class="kv"><span>Assets destroyed</span><b>${dest.length ? dest.map(esc).join(', ') : 'none'}</b></div>
      <div class="kv"><span>Garrison casualties</span><b>${r.kills}</b></div>
      <div class="kv"><span>Your kills · accuracy</span><b>${b.stats.kills} · ${acc}%</b></div>
      ${r.front ? `<div class="kv"><span>The battle in the sector</span><b>${r.front.winner ? (r.front.winner === 'allies' ? 'Allied victory' : 'Allied defeat') : r.front.bias > 0.05 ? 'Going our way' : r.front.bias < -0.05 ? 'Going badly' : 'In the balance'}</b></div>` : ''}
      ${b.dir && b.dir.report.length ? `<h3>Elsewhere in the sector</h3>${[...new Set(b.dir.report)].slice(-6).map((t) => `<div class="kv"><span>${esc(t)}</span></div>`).join('')}` : ''}
      <h3>Squad</h3>${b.roster.map((m) => `<div class="kv"><span>${esc(m.rank)} ${esc(m.name === 'You' ? 'You' : m.name)}</span><b class="${m.alive ? 'good' : 'bad'}">${m.alive ? 'OK' : m.leader ? 'WOUNDED' : 'KIA'} · ${m.kills} kills</b></div>`).join('')}
      ${(this._effects || []).map((e) => `<div class="kv"><span>${esc(e)}</span></div>`).join('')}
      <div class="row end"><button class="primary big" id="brBack">Return to the map</button></div></div>`;
    el.querySelector('#brBack').onclick = () => this.returnToCampaign(r);
  },

  returnToCampaign(r) {
    if (this.battle) { this.battle.dispose(); this.battle = null; window.__battle = null; }
    $('#hud').innerHTML = '';
    ['#deploy', '#pause', '#bresult', '#loading'].forEach((s) => ($(s).style.display = 'none'));
    if (this.missionRef) {
      const s = this.state;
      this.missionRef = null;
      show('campaign');
      this.ui.open(s);
      this.ui.refresh();
      return;
    }
    if (!this.battleRef) { this.showTitle(); return; }
    const s = this.state, bt = this.battleRef;
    this.battleRef = null;
    if (r) {
      s.stats.fps++; s.stats.kills += r.kills || 0; s.stats.deaths += r.deaths || 0;
      C.applyBattle(s, bt, r);
    } else C.applyBattle(s, bt, C.autoResolve(s, bt));
    C.saveCampaign(s);
    show('campaign');
    this.ui.open(s);
    this.ui.showBattles();
  },
};

app.init();
window.__app = app;

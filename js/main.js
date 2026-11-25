// App controller: switches between title, campaign map and first-person battles.
import * as C from './campaign/campaign.js';
import { CampaignUI } from './campaign/campaignUI.js';
import { REGIONS, TERRAIN_INFO, WEATHER } from './campaign/data.js';
import { Battle } from './battle/battle.js';
import { CLASSES, WEAPONS } from './battle/weapons.js';
import { audio } from './audio.js';

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

  init() {
    this.ui = new CampaignUI(this);
    const sv = C.loadCampaign();
    $('#btnContinue').style.display = sv && sv.phase !== 'over' ? '' : 'none';
    $('#btnContinue').onclick = () => { audio.init(); this.openCampaign(C.loadCampaign()); };
    $('#btnNew').onclick = () => {
      audio.init();
      if (C.loadCampaign() && !confirm('Start a new campaign? Your saved campaign will be replaced.')) return;
      const s = C.newCampaign(this.settings());
      C.saveCampaign(s); this.openCampaign(s);
    };
    $('#btnSkirmish').onclick = () => { audio.init(); this.quickBattle(); };
    $('#btnHow').onclick = () => { const h = $('#how'); h.hidden = !h.hidden; };
    const sens = localStorage.getItem('rtb.sens'); if (sens) $('#setSens').value = sens;
    const vol = localStorage.getItem('rtb.vol'); if (vol) { $('#setVol').value = vol; audio.setVolume(+vol); }
    const diff = localStorage.getItem('rtb.diff'); if (diff) $('#setDiff').value = diff;
    const bots = localStorage.getItem('rtb.bots'); if (bots) $('#setBots').value = bots;
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
    this.battleRef = null;
    this._launch(cfg);
  },

  _launch(cfg) {
    this.ui.close();
    show('battle');
    $('#loading').style.display = 'flex';
    $('#deploy').style.display = 'none'; $('#pause').style.display = 'none'; $('#bresult').style.display = 'none';
    setTimeout(() => {
      try {
        this.battle = new Battle(cfg, $('#battle'), $('#hud'), {
          onPlayerDead: () => this.showDeploy(true),
          onPause: () => this.showPause(),
          onEnd: (r) => this.showBattleResult(r),
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
    }, 50);
  },

  showDeploy(afterDeath) {
    const b = this.battle; if (!b || b.over) return;
    const el = $('#deploy');
    el.style.display = 'flex';
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

  showPause() {
    const b = this.battle; if (!b) return;
    b.paused = true;
    const el = $('#pause');
    el.style.display = 'flex';
    el.innerHTML = `<div class="modal"><h2>Paused</h2>
      <label>Mouse sensitivity <input type="range" id="pSens" min="0.3" max="2.5" step="0.05" value="${b.player.sens}"></label>
      <label>Volume <input type="range" id="pVol" min="0" max="1" step="0.05" value="${audio.volume}"></label>
      <div class="row end"><button id="pLeave">${this.battleRef ? 'Leave battle (commanders fight on)' : 'Quit to menu'}</button><button id="pResume" class="primary">Resume</button></div></div>`;
    el.querySelector('#pSens').oninput = (e) => { b.player.sens = +e.target.value; localStorage.setItem('rtb.sens', e.target.value); };
    el.querySelector('#pVol').oninput = (e) => { audio.setVolume(+e.target.value); localStorage.setItem('rtb.vol', e.target.value); };
    el.querySelector('#pResume').onclick = () => { el.style.display = 'none'; b.paused = false; b.lastT = performance.now(); b.lockPointer(); };
    el.querySelector('#pLeave').onclick = () => { el.style.display = 'none'; this.leaveBattle(); };
  },

  leaveBattle() {
    const b = this.battle;
    if (!b) return;
    if (!this.battleRef) { this.returnToCampaign(null); return; }
    const r = b.retreatResolve();
    this.showBattleResult(r);
  },

  showBattleResult(r) {
    const b = this.battle; if (!b) return;
    b.paused = true;
    $('#deploy').style.display = 'none'; $('#pause').style.display = 'none';
    clearInterval(this._dpTimer);
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

  returnToCampaign(r) {
    if (this.battle) { this.battle.dispose(); this.battle = null; window.__battle = null; }
    $('#hud').innerHTML = '';
    ['#deploy', '#pause', '#bresult', '#loading'].forEach((s) => ($(s).style.display = 'none'));
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

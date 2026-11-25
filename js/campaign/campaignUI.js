// DOM side of the campaign layer: panels, orders, battle list.
import { REGIONS, TERRAIN_INFO, WEATHER } from './data.js';
import { getGeo } from './geo.js';
import { MapView } from './mapView.js';
import * as C from './campaign.js';
import { fmtDate } from '../util.js';
import { audio } from '../audio.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class CampaignUI {
  constructor(app) {
    this.app = app;
    this.state = null;
    this.view = new MapView($('#map'));
    this.sel = -1;
    this.running = false;
    const cv = $('#map');
    cv.addEventListener('mousemove', (e) => {
      const i = this.view.regionAt(e.clientX, e.clientY);
      this.view.hover = i;
      const tip = $('#maptip');
      if (i >= 0) {
        const r = REGIONS[i], st = this.state.regions[i];
        tip.style.display = 'block';
        tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 10 + 'px';
        tip.innerHTML = `<b>${esc(r.name)}</b><br>${st.owner === 'allies' ? 'Allied' : 'German'} · ${TERRAIN_INFO[r.terrain].label}<br>Troops: ${st.troops}${st.fort ? ' · Fort ' + st.fort : ''}`;
      } else tip.style.display = 'none';
    });
    cv.addEventListener('mouseleave', () => { this.view.hover = -1; $('#maptip').style.display = 'none'; });
    cv.addEventListener('click', (e) => {
      if (this.state.phase !== 'plan') return;
      const i = this.view.regionAt(e.clientX, e.clientY);
      this.select(i);
    });
    window.addEventListener('resize', () => { if (this.running) this.view.resize(); });
    $('#endTurn').addEventListener('click', () => this.endTurn());
    $('#menuBtn').addEventListener('click', () => this.app.showTitle());
  }

  open(state) {
    this.state = state;
    this.running = true;
    this.view.resize();
    this.refresh();
    const token = this.loopId = (this.loopId || 0) + 1;
    const loop = () => {
      if (!this.running || token !== this.loopId) return;
      this.view.selected = this.sel;
      this.view.draw(this.state, this.supply, { targets: this._targets() });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    if (state.phase === 'battles') this.showBattles();
    if (state.phase === 'over') this.showEnd();
  }
  close() { this.running = false; }

  _targets() {
    if (this.sel < 0 || this.state.phase !== 'plan') return [];
    if (this.state.regions[this.sel].owner !== 'allies') return [];
    return getGeo().adj[this.sel].filter((j) => this.state.regions[j].owner === 'axis');
  }

  select(i) {
    audio.ui();
    this.sel = i;
    this.renderSide();
  }

  refresh() {
    this.supply = C.computeSupply(this.state);
    const s = this.state;
    $('#tDate').textContent = fmtDate(C.currentDate(s));
    $('#tTurn').textContent = `Week ${s.turn}`;
    $('#tWeather').textContent = WEATHER[s.weather].label + (WEATHER[s.weather].air ? '' : ' (no air)');
    $('#tMp').textContent = s.res.allies.mp;
    $('#tSup').textContent = s.res.allies.sup;
    const held = REGIONS.filter((r, i) => !r.hq && s.regions[i].owner === 'allies').length;
    $('#tHeld').textContent = `${held}/${REGIONS.length - 1}`;
    $('#endTurn').disabled = s.phase !== 'plan';
    this.renderSide();
    this.renderLog();
  }

  renderLog() {
    const el = $('#log');
    el.innerHTML = this.state.log.slice(-40).reverse().map((l) => `<div class="log-${l.type}"><span>W${l.turn}</span> ${esc(l.text)}</div>`).join('');
  }

  renderSide() {
    const s = this.state, el = $('#side');
    const parts = [];
    // orders summary
    parts.push(`<div class="card"><h3>Offensives this week <small>${s.orders.length}/${s.maxOffensives}</small></h3>`);
    if (!s.orders.length) parts.push('<p class="muted">Select an Allied region, then an adjacent enemy region (red), to plan an attack.</p>');
    s.orders.forEach((o, k) => {
      parts.push(`<div class="order"><span>${esc(REGIONS[o.from].name)} ➜ <b>${esc(REGIONS[o.to].name)}</b><br><small>${o.troops} troops · ${o.art} artillery · ${o.air} air</small></span><button data-cancel="${k}" class="sm">✕</button></div>`);
    });
    parts.push('</div>');

    if (this.sel >= 0) {
      const r = REGIONS[this.sel], st = s.regions[this.sel];
      const ally = st.owner === 'allies';
      parts.push(`<div class="card"><h2>${esc(r.name)}</h2>
        <div class="kv"><span>Control</span><b class="${ally ? 'ally' : 'axis'}">${ally ? 'Allied' : 'German'}</b></div>
        <div class="kv"><span>Terrain</span><b>${TERRAIN_INFO[r.terrain].label} (def ×${TERRAIN_INFO[r.terrain].def})</b></div>
        <div class="kv"><span>Troops</span><b>${st.troops}</b></div>
        <div class="kv"><span>Fortification</span><b>${'■'.repeat(st.fort)}${'□'.repeat(3 - st.fort)}</b></div>
        <div class="kv"><span>Supply value</span><b>${r.value}${r.port ? ' · port' : ''}${r.capital ? ' · capital' : ''}</b></div>
        <div class="kv"><span>Supply line</span><b>${this.supply[this.sel] || r.hq ? 'Connected' : '<span class="warn">CUT OFF</span>'}</b></div>`);
      if (s.phase === 'plan') {
        if (ally) parts.push(this._allyActions());
        else parts.push(this._attackForm());
      }
      parts.push('</div>');
    } else {
      parts.push(`<div class="card"><h3>Orders</h3><ul class="help">
        <li>Click a region to inspect it.</li>
        <li><b>Plan offensives</b> against enemy regions adjacent to yours.</li>
        <li>Reinforce supplied regions with manpower; move troops along your lines.</li>
        <li>End the week to fight: lead any battle yourself in first person, or let your commanders auto-resolve.</li>
        <li>Ports and England supply your armies. Cut-off regions wither.</li>
        <li>Capture <b>Berlin</b> to win.</li></ul></div>`);
    }
    el.innerHTML = parts.join('');
    el.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => { C.cancelOffensive(s, +b.dataset.cancel); this.refresh(); });
    el.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => this._act(b.dataset.act, b.dataset));
    const tr = el.querySelector('#atkTroops');
    if (tr) {
      const upd = () => { el.querySelector('#atkTroopsV').textContent = tr.value; this._updateOdds(); };
      tr.oninput = upd;
      el.querySelector('#atkFrom').onchange = () => {
        const src = +el.querySelector('#atkFrom').value;
        const av = C.availableFor(s, src, this.sel);
        tr.max = av; tr.value = Math.round(av * 0.8); upd();
      };
      el.querySelector('#atkArt').oninput = () => { el.querySelector('#atkArtV').textContent = el.querySelector('#atkArt').value; this._updateOdds(); };
      const air = el.querySelector('#atkAir');
      if (air) air.oninput = () => { el.querySelector('#atkAirV').textContent = air.value; this._updateOdds(); };
      upd();
    }
  }

  _updateOdds() {
    const el = $('#side'), s = this.state;
    const troops = +el.querySelector('#atkTroops').value;
    const art = +el.querySelector('#atkArt').value;
    const airEl = el.querySelector('#atkAir');
    const air = airEl ? +airEl.value : 0;
    const st = s.regions[this.sel];
    const att = troops * (1 + 0.12 * art + 0.2 * air);
    const def = st.troops * TERRAIN_INFO[REGIONS[this.sel].terrain].def * (1 + 0.12 * Math.max(0, st.fort - 0.5 * art));
    const ratio = att / Math.max(1, def);
    const label = ratio > 1.6 ? ['Overwhelming', 'good'] : ratio > 1.15 ? ['Favorable', 'good'] : ratio > 0.85 ? ['Even', 'warn'] : ['Unfavorable', 'bad'];
    const cost = art * C.ART_COST + air * C.AIR_COST;
    el.querySelector('#atkOdds').innerHTML = `Estimated odds: <b class="${label[1]}">${label[0]}</b> (${ratio.toFixed(2)}) · Cost: ${cost} supplies`;
  }

  _allyActions() {
    const s = this.state, i = this.sel, st = s.regions[i];
    const adjAllied = getGeo().adj[i].filter((j) => s.regions[j].owner === 'allies' && !REGIONS[j].hq);
    const h = ['<div class="actions"><h3>Actions</h3>'];
    const canRe = this.supply[i] || REGIONS[i].hq;
    h.push(`<div class="row"><button data-act="re" data-n="10" ${canRe ? '' : 'disabled'}>Reinforce +10 <small>(10 MP)</small></button><button data-act="re" data-n="25" ${canRe ? '' : 'disabled'}>+25 <small>(25 MP)</small></button></div>`);
    if (!REGIONS[i].hq) h.push(`<div class="row"><button data-act="fort" ${st.fort >= 3 ? 'disabled' : ''}>Fortify <small>(${C.FORT_COST} supplies)</small></button></div>`);
    if (adjAllied.length) {
      h.push('<h4>Move troops to</h4>');
      for (const j of adjAllied) h.push(`<div class="row move"><span>${esc(REGIONS[j].name)} (${s.regions[j].troops})</span><button class="sm" data-act="mv" data-to="${j}" data-n="10">10</button><button class="sm" data-act="mv" data-to="${j}" data-n="999">All</button></div>`);
      if (st.lockedIn) h.push(`<p class="muted">${st.lockedIn} troops arrived this week and cannot move again.</p>`);
    }
    const tg = getGeo().adj[i].filter((j) => s.regions[j].owner === 'axis');
    if (tg.length) h.push(`<p class="muted">Attack targets: ${tg.map((j) => `<a href="#" data-act="sel" data-to="${j}">${esc(REGIONS[j].name)}</a>`).join(', ')}</p>`);
    h.push('</div>');
    return h.join('');
  }

  _attackForm() {
    const s = this.state, i = this.sel;
    const srcs = C.validSources(s, i);
    if (s.orders.some((o) => o.to === i)) return '<p class="muted">Offensive already planned here.</p>';
    if (!srcs.length) return '<p class="muted">No adjacent Allied forces can attack this region.</p>';
    if (s.orders.length >= s.maxOffensives) return `<p class="muted">All ${s.maxOffensives} offensives for this week are assigned.</p>`;
    srcs.sort((a, b) => s.regions[b].troops - s.regions[a].troops);
    const first = C.availableFor(s, srcs[0], i);
    const airOk = WEATHER[s.weather].air;
    return `<div class="actions"><h3>Plan offensive</h3>
      <label>Attack from <select id="atkFrom">${srcs.map((j) => `<option value="${j}">${esc(REGIONS[j].name)} (${s.regions[j].troops})</option>`).join('')}</select></label>
      <label>Troops committed: <b id="atkTroopsV"></b> ${srcs.length > 1 ? `<small class="muted">(combined offensive from ${srcs.length} regions)</small>` : ''}<input type="range" id="atkTroops" min="5" max="${first}" value="${Math.round(first * 0.8)}"></label>
      <label>Artillery barrages: <b id="atkArtV">1</b> <small>(${C.ART_COST} sup each · suppresses forts)</small><input type="range" id="atkArt" min="0" max="3" value="1"></label>
      ${airOk ? `<label>Air strikes: <b id="atkAirV">0</b> <small>(${C.AIR_COST} sup each)</small><input type="range" id="atkAir" min="0" max="2" value="0"></label>` : '<p class="muted">Air support grounded by weather.</p>'}
      <p id="atkOdds" class="odds"></p>
      <button class="primary" data-act="attack">Commit offensive</button></div>`;
  }

  _act(a, d) {
    const s = this.state; let err = null;
    if (a === 're') err = C.reinforce(s, this.sel, +d.n);
    else if (a === 'fort') err = C.fortify(s, this.sel);
    else if (a === 'mv') err = C.moveTroops(s, this.sel, +d.to, +d.n);
    else if (a === 'sel') { this.select(+d.to); return; }
    else if (a === 'attack') {
      const el = $('#side');
      const air = el.querySelector('#atkAir');
      err = C.planOffensive(s, +el.querySelector('#atkFrom').value, this.sel, +el.querySelector('#atkTroops').value, +el.querySelector('#atkArt').value, air ? +air.value : 0);
    }
    if (err) this.toast(err); else audio.ui();
    this.refresh();
  }

  toast(t) {
    const el = $('#toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), 2600);
  }

  endTurn() {
    const s = this.state;
    if (s.phase !== 'plan') return;
    if (!s.orders.length && !confirm('No offensives planned this week. End turn anyway?')) return;
    this.sel = -1;
    C.endPlanning(s);
    C.saveCampaign(s);
    this.refresh();
    if (s.phase === 'battles') this.showBattles();
  }

  showBattles() {
    const s = this.state, el = $('#battles');
    el.style.display = 'flex';
    const items = s.battles.map((b) => {
      const r = REGIONS[b.to];
      const allied = b.attacker === 'allies';
      const ours = allied ? b.attTroops : b.defTroops, theirs = allied ? b.defTroops : b.attTroops;
      let status = '';
      if (b.resolved) {
        const won = b.result.winner === 'allies';
        status = `<div class="res ${won ? 'good' : 'bad'}">${won ? 'VICTORY' : 'DEFEAT'} <small>(${b.result.mode === 'fps' ? 'led in person' : 'auto-resolved'})</small></div>`;
      }
      return `<div class="battle ${b.resolved ? 'done' : ''}">
        <div class="bh"><span class="tag ${allied ? 'ally' : 'axis'}">${allied ? 'ALLIED OFFENSIVE' : 'ENEMY ATTACK'}</span><b>${esc(r.name)}</b> <small>${TERRAIN_INFO[r.terrain].label}${REGIONS[b.from].hq ? ' · Amphibious landing' : ''}</small></div>
        <div class="bd">From ${esc(REGIONS[b.from].name)} · Our forces <b>${ours}</b> vs enemy <b>${theirs}</b> · Fort ${s.regions[b.to].fort} · Support: ${b.art} artillery${b.air ? ', ' + b.air + ' air' : ''}</div>
        ${b.resolved ? status : `<div class="row"><button class="primary" data-fight="${b.id}">⚔ Lead in First Person</button><button data-auto="${b.id}">Auto-resolve</button></div>`}
      </div>`;
    }).join('');
    const done = C.allBattlesResolved(s);
    el.innerHTML = `<div class="modal"><h2>Battles — Week ${s.turn} <small>${fmtDate(C.currentDate(s))} · ${WEATHER[s.weather].label}</small></h2>
      <p class="muted">Choose which battles to fight yourself. Every battle must be resolved before the week ends.</p>
      ${items}
      <div class="row end">${done ? '<button class="primary" id="contTurn">Continue to next week ▶</button>' : '<button id="autoAll">Auto-resolve remaining</button>'}</div></div>`;
    el.querySelectorAll('[data-fight]').forEach((b) => b.onclick = () => {
      const bt = s.battles.find((x) => x.id === +b.dataset.fight);
      el.style.display = 'none';
      this.app.startBattle(bt);
    });
    el.querySelectorAll('[data-auto]').forEach((b) => b.onclick = () => {
      const bt = s.battles.find((x) => x.id === +b.dataset.auto);
      C.applyBattle(s, bt, C.autoResolve(s, bt)); C.saveCampaign(s); audio.ui();
      this.refresh(); this.showBattles();
    });
    const aa = el.querySelector('#autoAll');
    if (aa) aa.onclick = () => { for (const bt of s.battles) if (!bt.resolved) C.applyBattle(s, bt, C.autoResolve(s, bt)); C.saveCampaign(s); this.refresh(); this.showBattles(); };
    const ct = el.querySelector('#contTurn');
    if (ct) ct.onclick = () => {
      el.style.display = 'none';
      C.finishTurn(s);
      this.refresh();
      if (s.phase === 'over') this.showEnd();
    };
    if (s.phase === 'over') { el.style.display = 'none'; this.showEnd(); }
  }

  showEnd() {
    const s = this.state, el = $('#battles');
    el.style.display = 'flex';
    const title = s.result === 'victory' ? 'VICTORY IN EUROPE' : s.result === 'defeat' ? 'DEFEAT' : 'STALEMATE';
    el.innerHTML = `<div class="modal end"><h1>${title}</h1>
      <p>${s.result === 'victory' ? `Germany has been defeated after ${s.turn} weeks of campaigning.` : 'The campaign is over.'}</p>
      <div class="kv"><span>Battles won</span><b>${s.stats.won}</b></div>
      <div class="kv"><span>Battles lost</span><b>${s.stats.lost}</b></div>
      <div class="kv"><span>Battles led in person</span><b>${s.stats.fps}</b></div>
      <div class="kv"><span>Personal kills</span><b>${s.stats.kills}</b></div>
      <div class="kv"><span>Allied casualties</span><b>${s.stats.alliedLosses}</b></div>
      <div class="kv"><span>Enemy casualties</span><b>${s.stats.axisLosses}</b></div>
      <div class="row end"><button class="primary" id="newCamp">New campaign</button></div></div>`;
    el.querySelector('#newCamp').onclick = () => { C.clearSave(); el.style.display = 'none'; this.app.showTitle(); };
  }
}

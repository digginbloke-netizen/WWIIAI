// DOM side of the campaign layer: the AI-run front, sector intel, the Ranger squad, weekly reports.
import { REGIONS, TERRAIN_INFO, WEATHER, ASSET_TYPES } from './data.js';
import { MapView } from './mapView.js';
import * as C from './campaign.js';
import * as F from './front.js';
import { fmtDate } from '../util.js';
import { audio } from '../audio.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CLS = { rifleman: 'Rifleman', assault: 'Assault', support: 'Support' };

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
        const n = (this.state.assets[i] || []).length;
        const ops = this.sectors.includes(i) ? `<br><span style="color:#ffd04a">Ranger targets: ${n}</span>` : '';
        tip.style.display = 'block';
        tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 10 + 'px';
        tip.innerHTML = `<b>${esc(r.name)}</b><br>${st.owner === 'allies' ? 'Allied' : 'German'} · ${TERRAIN_INFO[r.terrain].label}<br>Troops: ${st.troops}${st.fort ? ' · Fort ' + st.fort : ''}${ops}`;
      } else tip.style.display = 'none';
    });
    cv.addEventListener('mouseleave', () => { this.view.hover = -1; $('#maptip').style.display = 'none'; });
    cv.addEventListener('click', (e) => {
      if (this.state.phase === 'over') return;
      this.select(this.view.regionAt(e.clientX, e.clientY));
    });
    window.addEventListener('resize', () => { if (this.running) this.view.resize(); });
    $('#endTurn').addEventListener('click', () => this.app.toggleFrontPause());
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
      this.view.draw(this.state, this.supply, { targets: this.state.phase !== 'over' ? this.sectors : [] });
      this.updateClock();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    if (state.phase === 'over') this.showEnd();
  }
  close() { this.running = false; }

  select(i) { audio.ui(); this.sel = i; this.renderSide(); }

  refresh() {
    const s = this.state;
    this.supply = C.computeSupply(s);
    this.sectors = C.missionSectors(s);
    $('#tDate').textContent = fmtDate(C.currentDate(s));
    this.updateClock();
    $('#tWeather').textContent = WEATHER[s.weather].label;
    // garrisons plus troops committed to attacks in progress
    const str = (side) => s.regions.reduce((a, r) => a + (r.owner === side ? r.troops : 0), 0) + s.battles.reduce((a, b) => a + (b.attacker === side ? (b.att ?? 0) : 0), 0);
    $('#tMp').textContent = str('allies');
    $('#tSup').textContent = str('axis');
    const held = REGIONS.filter((r, i) => !r.hq && s.regions[i].owner === 'allies').length;
    $('#tHeld').textContent = `${held}/${REGIONS.length - 1}`;
    $('#endTurn').disabled = s.phase === 'over';
    $('#endTurn').textContent = this.app.frontPaused ? '▶ Resume front' : '❚❚ Pause front';
    this.renderSide();
    this.renderLog();
  }

  renderLog() {
    const s = this.state;
    const d = (l) => { if (l.day === undefined) return `W${l.turn}`; const t = new Date(s.startDate + l.day * 86400000); return `${t.getUTCDate()}/${t.getUTCMonth() + 1}`; };
    $('#log').innerHTML = s.log.slice(-60).reverse().map((l) => `<div class="log-${l.type}"><span>${d(l)}</span> ${esc(l.text)}</div>`).join('');
  }

  _opsList(filter) {
    const s = this.state;
    const ops = s.battles.filter(filter);
    if (!ops.length) return '<p class="muted">No battles in progress.</p>';
    return ops.map((b) => {
      const p = F.battleProgress(s, b);
      return `<div class="op ${b.attacker === 'allies' ? 'ally' : 'axis'}">${b.attacker === 'allies' ? '▲ Allied offensive' : '▼ German attack'}: ${esc(REGIONS[b.from].name)} ➜ <b>${esc(REGIONS[b.to].name)}</b> <small>day ${p.days + 1} · ${b.att} vs ${s.regions[b.to].troops}</small>
        <div class="bprog"><small>att</small><i class="a" style="width:${Math.round(p.att * 60)}px"></i><small>def</small><i class="d" style="width:${Math.round(p.def * 60)}px"></i></div></div>`;
    }).join('');
  }

  renderSide() {
    const s = this.state, el = $('#side');
    const parts = [];
    if (this.sel >= 0) {
      const i = this.sel, r = REGIONS[i], st = s.regions[i];
      const ally = st.owner === 'allies';
      parts.push(`<div class="card"><h2>${esc(r.name)}</h2>
        <div class="kv"><span>Control</span><b class="${ally ? 'ally' : 'axis'}">${ally ? 'Allied' : 'German'}</b></div>
        <div class="kv"><span>Terrain</span><b>${TERRAIN_INFO[r.terrain].label}</b></div>
        <div class="kv"><span>Garrison</span><b>${st.troops}</b></div>
        <div class="kv"><span>Fortification</span><b>${'■'.repeat(st.fort)}${'□'.repeat(3 - st.fort)}</b></div>
        <div class="kv"><span>Supply</span><b>${this.supply[i] || r.hq ? 'Connected' : '<span class="warn">CUT OFF</span>'}</b></div>
        <h3 style="margin-top:10px">Fighting in this sector</h3>${this._opsList((b) => b.to === i || b.from === i)}`);
      if (this.sectors.includes(i)) {
        const depth = C.missionDepth(s)[i];
        parts.push(`<h3 style="margin-top:12px">Ranger targets <small>${depth ? 'behind enemy lines' : 'front-line sector'}</small></h3>`);
        for (const a of s.assets[i]) {
          const T = ASSET_TYPES[a.type];
          parts.push(`<div class="asset"><span class="ic">${T.icon}</span><span class="tx"><b>${T.label}</b><small>${T.effect}</small></span><button class="sm primary" data-mission="${a.id}">Primary</button></div>`);
        }
        parts.push('<p class="muted">Choose one target as your primary objective. Every other asset you destroy in the sector still counts toward the war effort.</p>');
      } else if (!ally) parts.push('<p class="muted">Too deep behind enemy lines for a Ranger operation this week.</p>');
      parts.push('</div>');
    } else {
      parts.push(`<div class="card"><h3>Your orders</h3><ul class="help">
        <li>The front runs in real time: every 30 seconds it advances a day and every battle fights another round.</li>
        <li>Sectors outlined in <b style="color:#ee8f84">red</b> hold enemy assets your Rangers can hit.</li>
        <li>Pick a sector, choose a primary objective, and insert. The war keeps moving while you're in the field.</li>
        <li>Every asset you destroy affects the fighting the moment it blows — objective or not.</li></ul></div>`);
    }
    // squad roster
    const rows = s.squad.map((m) => `<span>${esc(m.rank)} ${esc(m.name === 'You' ? 'You (squad leader)' : m.name)} <small class="muted">${CLS[m.cls] || ''}</small></span><span class="st-${m.status}">${m.status === 'active' ? 'ready' : m.status.toUpperCase()}</span><span class="muted">${m.kills}k · ${m.missions}m</span>`).join('');
    parts.push(`<div class="card"><h3>Ranger squad</h3><div class="roster">${rows}</div>${(s.fallen || []).length ? `<p class="muted">Fallen: ${s.fallen.map(esc).join(', ')}</p>` : ''}</div>`);
    parts.push(`<div class="card"><h3>Battles in progress</h3>${this._opsList(() => true)}</div>`);
    el.innerHTML = parts.join('');
    el.querySelectorAll('[data-mission]').forEach((b) => b.onclick = () => { audio.ui(); this.app.briefMission(this.sel, +b.dataset.mission); });
  }

  toast(t) {
    const el = $('#toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), 2600);
  }

  updateClock() {
    const left = Math.max(0, F.TICK_SECONDS - (this.app.tickAcc || 0));
    const el = $('#tTurn'); if (!el) return;
    const txt = this.state.phase === 'over' ? '—' : this.app.frontPaused ? 'paused' : `0:${String(Math.ceil(left)).padStart(2, '0')}`;
    if (el.textContent !== txt) el.textContent = txt;
    $('#tTickBar').style.width = `${(1 - left / F.TICK_SECONDS) * 100}%`;
  }

  // a front update happened while the map is open
  onTick(events) {
    this.refresh();
    const big = events.filter((e) => e.type === 'good' || e.type === 'bad');
    if (big.length) this.toast(big[big.length - 1].text);
  }

  showEnd() {
    const s = this.state, el = $('#battles');
    el.style.display = 'flex';
    const title = s.result === 'victory' ? 'VICTORY IN EUROPE' : s.result === 'defeat' ? 'DEFEAT' : 'STALEMATE';
    el.innerHTML = `<div class="modal end"><h1>${title}</h1>
      <p>${s.result === 'victory' ? `Germany has been defeated after ${Math.round(s.day / 7)} weeks of war.` : 'The campaign is over.'}</p>
      <div class="kv"><span>Ranger operations</span><b>${s.stats.missions} (${s.stats.missionsWon} primary objectives)</b></div>
      <div class="kv"><span>Enemy assets destroyed</span><b>${s.stats.assets}</b></div>
      <div class="kv"><span>Enemy killed by the squad</span><b>${s.stats.kills}</b></div>
      <div class="kv"><span>Rangers lost</span><b>${(s.fallen || []).length}</b></div>
      <div class="kv"><span>Battles won / lost by the front</span><b>${s.stats.won} / ${s.stats.lost}</b></div>
      <div class="row end"><button class="primary" id="newCamp">New campaign</button></div></div>`;
    el.querySelector('#newCamp').onclick = () => { C.clearSave(); el.style.display = 'none'; this.app.showTitle(); };
  }
}

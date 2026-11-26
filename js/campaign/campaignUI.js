// DOM side of the campaign layer: the AI-run front, sector intel, the Ranger squad, weekly reports.
import { REGIONS, TERRAIN_INFO, WEATHER, ASSET_TYPES } from './data.js';
import { MapView } from './mapView.js';
import * as C from './campaign.js';
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
      if (this.state.phase !== 'brief') return;
      this.select(this.view.regionAt(e.clientX, e.clientY));
    });
    window.addEventListener('resize', () => { if (this.running) this.view.resize(); });
    $('#endTurn').addEventListener('click', () => this.standDown());
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
      this.view.draw(this.state, this.supply, { targets: this.state.phase === 'brief' ? this.sectors : [] });
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
    $('#tTurn').textContent = `Week ${s.turn}`;
    $('#tWeather').textContent = WEATHER[s.weather].label;
    const str = (side) => s.regions.reduce((a, r) => a + (r.owner === side ? r.troops : 0), 0);
    $('#tMp').textContent = str('allies');
    $('#tSup').textContent = str('axis');
    const held = REGIONS.filter((r, i) => !r.hq && s.regions[i].owner === 'allies').length;
    $('#tHeld').textContent = `${held}/${REGIONS.length - 1}`;
    $('#endTurn').disabled = s.phase !== 'brief';
    this.renderSide();
    this.renderLog();
  }

  renderLog() {
    $('#log').innerHTML = this.state.log.slice(-50).reverse().map((l) => `<div class="log-${l.type}"><span>W${l.turn}</span> ${esc(l.text)}</div>`).join('');
  }

  _opsList(filter) {
    const s = this.state;
    const ops = s.battles.filter(filter);
    if (!ops.length) return '<p class="muted">No major operations.</p>';
    return ops.map((b) => `<div class="op ${b.attacker === 'allies' ? 'ally' : 'axis'}">${b.attacker === 'allies' ? '▲ Allied offensive' : '▼ German attack'}: ${esc(REGIONS[b.from].name)} ➜ <b>${esc(REGIONS[b.to].name)}</b> <small>(${b.attTroops} vs ${b.defTroops})</small></div>`).join('');
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
        <h3 style="margin-top:10px">Operations in this sector</h3>${this._opsList((b) => b.to === i || b.from === i)}`);
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
        <li>The front is run by Allied and German commanders. Their operations this week are drawn on the map.</li>
        <li>Sectors outlined in <b style="color:#ee8f84">red</b> hold enemy assets your Rangers can hit.</li>
        <li>Pick a sector, choose a primary objective, and insert. Anything else you destroy there also hurts the enemy.</li>
        <li>When you return, every battle of the week is fought out at once — with your sabotage factored in.</li></ul></div>`);
    }
    // squad roster
    const rows = s.squad.map((m) => `<span>${esc(m.rank)} ${esc(m.name === 'You' ? 'You (squad leader)' : m.name)} <small class="muted">${CLS[m.cls] || ''}</small></span><span class="st-${m.status}">${m.status === 'active' ? 'ready' : m.status.toUpperCase()}</span><span class="muted">${m.kills}k · ${m.missions}m</span>`).join('');
    parts.push(`<div class="card"><h3>Ranger squad</h3><div class="roster">${rows}</div>${(s.fallen || []).length ? `<p class="muted">Fallen: ${s.fallen.map(esc).join(', ')}</p>` : ''}</div>`);
    parts.push(`<div class="card"><h3>This week's operations</h3>${this._opsList(() => true)}</div>`);
    el.innerHTML = parts.join('');
    el.querySelectorAll('[data-mission]').forEach((b) => b.onclick = () => { audio.ui(); this.app.briefMission(this.sel, +b.dataset.mission); });
  }

  toast(t) {
    const el = $('#toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), 2600);
  }

  standDown() {
    const s = this.state;
    if (s.phase !== 'brief') return;
    if (!confirm('Stand the squad down this week? The front will fight on without the Rangers.')) return;
    this.sel = -1;
    const rep = C.resolveWeek(s, null);
    this.refresh();
    this.showReport(rep);
  }

  showReport(rep) {
    const s = this.state, el = $('#battles');
    el.style.display = 'flex';
    const m = rep.mission;
    const mission = m ? `<h3>Ranger operation — ${esc(REGIONS[m.region].name)}</h3>${rep.effects.map((e) => `<div class="rep">${esc(e)}</div>`).join('')}` : '<h3>Ranger squad</h3><div class="rep muted">The squad stood down this week.</div>';
    const battles = rep.battles.map(({ b, result, cancelled }) => {
      const allied = b.attacker === 'allies';
      if (cancelled) return `<div class="rep good">✔ German attack on ${esc(REGIONS[b.to].name)} called off</div>`;
      const won = result.winner === 'allies';
      const txt = allied ? (won ? `captured ${esc(REGIONS[b.to].name)}` : `assault on ${esc(REGIONS[b.to].name)} repulsed`) : (won ? `held ${esc(REGIONS[b.to].name)}` : `lost ${esc(REGIONS[b.to].name)}`);
      return `<div class="rep ${won ? 'good' : 'bad'}">${won ? '✔' : '✖'} ${allied ? 'Allied offensive' : 'German attack'}: ${txt} <small class="muted">(losses ${allied ? result.attLoss : result.defLoss} / enemy ${allied ? result.defLoss : result.attLoss})</small></div>`;
    }).join('') || '<div class="rep muted">No major battles were fought.</div>';
    el.innerHTML = `<div class="modal"><h2>Week ${rep.week} report</h2>${mission}<h3>The front</h3>${battles}
      <div class="row end"><button class="primary" id="contTurn">${s.phase === 'over' ? 'Continue ▶' : `On to week ${s.turn} ▶`}</button></div></div>`;
    el.querySelector('#contTurn').onclick = () => {
      el.style.display = 'none';
      this.refresh();
      if (s.phase === 'over') this.showEnd();
    };
  }

  showEnd() {
    const s = this.state, el = $('#battles');
    el.style.display = 'flex';
    const title = s.result === 'victory' ? 'VICTORY IN EUROPE' : s.result === 'defeat' ? 'DEFEAT' : 'STALEMATE';
    el.innerHTML = `<div class="modal end"><h1>${title}</h1>
      <p>${s.result === 'victory' ? `Germany has been defeated after ${s.turn} weeks.` : 'The campaign is over.'}</p>
      <div class="kv"><span>Ranger operations</span><b>${s.stats.missions} (${s.stats.missionsWon} primary objectives)</b></div>
      <div class="kv"><span>Enemy assets destroyed</span><b>${s.stats.assets}</b></div>
      <div class="kv"><span>Enemy killed by the squad</span><b>${s.stats.kills}</b></div>
      <div class="kv"><span>Rangers lost</span><b>${(s.fallen || []).length}</b></div>
      <div class="kv"><span>Battles won / lost by the front</span><b>${s.stats.won} / ${s.stats.lost}</b></div>
      <div class="row end"><button class="primary" id="newCamp">New campaign</button></div></div>`;
    el.querySelector('#newCamp').onclick = () => { C.clearSave(); el.style.display = 'none'; this.app.showTitle(); };
  }
}

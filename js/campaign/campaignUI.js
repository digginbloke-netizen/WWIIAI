// DOM side of the campaign layer: the AI-run front, sector intel, the Ranger squad, weekly reports.
import { REGIONS, PROVINCES, PROVINCE_SECTORS, TERRAIN_INFO, WEATHER, ASSET_TYPES } from './data.js';
import { MapView } from './mapView.js';
import * as C from './campaign.js';
import * as F from './front.js';
import * as O from './ops.js';
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
        tip.innerHTML = `<b>${esc(r.hq ? r.name : 'Sector ' + r.ref)}</b> <small>${esc(r.provName)}</small><br>${st.owner === 'allies' ? 'Allied' : 'German'} · ${TERRAIN_INFO[r.terrain].label}<br>Troops: ${st.troops}${st.fort ? ' · Fort ' + st.fort : ''}${i === this.state.squadSector ? '<br><span style="color:#ffd04a">★ Your company is here</span>' : ''}${ops}`;
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
      this.view.draw(this.state, this.supply, { targets: this.state.phase !== 'over' ? [...new Set((this.state.board || []).map((m) => m.region))] : [], board: this.state.board, strategic: this.state.strategic });
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
    const provs = PROVINCES.filter((P, p) => !P.hq && PROVINCE_SECTORS[p].every((j) => s.regions[j].owner === 'allies')).length;
    $('#tHeld').textContent = `${held}/${REGIONS.length - 1} · ${provs}/${PROVINCES.length - 1} prov.`;
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
    const car = s.career || { rank: 0, medals: [] };
    // service record summary
    parts.push(`<div class="card"><h3>Service record <small><a href="#" data-act="record">logbook</a></small></h3>
      <div class="kv"><span>${O.RANKS[car.rank][0]} (You)</span><b>${s.points || 0} pts</b></div>
      <div class="kv"><span>Medals</span><b>${car.medals.length ? [...new Set(car.medals.map((m) => O.MEDALS[m.medal]))].map((n) => `${n} ×${car.medals.filter((m) => O.MEDALS[m.medal] === n).length}`).join(', ') : '—'}</b></div>
      <div class="row"><button class="sm primary" data-act="shop">Quartermaster</button></div></div>`);
    // mission board
    const board = (s.board || []).map((m, k) => {
      const T = O.MISSION_TYPES[m.type];
      const left = m.deadline - s.day;
      const inSector = this.sel === m.region;
      return `<div class="asset ${inSector ? 'hl' : ''}"><span class="ic">${k + 1}</span><span class="tx"><b>${esc(T.label)}: ${esc(m.title)}</b>
        <small>${esc(REGIONS[m.region].name)} · ${left} day${left === 1 ? '' : 's'} left · ${m.reward} pts</small><small>${esc(m.desc)}</small></span>
        <button class="sm primary" data-mission="${m.id}">Brief</button></div>`;
    }).join('') || '<p class="muted">No missions available.</p>';
    parts.push(`<div class="card"><h3>Mission board</h3>${board}</div>`);
    if (this.sel >= 0) {
      const i = this.sel, r = REGIONS[i], st = s.regions[i];
      const ally = st.owner === 'allies';
      const strat = (s.strategic || []).filter((t) => t.region === i);
      const P = PROVINCES[r.prov], pSecs = PROVINCE_SECTORS[r.prov], pHeld = pSecs.filter((j) => s.regions[j].owner === 'allies').length;
      const canBase = ally && i !== s.squadSector;
      parts.push(`<div class="card"><h2>${esc(r.hq ? r.name : 'Sector ' + r.ref)} <small>${esc(P.name)}</small></h2>
        ${r.hq ? '' : `<div class="kv"><span>Province</span><b>${esc(P.name)} · ${pHeld}/${pSecs.length} sectors Allied</b></div>`}
        ${i === s.squadSector ? '<p class="good">★ Your Ranger company is in this sector: you hear about every battle here.</p>' : canBase ? '<div class="row"><button class="sm" data-act="base">Move the company here</button> <small class="muted">to follow the fighting in this sector</small></div>' : ''}
        <div class="kv"><span>Control</span><b class="${ally ? 'ally' : 'axis'}">${ally ? 'Allied' : 'German'}</b></div>
        <div class="kv"><span>Terrain</span><b>${TERRAIN_INFO[r.terrain].label}</b></div>
        <div class="kv"><span>Garrison</span><b>${st.troops}</b></div>
        <div class="kv"><span>Fortification</span><b>${'■'.repeat(st.fort)}${'□'.repeat(3 - st.fort)}</b></div>
        ${strat.map((t) => `<div class="kv"><span>${O.STRAT_TYPES[t.type].label}</span><b class="${t.status === 'ok' ? '' : 'good'}">${t.status === 'ok' ? 'operating' : `destroyed (repair in ${t.repairDay - s.day} d)`}</b></div>`).join('')}
        ${(s.assets[i] || []).length ? `<div class="kv"><span>Known enemy assets</span><b>${s.assets[i].map((a) => ASSET_TYPES[a.type].label).join(', ')}</b></div>` : ''}
        <h3 style="margin-top:10px">Fighting in this sector</h3>${this._opsList((b) => b.to === i || b.from === i)}</div>`);
    }
    // squad roster with experience
    const rows = s.squad.map((m) => `<span>${esc(m.rank)} ${esc(m.name === 'You' ? 'You (squad leader)' : m.name)} <small class="muted">${CLS[m.cls] || ''}${m.leader ? '' : ' · ' + O.LEVELS[m.level || 0]}</small></span><span class="st-${m.status}">${m.status === 'active' ? 'ready' : m.status.toUpperCase()}</span><span class="muted">${m.kills}k · ${m.missions}m</span>`).join('');
    parts.push(`<div class="card"><h3>Ranger squad</h3><div class="roster">${rows}</div>${(s.fallen || []).length ? `<p class="muted">Fallen: ${s.fallen.map(esc).join(', ')}</p>` : ''}</div>`);
    // German war economy
    if (s.strategic) {
      const e = O.economy(s);
      const bar = (v) => `<i style="display:inline-block;width:${Math.round(v * 80)}px;height:6px;background:#c96b5f"></i>`;
      parts.push(`<div class="card"><h3>German war economy</h3>
        <div class="kv"><span>Factories (production)</span><b>${bar(e.factory)} ${Math.round(e.factory * 100)}%</b></div>
        <div class="kv"><span>Rail yards (reinforcement)</span><b>${bar(e.railyard)} ${Math.round(e.railyard * 100)}%</b></div>
        <div class="kv"><span>Fuel plants (attacks)</span><b>${bar(e.fuelplant)} ${Math.round(e.fuelplant * 100)}%</b></div></div>`);
    }
    const here = (b) => b.to === s.squadSector || b.from === s.squadSector;
    const others = s.battles.filter((b) => !here(b)).length;
    parts.push(`<div class="card"><h3>Fighting in your sector <small>${esc(REGIONS[s.squadSector] ? (REGIONS[s.squadSector].hq ? REGIONS[s.squadSector].name : 'Sector ' + REGIONS[s.squadSector].ref) : '')}</small></h3>${this._opsList(here)}
      <p class="muted">${others} other battle${others === 1 ? '' : 's'} along the front. You only hear about fighting in your own sector, and about whole provinces.</p></div>`);
    el.innerHTML = parts.join('');
    el.querySelectorAll('[data-mission]').forEach((b) => b.onclick = () => { audio.ui(); this.app.briefMission(+b.dataset.mission); });
    el.querySelectorAll('[data-act=shop]').forEach((b) => b.onclick = (e) => { e.preventDefault(); this.showShop(); });
    el.querySelectorAll('[data-act=base]').forEach((b) => b.onclick = (e) => { e.preventDefault(); audio.ui(); s.squadSector = this.sel; C.log(s, `The Ranger company moves to ${REGIONS[this.sel].name}.`, 'info'); C.saveCampaign(s); this.refresh(); });
    el.querySelectorAll('[data-act=record]').forEach((b) => b.onclick = (e) => { e.preventDefault(); this.showRecord(); });
  }

  showShop() {
    const s = this.state, el = $('#battles');
    el.style.display = 'flex';
    const render = () => {
      el.innerHTML = `<div class="modal"><h2>Quartermaster <small>${s.points} points available</small></h2>
        ${O.SHOP.map((it) => {
          const owned = it.key === 'training' ? s.kit.training >= 3 : s.kit[it.key];
          const cost = it.key === 'training' && s.kit.training < 3 ? O.shopCost(s, it) : it.cost;
          return `<div class="asset"><span class="tx"><b>${esc(it.label)}${it.key === 'training' ? ` (level ${s.kit.training}/3)` : ''}</b><small>${esc(it.desc)}</small></span>
            ${owned ? '<b class="good">Issued</b>' : `<button class="sm ${O.canBuy(s, it) ? 'primary' : ''}" data-buy="${it.key}" ${O.canBuy(s, it) ? '' : 'disabled'}>${cost} pts</button>`}</div>`;
        }).join('')}
        <div class="row end"><button class="primary" id="shopClose">Done</button></div></div>`;
      el.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => { if (O.buy(s, b.dataset.buy)) { audio.ui(); render(); this.refresh(); } });
      el.querySelector('#shopClose').onclick = () => { el.style.display = 'none'; this.refresh(); };
    };
    render();
  }

  showRecord() {
    const s = this.state, el = $('#battles'), car = s.career;
    el.style.display = 'flex';
    const date = (d) => { const t = new Date(s.startDate + d * 86400000); return `${t.getUTCDate()}/${t.getUTCMonth() + 1}/${String(t.getUTCFullYear()).slice(2)}`; };
    el.innerHTML = `<div class="modal"><h2>Service record <small>${O.RANKS[car.rank][0]} · ${s.pointsTotal} career points</small></h2>
      <h3>Decorations</h3>${car.medals.length ? car.medals.map((m) => `<div class="kv"><span>${O.MEDALS[m.medal]}</span><b>${date(m.day)} · ${esc(REGIONS[m.region].name)}</b></div>`).join('') : '<p class="muted">None yet.</p>'}
      <h3>Logbook</h3>${car.log.length ? car.log.map((l) => `<div class="kv"><span>${date(l.day)} · ${esc(O.MISSION_TYPES[l.type].label)}: ${esc(l.title)} (${esc(REGIONS[l.region].name)})</span><b class="${l.ok ? 'good' : 'bad'}">${l.ok ? 'Success' : 'Failed'} · ${l.kills}k · ${l.kia} KIA · +${l.pts}</b></div>`).join('') : '<p class="muted">No operations flown yet.</p>'}
      <div class="row end"><button class="primary" id="recClose">Close</button></div></div>`;
    el.querySelector('#recClose').onclick = () => { el.style.display = 'none'; };
  }

  toast(t) {
    const el = $('#toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('show'), 2600);
  }

  updateClock() {
    const left = Math.max(0, F.TICK_SECONDS - (this.app.tickAcc || 0));
    const el = $('#tTurn'); if (!el) return;
    const txt = this.state.phase === 'over' ? '—' : this.app.frontPaused ? 'paused' : `${Math.ceil(left)}s`;
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

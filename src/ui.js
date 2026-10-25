'use strict';
// Interface: order panel, roster, radio log, briefing with loadout, debrief, help.

const ORDER_LABEL = {
  bound: 'Bound', assault: 'Assault', suppress: 'Suppress', launcher: '40mm', frag: 'Frag', face: 'Face',
};
// Orders that need a point on the map.
const TARGETED = ['bound', 'assault', 'suppress', 'launcher', 'frag', 'face'];

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const UI = {
  logLines: [], rosterRows: [], tickT: 0,

  init() {
    this.buildOrders();
    OPORD.init();
    $('btnPause').addEventListener('click', () => togglePause());
    $('btnSpeed').addEventListener('click', () => { G.speed = G.speed >= 16 ? 1 : G.speed * 2; this.refreshBar(); });
    $('btnMeasure').addEventListener('click', () => this.setMeasuring(!G.ui.measuring));
    $('btn3d').addEventListener('click', () => View3D.toggle());
    document.querySelectorAll('#ctl3d button').forEach(b => b.addEventListener('click', () => View3D.nudge(b.dataset.n)));
    // Phones: the orders fold away under one button, leaving the unit chips.
    $('btnOrdersMore').addEventListener('click', () => this.setOrdersOpen(!document.body.classList.contains('orders-open')));
    $('btnCones').addEventListener('click', () => { G.ui.cones = !G.ui.cones; $('btnCones').classList.toggle('on', G.ui.cones); });
    $('btnRoster').addEventListener('click', () => document.body.classList.toggle('roster-open'));
    $('rosterTab').addEventListener('click', () => document.body.classList.remove('roster-min'));
    $('btnHelp').addEventListener('click', () => this.showModal('help'));
    $('btnMenu').addEventListener('click', () => this.showBriefing());
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.hideModal(b.dataset.close)));
  },

  // ------------------------------------------------------------ order panel
  buildOrders() {
    const groups = [
      { label: 'Move', items: [['mode', 'walk', 'Walk'], ['mode', 'rush', 'Rush'], ['mode', 'crawl', 'Crawl'],
        ['order', 'bound', 'Bound'], ['order', 'assault', 'Assault']] },
      { label: 'Posture', items: [['posture', 'stand', 'Stand'], ['posture', 'kneel', 'Kneel'], ['posture', 'prone', 'Prone']] },
      { label: 'Fire', items: [['fire', 'free', 'At will'], ['fire', 'return', 'Return'], ['fire', 'hold', 'Hold'],
        ['order', 'suppress', 'Suppress'], ['now', 'lift', 'Lift']] },
      { label: 'Weapons', items: [['order', 'launcher', '40mm'], ['order', 'frag', 'Frag']] },
      { label: 'Act', items: [['now', 'cover', 'Take cover'], ['now', 'fallback', 'Fall back'], ['now', 'halt', 'Halt'], ['order', 'face', 'Face']] },
      { label: 'Formation', items: FORMATION_KEYS.map(k => ['formation', k, FORMATIONS[k].label]) },
    ];
    const grid = $('orderGrid');
    for (const g of groups) {
      const box = el('div', 'ogroup');
      box.appendChild(el('div', 'olabel', g.label));
      const row = el('div', 'obuttons');
      for (const [kind, val, text] of g.items) {
        const b = el('button', 'obtn', text);
        b.dataset.kind = kind; b.dataset.val = val;
        b.addEventListener('click', () => { this.onOrderButton(kind, val); if (window.innerWidth <= 760) this.setOrdersOpen(false); });
        // Pointing at a formation shows the selected unit's ghost in that formation.
        if (kind === 'formation') {
          b.addEventListener('pointerenter', () => { G.ui.ghostForm = val; });
          b.addEventListener('pointerleave', () => { if (G.ui.ghostForm === val) G.ui.ghostForm = null; });
        }
        row.appendChild(b);
      }
      box.appendChild(row);
      grid.appendChild(box);
    }
    const chips = $('selChips');
    const mk = (text, fn) => { const b = el('button', 'chip', text); b.addEventListener('click', fn); chips.appendChild(b); return b; };
    this.chipSquad = mk('Squad', () => this.select({ level: 'squad', squad: G.squads.blue }));
    this.chipTeams = [1, 2, 3].map(n => mk(ORDINAL[n - 1] + ' FT', () => this.selectTeam(n)));
  },

  onOrderButton(kind, val) {
    if (kind === 'mode') { G.ui.moveMode = val; G.ui.pending = null; this.refreshOrders(); this.toast(MOVE[val].label + ': tap the map to move.'); return; }
    const sel = G.ui.sel;
    if (!sel) { this.toast('Select a Marine, a fire team or the squad first.'); return; }
    if (kind === 'order') {
      G.ui.pending = G.ui.pending === val ? null : val;
      if (G.ui.pending) this.toast({
        bound: 'Tap the objective for the bounds.', assault: 'Tap the point to assault.', suppress: 'Tap the area to suppress.',
        launcher: 'Tap the 40mm target.', frag: 'Tap where the grenade should land.', face: 'Tap the direction to watch.' }[val]);
      this.refreshOrders();
      return;
    }
    G.ui.pending = null;
    if (kind === 'now') issueOrder(sel, val);
    else if (kind === 'posture') issueOrder(sel, 'posture', val);
    else if (kind === 'fire') issueOrder(sel, 'fire', val);
    else if (kind === 'formation') issueOrder(sel, 'formation', val);
    this.refreshOrders();
  },

  refreshOrders() {
    const sel = G.ui.sel, m = selMembers(sel).filter(s => s.active);
    const common = (fn) => { if (!m.length) return null; const v = fn(m[0]); return m.every(s => fn(s) === v) ? v : null; };
    const posture = common(s => s.homePosture), fire = common(s => s.fireControl);
    const form = sel ? (sel.level === 'squad' ? sel.squad.formation : sel.level === 'team' ? sel.team.formation : null) : null;
    document.querySelectorAll('#orderGrid .obtn').forEach(b => {
      const k = b.dataset.kind, v = b.dataset.val;
      let on = false, dis = !sel && k !== 'mode';
      if (k === 'mode') on = G.ui.moveMode === v;
      else if (k === 'posture') on = posture === v;
      else if (k === 'fire') on = fire === v;
      else if (k === 'formation') { on = form === v; dis = dis || !form; }
      else if (k === 'order') on = G.ui.pending === v;
      if (v === 'launcher') dis = dis || !m.some(s => s.launcher && s.lRounds > 0);
      b.classList.toggle('on', on);
      b.disabled = dis;
    });
    this.chipSquad.classList.toggle('on', sel && sel.level === 'squad');
    this.chipTeams.forEach((c, i) => {
      const t = G.squads.blue && G.squads.blue.teams[i];
      c.classList.toggle('on', !!(sel && sel.level === 'team' && sel.team === t));
      c.disabled = !t || !t.members.some(s => s.active);
    });
    let txt = 'Nothing selected. Tap a Marine, tap again for the fire team, again for the squad.';
    if (sel) {
      const n = m.length, tot = selMembers(sel).length;
      txt = selName(sel) + (sel.level === 'soldier' ? ' · ' + sel.soldier.title + ' · ' + sel.soldier.weapon.name
        : ' · ' + n + ' of ' + tot + ' effective');
    }
    $('selText').textContent = txt;
  },

  // ------------------------------------------------------------ selection
  select(sel) {
    G.ui.sel = sel; G.ui.pending = null;
    this.refreshOrders(); this.refreshRosterSel();
  },
  selectTeam(n) {
    const t = G.squads.blue.teams[n - 1];
    if (t && t.members.some(s => s.active)) this.select({ level: 'team', team: t, squad: t.squad });
  },
  // Tapping a Marine cycles: the man, his fire team, the squad.
  cycleSelect(s) {
    const sel = G.ui.sel;
    if (sel && sel.level === 'soldier' && sel.soldier === s) {
      if (s.team.num) this.select({ level: 'team', team: s.team, squad: s.squad });
      else this.select({ level: 'squad', squad: s.squad });
    } else if (sel && sel.level === 'team' && sel.team === s.team) {
      this.select({ level: 'squad', squad: s.squad });
    } else {
      this.select({ level: 'soldier', soldier: s, team: s.team, squad: s.squad });
    }
  },

  // ------------------------------------------------------------ map taps
  // A tap on the map at screen point (sx, sy). The 3D view passes the ground point and the
  // piece it found there in `at`; on the flat map both come from the screen point.
  handleTap(sx, sy, secondary, at) {
    if (!G.running || G.over) return;
    if ($('planMenu')) { this.closePlanMenu(); return; }
    const w = at ? at.w : toWorld(sx, sy);
    if (G.ui.measuring && !secondary) { this.tapeTap(sx, sy, w); return; }
    if (Plan.tool && !secondary) { Plan.place(w); return; }
    // A tap on a ghost picks that unit where the plan leaves it, to plan its next step.
    const ghost = !secondary && Plan.planning ? (at ? at.ghost : ghostAt(sx, sy)) : null;
    if (ghost) {
      this.select(Plan.unitSel(ghost.unit));
      this.toast(PLAN_UNITS[ghost.unit] + ' at ' + ghost.name + ': tap the map for its next step.');
      return;
    }
    const piece = at ? at.piece : pieceAt(sx, sy);
    const sel = G.ui.sel;
    // An enemy piece stands for its nearest visible, effective man.
    const enemy = piece && piece.side === 'red' ? (piece.kind === 'man' ? (piece.soldier.active ? piece.soldier : null)
      : piece.live.filter(s => enemyVisible(s)).sort((a, b) => dist(a.x, a.y, w.x, w.y) - dist(b.x, b.y, w.x, w.y))[0] || null) : null;
    // While planning, nothing moves: a tap on the map with a unit selected offers the
    // control measures and plan lines that can be set at that spot.
    if (Plan.planning && !(piece && piece.side === 'blue' && !secondary)) {
      if (sel && G.ui.pending) {
        const p = G.ui.pending, step = { bound: 'bound', assault: 'obj', suppress: 'trp' }[p];
        G.ui.pending = null; this.refreshOrders();
        if (step) Plan.addStep(sel, w, step);
        else this.toast('That order is given by radio after step-off.');
        return;
      }
      if (sel) { this.planMenu(sx, sy, w, sel); return; }
      if (secondary) return;
    }
    if (secondary) {
      G.ui.pending = null;
      if (sel) issueOrder(sel, enemy ? 'engage' : 'move', enemy || w);
      this.refreshOrders();
      return;
    }
    if (G.ui.pending && sel) {
      const p = G.ui.pending;
      G.ui.pending = null;
      issueOrder(sel, p, enemy && p !== 'face' ? { x: enemy.x, y: enemy.y } : w);
      this.refreshOrders();
      return;
    }
    if (piece && piece.side === 'blue') {
      if (piece.kind === 'man') { if (piece.soldier.alive) this.cycleSelect(piece.soldier); }
      else if (piece.kind === 'team' && piece.team.num) this.select({ level: 'team', team: piece.team, squad: piece.team.squad });
      else this.select({ level: 'squad', squad: G.squads.blue });
      return;
    }
    if (enemy && sel) { issueOrder(sel, 'engage', enemy); return; }
    // One click: move in the chosen mode (walk unless another is picked). Two quick clicks
    // on the same spot: rush. The single click waits a moment to see if a second follows.
    if (sel) {
      const now = performance.now(), lt = this.lastMoveTap;
      if (lt && lt.sel === sel && now - lt.t < 320 && Math.hypot(sx - lt.sx, sy - lt.sy) < 30) {
        clearTimeout(lt.timer); this.lastMoveTap = null;
        issueOrder(sel, 'move', { x: w.x, y: w.y, mode: 'rush' });
        return;
      }
      if (lt) { clearTimeout(lt.timer); issueOrder(lt.sel, 'move', lt.w); }
      const timer = setTimeout(() => { if (this.lastMoveTap && this.lastMoveTap.timer === timer) { this.lastMoveTap = null; issueOrder(sel, 'move', w); } }, 320);
      this.lastMoveTap = { t: now, sx, sy, sel, w, timer };
    }
  },

  setOrdersOpen(on) {
    document.body.classList.toggle('orders-open', on);
    $('btnOrdersMore').textContent = on ? 'Orders ▾' : 'Orders ▴';
    $('btnOrdersMore').setAttribute('aria-expanded', on ? 'true' : 'false');
  },

  // ------------------------------------------------------------ measuring tape
  setMeasuring(on) {
    G.ui.measuring = on; G.ui.tapeStart = null;
    $('btnMeasure').classList.toggle('on', on);
    this.toast(on ? 'Tap two points to measure. Tap a distance label to remove it. Measure or Esc to stop.' : 'Measuring off.');
  },
  tapeTap(sx, sy, w) {
    // A tap on a label removes that measurement.
    const hit = G.ui.tapes.findIndex(t => { const m = toScreen((t.a.x + t.b.x) / 2, (t.a.y + t.b.y) / 2); return Math.abs(m.x - sx) < 48 && Math.abs(m.y - sy) < 14; });
    if (hit >= 0 && !G.ui.tapeStart) { G.ui.tapes.splice(hit, 1); return; }
    if (!G.ui.tapeStart) { G.ui.tapeStart = { x: w.x, y: w.y }; this.toast('Tap the second point.'); return; }
    const t = { a: G.ui.tapeStart, b: { x: w.x, y: w.y } };
    G.ui.tapes.push(t); G.ui.tapeStart = null;
    this.toast(tapeLabel(t.a, t.b) + ', grid ' + gridRef(t.a.x, t.a.y) + ' to ' + gridRef(t.b.x, t.b.y) + '.');
  },

  planMenu(sx, sy, w, sel) {
    this.closePlanMenu();
    const unit = Plan.planUnit(sel), m = el('div', 'planmenu');
    m.id = 'planMenu';
    m.appendChild(el('div', 'pmhead', PLAN_UNITS[unit] + ' · ' + gridRef(w.x, w.y)));
    const items = [
      ['cp', 'Checkpoint', 'move here'], ['bound', 'Bound here', 'bounding overwatch'],
      ['rte', 'Route from here', 'tap waypoints'], ['fp', 'Fighting position', 'occupy and defend'],
      ['sbf', 'Support by fire', 'fire onto the objective'], ['aslt', 'Assault position', 'last cover before the assault'],
      ['obj', 'Objective', 'assault here'], ['trp', 'Target ref. point', 'suppress here'],
    ];
    for (const [k, label, note] of items) {
      const b = el('button', 'pmitem');
      b.appendChild(el('b', null, label)); b.appendChild(el('span', null, note));
      b.addEventListener('click', () => { this.closePlanMenu(); Plan.addStep(sel, w, k); });
      m.appendChild(b);
    }
    const c = el('button', 'pmitem pmcancel', 'Cancel');
    c.addEventListener('click', () => this.closePlanMenu());
    m.appendChild(c);
    document.body.appendChild(m);
    const r = m.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    m.style.left = clamp(sx + 10, 8, vw - r.width - 8) + 'px';
    m.style.top = clamp(sy - r.height / 2, 8, vh - r.height - 8) + 'px';
  },
  closePlanMenu() { const m = $('planMenu'); if (m) m.remove(); },

  // ------------------------------------------------------------ roster
  buildRoster() {
    const box = $('roster');
    box.innerHTML = '';
    this.rosterRows = [];
    const top = el('div', 'rtop');
    top.appendChild(el('span', null, 'Roster'));
    const min = el('button', 'obtn mini', '◀');
    min.title = 'Minimize the roster';
    min.addEventListener('click', () => {
      // On a phone the roster is a sheet that the Roster button opens; here it just closes.
      if (window.innerWidth <= 760) document.body.classList.remove('roster-open');
      else document.body.classList.add('roster-min');
    });
    top.appendChild(min);
    box.appendChild(top);
    const sq = G.squads.blue;
    for (const t of [sq.hq, ...sq.teams]) {
      const sec = el('section', 'rteam');
      const head = el('button', 'rhead');
      head.appendChild(el('span', 'rname', t.num ? t.name : 'Squad leader'));
      const mor = el('span', 'rmorale');
      mor.appendChild(el('i'));
      head.appendChild(mor);
      head.addEventListener('click', () => t.num ? this.selectTeam(t.num) : this.select({ level: 'squad', squad: sq }));
      sec.appendChild(head);
      t.ui = { sec, mor: mor.firstChild };
      for (const s of t.members) {
        const row = el('button', 'rrow');
        row.appendChild(symbolCanvas(s.billet, 'blue', 22));
        const who = el('span', 'rwho');
        who.appendChild(el('b', null, s.label));
        who.appendChild(el('small', null, s.title));
        row.appendChild(who);
        const st = el('span', 'rstat');
        const ammo = el('span', 'rammo');
        row.appendChild(st); row.appendChild(ammo);
        row.addEventListener('click', () => {
          if (s.alive) this.select({ level: 'soldier', soldier: s, team: s.team, squad: s.squad });
          R.cam.zoom = Math.max(R.cam.zoom, 3); R.cam.x = s.x; R.cam.y = s.y; clampCam();
        });
        sec.appendChild(row);
        this.rosterRows.push({ s, row, st, ammo });
      }
      box.appendChild(sec);
    }
  },
  refreshRoster() {
    for (const r of this.rosterRows) {
      const s = r.s, st = s.statusText;
      r.st.textContent = st;
      r.st.dataset.state = s.health === 'kia' || s.health === 'serious' ? 'down' : s.pinned || s.routing ? 'bad' : s.suppressed || s.health === 'light' ? 'warn' : 'ok';
      let a = s.ammoText;
      if (s.launcher) a += ' · ' + s.lRounds + '×40';
      if (s.frags) a += ' · ' + s.frags + 'F';
      r.ammo.textContent = a;
      r.row.classList.toggle('dead', !s.alive || s.health === 'serious');
    }
    const sq = G.squads.blue;
    for (const t of [sq.hq, ...sq.teams]) {
      if (!t.ui) continue;
      t.ui.mor.style.width = clamp(t.morale, 0, 100) + '%';
      t.ui.mor.dataset.state = t.broken ? 'bad' : t.shaken ? 'warn' : 'ok';
    }
  },
  refreshRosterSel() {
    const m = new Set(selMembers(G.ui.sel));
    for (const r of this.rosterRows) r.row.classList.toggle('sel', m.has(r.s));
  },

  // ------------------------------------------------------------ log and toast
  log(msg, kind) {
    this.logLines.push({ msg, kind: kind || 'info', t: G.time });
    if (this.logLines.length > 60) this.logLines.shift();
    const box = $('log');
    const line = el('div', 'lline ' + (kind || 'info'));
    line.appendChild(el('span', 'ltime', fmtClock(G.time)));
    line.appendChild(el('span', null, msg));
    box.appendChild(line);
    while (box.children.length > 6) box.removeChild(box.firstChild);
  },
  toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.hidden = true; }, 2600);
  },

  refreshBar() {
    const planning = G.running && Plan.planning;
    $('clock').textContent = !G.running || !Plan.timeAvail ? fmtClock(G.time)
      : planning ? Plan.countdown() : 'H+' + fmtClock(G.time - Plan.stepOff);
    $('btnSpeed').disabled = planning;
    OPORD.refreshClock();
    $('btnPause').textContent = G.paused ? 'Resume' : 'Pause';
    $('btnPause').classList.toggle('on', G.paused);
    $('btnSpeed').textContent = (planning ? PLAN_RATE : G.speed) + '×';
  },

  tick(dt) {
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = 0.25;
    this.refreshBar();
    if (G.running) { this.refreshRoster(); this.refreshOrders(); }
    G.ui.panelH = $('orders').offsetHeight;
    document.documentElement.style.setProperty('--orders-h', G.ui.panelH + 'px');
  },

  // ------------------------------------------------------------ modals
  showModal(id) { $(id).hidden = false; if (G.running && !G.paused) togglePause(); },
  hideModal(id) { $(id).hidden = true; },

  // New mission: choose the kind of mission and the map. The order itself follows on the map.
  showBriefing() {
    const set = G.settings;
    const box = $('briefBody');
    box.innerHTML = '';
    const sit = el('div', 'bsit');
    sit.appendChild(el('h3', null, 'Mission type'));
    const mp = el('p');
    const modes = { attack: 'Attack. The enemy holds a position and digs in while you plan.',
      meeting: 'Meeting engagement. The enemy is moving toward you while you plan.',
      random: 'Either one, chosen at random.' };
    const modeSel = el('select'); modeSel.id = 'missionMode';
    for (const [k, t] of [['random', 'Random'], ['attack', 'Attack a position'], ['meeting', 'Meeting engagement']]) {
      const o = el('option', null, t); o.value = k; if (set.mode === k) o.selected = true; modeSel.appendChild(o);
    }
    const desc = el('span', 'bdesc', modes[set.mode]);
    modeSel.addEventListener('change', () => { set.mode = modeSel.value; desc.textContent = modes[set.mode]; });
    mp.appendChild(modeSel); mp.appendChild(desc);
    sit.appendChild(mp);
    const rp = el('p');
    const regSel = el('select'); regSel.id = 'missionRegion';
    for (const [k, t] of [['random', 'Random region'], ...REGION_KEYS.map(k => [k, REGIONS[k].label])]) {
      const o = el('option', null, t); o.value = k; if (set.region === k) o.selected = true; regSel.appendChild(o);
    }
    const rdesc = el('span', 'bdesc', set.region === 'random' ? 'Any of the regions, drawn from the map number.' : REGIONS[set.region].brief);
    regSel.addEventListener('change', () => { set.region = regSel.value; rdesc.textContent = set.region === 'random' ? 'Any of the regions, drawn from the map number.' : REGIONS[set.region].brief; });
    sit.appendChild(el('h3', null, 'Region'));
    rp.appendChild(regSel); rp.appendChild(rdesc);
    sit.appendChild(rp);
    const seedRow = el('p', 'bseed');
    seedRow.appendChild(el('span', null, 'Map number '));
    const seedIn = el('input'); seedIn.id = 'missionSeed'; seedIn.type = 'number'; seedIn.value = set.seed;
    seedIn.addEventListener('change', () => { set.seed = parseInt(seedIn.value, 10) || 1; });
    const reroll = el('button', 'obtn', 'New map');
    reroll.addEventListener('click', () => { set.seed = Math.floor(Math.random() * 99999) + 1; seedIn.value = set.seed; });
    seedRow.appendChild(seedIn); seedRow.appendChild(reroll);
    sit.appendChild(seedRow);
    box.appendChild(sit);
    const how = el('div', 'bsit');
    how.appendChild(el('h3', null, 'Troop leading'));
    how.appendChild(el('p', null, 'You receive a five-paragraph order beside the map: Orientation, Situation, Mission, Execution, Admin & Logistics, Command & Signal. Plan on the map, then step off.'));
    how.appendChild(el('p', null, 'The clock runs while you plan, at ' + PLAN_RATE + '× speed. Use no more than a third of the time available; the enemy uses the rest.'));
    box.appendChild(how);
    this.showModal('briefing');
  },

  // Loadout by billet, editable while planning.
  renderLoadout(box, onChange) {
    const set = G.settings, lo = set.loadout;
    const wrap = el('div', 'bload');
    wrap.appendChild(el('h4', null, 'Loadout'));
    const tableWrap = el('div', 'tablewrap');
    const tbl = el('table', 'ltable');
    const head = el('tr');
    for (const h of ['', 'Billet', 'Weapon', 'Spare mags', '40mm', 'Frags', 'Load']) head.appendChild(el('th', null, h));
    tbl.appendChild(head);
    const kgCells = {};
    const recalc = () => {
      for (const k of Object.keys(USMC_BILLETS)) {
        const l = lo[k], w = WEAPONS[l.weapon];
        let kg = 22 + w.kg + (l.mags + 1) * (MAG_KG[w.mag] || 0.5) + l.frags * GRENADES.M67.kg;
        if (l.launcher) kg += 1.4 + l.lRounds * LAUNCHERS[l.launcher].kg;
        kgCells[k].textContent = kg.toFixed(1) + ' kg';
      }
    };
    const changed = () => { recalc(); saveSettings(); if (onChange) onChange(); };
    const num = (k, field, min, max) => {
      const i = el('input'); i.type = 'number'; i.min = min; i.max = max; i.value = lo[k][field];
      i.id = 'lo-' + k + '-' + field;
      i.addEventListener('change', () => { lo[k][field] = clamp(parseInt(i.value, 10) || 0, min, max); i.value = lo[k][field]; changed(); });
      return i;
    };
    for (const k of Object.keys(USMC_BILLETS)) {
      const b = USMC_BILLETS[k], tr = el('tr');
      const sc = el('td'); sc.appendChild(symbolCanvas(k, 'blue', 22)); tr.appendChild(sc);
      tr.appendChild(el('td', 'bname', b.title + (k === 'SL' ? '' : ' ×3')));
      const wtd = el('td'), ws = el('select'); ws.id = 'lo-' + k + '-weapon';
      for (const wk of b.weapons) { const o = el('option', null, WEAPONS[wk].name); o.value = wk; if (lo[k].weapon === wk) o.selected = true; ws.appendChild(o); }
      wtd.appendChild(ws); tr.appendChild(wtd);
      const mtd = el('td'), mags = num(k, 'mags', 1, 30); mtd.appendChild(mags); tr.appendChild(mtd);
      ws.addEventListener('change', () => {
        lo[k].weapon = ws.value; lo[k].mags = WEAPONS[ws.value].mags - 1; mags.value = lo[k].mags; changed();
      });
      const gtd = el('td');
      if (b.launchers) {
        const ls = el('select'); ls.id = 'lo-G-launcher';
        for (const lk of b.launchers) { const o = el('option', null, lk); o.value = lk; if (lo[k].launcher === lk) o.selected = true; ls.appendChild(o); }
        ls.addEventListener('change', () => { lo[k].launcher = ls.value; changed(); });
        gtd.className = 'cellrow';
        gtd.appendChild(ls); gtd.appendChild(num(k, 'lRounds', 0, 24));
      } else gtd.textContent = '—';
      tr.appendChild(gtd);
      const ftd = el('td'); ftd.appendChild(num(k, 'frags', 0, 4)); tr.appendChild(ftd);
      kgCells[k] = el('td', 'kg'); tr.appendChild(kgCells[k]);
      tbl.appendChild(tr);
    }
    tableWrap.appendChild(tbl);
    wrap.appendChild(tableWrap);
    wrap.appendChild(el('p', 'bnote', 'Load includes about 22 kg of helmet, plates, water and kit. Heavier loads slow movement and tire men faster.'));
    const reset = el('button', 'obtn', 'Standard loadout');
    reset.addEventListener('click', () => { set.loadout = defaultLoadout(); saveSettings(); if (onChange) onChange(); OPORD.refresh(); });
    wrap.appendChild(reset);
    box.appendChild(wrap);
    recalc();
  },

  showDebrief(result) {
    const box = $('debriefBody');
    box.innerHTML = '';
    const won = result === 'victory';
    $('debriefTitle').textContent = won ? 'Enemy defeated' : 'Squad combat ineffective';
    box.appendChild(el('p', 'dsub', (won ? 'The enemy is destroyed or has withdrawn.' : 'Your squad can no longer fight.') + ' Elapsed time ' + fmtClock(G.time) + '.'));
    const count = (sq) => {
      const all = sq.all;
      return {
        kia: all.filter(s => s.health === 'kia').length,
        serious: all.filter(s => s.health === 'serious').length,
        light: all.filter(s => s.health === 'light').length,
        gone: all.filter(s => s.routed || s.routing).length,
        effective: all.filter(s => s.active && !s.routing).length,
        total: all.length,
        shots: all.reduce((n, s) => n + s.shots, 0),
        hits: all.reduce((n, s) => n + s.hits, 0),
      };
    };
    const b = count(G.squads.blue), r = count(G.squads.red);
    const rows = [['Strength', b.total, r.total], ['Killed', b.kia, r.kia], ['Serious casualties', b.serious, r.serious],
      ['Wounded, fighting', b.light, r.light], ['Withdrew or fled', b.gone, r.gone], ['Effective at end', b.effective, r.effective],
      ['Rounds fired', b.shots, r.shots], ['Hits', b.hits, r.hits]];
    const pre = el('pre', 'dtable');
    const line = (a, x, y) => a.padEnd(19) + String(x).padStart(8) + String(y).padStart(7);
    pre.textContent = line('', 'Marines', 'Enemy') + '\n' + rows.map(rw => line(rw[0], rw[1], rw[2])).join('\n');
    box.appendChild(pre);
    if (Plan.timeAvail) {
      const aar = Plan.afterAction(result);
      const done = Plan.lines.filter(l => l.status === 'done').length;
      const used = Plan.planning ? G.time - Plan.planStart : Plan.planUsed;
      const head = el('div', 'daar');
      head.appendChild(el('b', 'oletter', aar.letter));
      head.appendChild(el('span', null, 'Mission grade ' + Math.round(aar.total) + '/100'));
      box.appendChild(head);
      const g = el('pre', 'dtable');
      const row = (a, v, w, pts) => a.padEnd(12) + String(v).padStart(7) + String(w).padStart(8) + String(pts).padStart(8);
      g.textContent = [row('', 'Score', 'Weight', 'Points'),
        ...aar.rows.map(([a, v, w]) => row(a, Math.round(v), w + '%', Math.round(v * w / 100))),
        '-'.repeat(35), row('Total', '', '', Math.round(aar.total))].join('\n');
      box.appendChild(g);
      box.appendChild(el('p', 'dsub', 'Plan grade ' + (Plan.score != null ? Plan.letter(Plan.score) + ' (' + Math.round(Plan.score) + ')' : 'none: the squad never stepped off') +
        '. Planning took ' + fmtClock(used) + ' of ' + fmtClock(Plan.timeAvail) + ' available (one third is ' + fmtClock(Plan.timeAvail / 3) + '). ' +
        done + ' of ' + Plan.lines.length + ' plan lines completed.'));
    }
    $('debrief').hidden = false;
  },
};

function togglePause() {
  if (!G.running) return;
  G.paused = !G.paused;
  UI.refreshBar();
}

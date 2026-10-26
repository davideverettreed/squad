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
      { label: 'Formation', items: [...FORMATION_KEYS.map(k => ['formation', k, FORMATIONS[k].label]), ['spacing', 'closer', 'Closer (Z)'], ['spacing', 'wider', 'Wider (X)']] },
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
    this.chipSquad = mk('Whole squad', () => this.select({ level: 'squad', squad: G.squads.blue }));
    this.chipTeams = [1, 2, 3].map(n => mk(ORDINAL[n - 1] + ' FT', () => this.selectTeam(n)));
    // Double-click a team: every other team instead (after step-off).
    this.chipTeams.forEach((c, i) => c.addEventListener('dblclick', () => this.selectAllBut(i + 1)));
  },

  onOrderButton(kind, val) {
    if (kind === 'mode') {
      // With a mouse the move button arms a move: the next left click is where to go.
      G.ui.moveMode = val; G.ui.pending = G.ui.mouse && G.ui.sel ? 'move' : null; this.refreshOrders();
      this.toast(MOVE[val].label + (G.ui.mouse ? ': click where to go (or right-click the map).' : ': tap the map to move.'));
      return;
    }
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
    else if (kind === 'spacing') this.changeSpacing(val === 'wider' ? 1 : -1);
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
      else if (k === 'spacing') dis = dis || !sel || sel.level === 'soldier';
      else if (k === 'order') on = G.ui.pending === v;
      if (v === 'launcher') dis = dis || !m.some(s => s.launcher && s.lRounds > 0);
      b.classList.toggle('on', on);
      b.disabled = dis;
    });
    this.chipSquad.classList.toggle('on', sel && sel.level === 'squad');
    this.chipTeams.forEach((c, i) => {
      const t = G.squads.blue && G.squads.blue.teams[i];
      c.classList.toggle('on', !!(sel && ((sel.level === 'team' && sel.team === t) || (sel.level === 'group' && sel.teams.includes(t)))));
      c.classList.toggle('not', !!(sel && sel.level === 'group' && sel.except === t));
      c.disabled = !t || !t.members.some(s => s.active);
    });
    let txt = G.ui.mouse ? 'Nothing selected. Left-click a man, again for his team, again for the whole unit; then right-click the map for orders.'
      : 'Nothing selected. Tap a man, tap again for his team, again for the whole unit.';
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
  // A plan ghost tapped: that team, where the plan leaves it. With Shift, add it to (or take
  // it from) the teams already picked; tapped twice, every team at that spot.
  ghostTap(gh, add) {
    const sq = G.squads.blue, t = sq.teams[Number(gh.unit[1]) - 1], now = performance.now(), last = this.lastGhostTap;
    this.lastGhostTap = { unit: gh.unit, t: now };
    let teams;
    if (last && last.unit === gh.unit && now - last.t < 380) teams = Plan.ghosts().filter(o => o.name === gh.name && !o.aim).map(o => sq.teams[Number(o.unit[1]) - 1]);
    else if (add) {
      const cur = G.ui.sel && G.ui.sel.level === 'team' ? [G.ui.sel.team] : G.ui.sel && G.ui.sel.level === 'group' ? G.ui.sel.teams.slice() : [];
      teams = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
    } else teams = [t];
    teams.sort((a, b) => a.num - b.num);
    if (!teams.length) { this.select(null); return; }
    this.select(teams.length === 1 ? { level: 'team', team: teams[0], squad: sq } : { level: 'group', squad: sq, teams, except: null });
    this.toast(Plan.planning ? selName(G.ui.sel) + ' at ' + gh.name + ': tap the map for the next step. Shift-click or double-click a ghost to pick more; drag one to set its spot.'
      : selName(G.ui.sel) + ' selected. Drag its ghost to send it somewhere else.');
  },
  selectAllBut(n) {
    const t = G.squads.blue && G.squads.blue.teams[n - 1];
    if (!t) return;
    const g = groupBut(t);
    if (g.teams.length) this.select(g);
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
    if (ghost) { this.ghostTap(ghost, !!G.ui.shift); return; }
    const piece = at ? at.piece : pieceAt(sx, sy);
    const sel = G.ui.sel;
    // An enemy piece stands for its nearest visible, effective man.
    const enemy = piece && piece.side === 'red' ? (piece.kind === 'man' ? (piece.soldier.active ? piece.soldier : null)
      : piece.live.filter(s => enemyVisible(s)).sort((a, b) => dist(a.x, a.y, w.x, w.y) - dist(b.x, b.y, w.x, w.y))[0] || null) : null;
    if (G.ui.mouse) { this.mouseClick(sx, sy, w, secondary, piece, enemy); return; }
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

  // ------------------------------------------------------------ mouse
  // Left button: select a unit; on empty ground, clear the selection; with an order armed
  // by its button, give it there. Right button: the action menu for the selected unit at
  // that spot (Shift: move there at once). Planning, the right button opens the plan menu.
  mouseClick(sx, sy, w, secondary, piece, enemy) {
    const sel = G.ui.sel;
    if (!secondary) {
      if (G.ui.pending && sel && !(piece && piece.side === 'blue')) {
        const p = G.ui.pending;
        G.ui.pending = null; this.refreshOrders();
        if (Plan.planning) {
          const step = { move: 'cp', bound: 'bound', assault: 'obj', suppress: 'trp' }[p];
          if (step) Plan.addStep(sel, w, step); else this.toast('That order is given by radio after step-off.');
        } else if (p === 'move') issueOrder(sel, 'move', { x: w.x, y: w.y, mode: G.ui.moveMode });
        else issueOrder(sel, p, enemy && p !== 'face' ? { x: enemy.x, y: enemy.y } : w);
        return;
      }
      if (piece && piece.side === 'blue') {
        if (piece.kind === 'man') { if (piece.soldier.alive) this.cycleSelect(piece.soldier); }
        else if (piece.kind === 'team' && piece.team.num) this.select({ level: 'team', team: piece.team, squad: piece.team.squad });
        else this.select({ level: 'squad', squad: G.squads.blue });
        return;
      }
      // Anything else (open ground, the enemy): nothing selected.
      if (sel) this.select(null);
      if (G.ui.pending) { G.ui.pending = null; this.refreshOrders(); }
      return;
    }
    if (!sel) { this.toast('Select a unit first: left-click it.'); return; }
    if (Plan.planning) { this.planMenu(sx, sy, w, sel); return; }
    if (G.ui.shift) { issueOrder(sel, enemy ? 'engage' : 'move', enemy || { x: w.x, y: w.y, mode: G.ui.moveMode }); return; }
    this.actionMenu(sx, sy, w, sel, enemy);
  },

  // The orders that can be given at a spot (or on an enemy man) to the selected unit.
  actionMenu(sx, sy, w, sel, enemy) {
    this.closePlanMenu();
    const m = el('div', 'planmenu'), men = selMembers(sel).filter(commandable);
    m.id = 'planMenu';
    if (!men.length) { this.toast(selName(sel) + ' cannot take orders.'); return; }
    const c = centroid(men), d = Math.round(dist(c.x, c.y, w.x, w.y) / 10) * 10;
    m.appendChild(el('div', 'pmhead', selName(sel) + ' · ' + (enemy ? 'enemy ' + enemy.title.toLowerCase() : 'grid ' + gridRef(w.x, w.y)) + ' · ' + d + ' m'));
    const at = enemy ? { x: enemy.x, y: enemy.y } : { x: w.x, y: w.y };
    const items = [];
    if (enemy) items.push(['Engage', 'fire on this man', () => issueOrder(sel, 'engage', enemy)]);
    items.push(['Move here', 'walk', () => issueOrder(sel, 'move', { ...at, mode: 'walk' })]);
    items.push(['Rush here', 'run, under fire', () => issueOrder(sel, 'move', { ...at, mode: 'rush' })]);
    items.push(['Crawl here', 'low and slow', () => issueOrder(sel, 'move', { ...at, mode: 'crawl' })]);
    if (sel.level !== 'soldier') items.push(['Bound here', 'bounding overwatch', () => issueOrder(sel, 'bound', at)]);
    items.push(['Assault', 'close and fight through', () => issueOrder(sel, 'assault', at)]);
    items.push(['Suppress', 'area fire here', () => issueOrder(sel, 'suppress', at)]);
    const gl = men.filter(s => s.launcher && s.lRounds > 0 && dist(s.x, s.y, at.x, at.y) <= s.launcher.range && dist(s.x, s.y, at.x, at.y) >= s.launcher.min);
    if (gl.length) items.push([gl[0].launcher.name.replace(/ \(.*/, ''), 'three rounds here', () => issueOrder(sel, 'launcher', at)]);
    if (men.some(s => s.frags > 0 && dist(s.x, s.y, at.x, at.y) <= s.grenade.range + 4)) items.push(['Frag', 'throw a grenade here', () => issueOrder(sel, 'frag', at)]);
    items.push(['Watch this way', 'face toward here', () => issueOrder(sel, 'face', at)]);
    for (const [label, note, fn] of items) {
      const b = el('button', 'pmitem');
      b.appendChild(el('b', null, label)); b.appendChild(el('span', null, note));
      b.addEventListener('click', () => { this.closePlanMenu(); fn(); this.refreshOrders(); });
      m.appendChild(b);
    }
    const x = el('button', 'pmitem pmcancel', 'Cancel');
    x.addEventListener('click', () => this.closePlanMenu());
    m.appendChild(x);
    document.body.appendChild(m);
    const r = m.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    m.style.left = clamp(sx + 10, 8, vw - r.width - 8) + 'px';
    m.style.top = clamp(sy - r.height / 2, 8, vh - r.height - 8) + 'px';
  },

  setOrdersOpen(on) {
    document.body.classList.toggle('orders-open', on);
    $('btnOrdersMore').textContent = on ? 'Orders ▾' : 'Orders ▴';
    $('btnOrdersMore').setAttribute('aria-expanded', on ? 'true' : 'false');
  },

  // ------------------------------------------------------------ dispersion
  // Wider or closer intervals for the selected team(s) or squad: about 30% a step, from
  // half to three times the standard. Planning, it sets the interval for later moves; in
  // the fight the men also spread out or close up where they are.
  changeSpacing(dir) {
    const sel = G.ui.sel;
    if (!sel || sel.level === 'soldier') { this.toast('Select a fire team or the squad to change its interval.'); return; }
    const units = sel.level === 'squad' ? [sel.squad, ...sel.squad.teams] : sel.level === 'group' ? sel.teams : [sel.team];
    const f = dir > 0 ? 1.3 : 1 / 1.3;
    let ratio = 1;
    for (const u of units) { const old = u.spacing || 1; u.spacing = clamp(old * f, 0.5, 3); if (u === units[0]) ratio = u.spacing / old; }
    if (Math.abs(ratio - 1) < 0.01) { this.toast((dir > 0 ? 'Already at the widest' : 'Already at the closest') + ' interval.'); return; }
    const m = Math.round(7 * units[units.length - 1].spacing);
    const text = (dir > 0 ? 'spread out' : 'close up') + ', about ' + m + ' m between men';
    if (Plan.planning) { this.toast(selName(sel) + ': ' + text + '.'); return; }
    issueOrder(sel, 'spacing', { ratio, text });
  },

  // ------------------------------------------------------------ dragging a unit (touch)
  // A finger pressed on one of our pieces: a man, a fire team counter or the squad counter.
  unitDragStart(piece) {
    if (!piece || piece.side !== 'blue') return null;
    let sel;
    if (piece.kind === 'man') { if (!piece.soldier.active) return null; sel = { level: 'soldier', soldier: piece.soldier, team: piece.soldier.team, squad: piece.soldier.squad }; }
    else if (piece.kind === 'team' && piece.team.num) sel = { level: 'team', team: piece.team, squad: piece.team.squad };
    else sel = { level: 'squad', squad: G.squads.blue };
    const from = centroid(selMembers(sel).filter(s => s.active));
    G.ui.unitDrag = { sel, from, to: null };
    return G.ui.unitDrag;
  },
  // Let go: while planning, the plan menu for that unit at the spot; after step-off, the
  // move order (by radio) in the chosen mode.
  unitDrop(sx, sy, w, d) {
    G.ui.unitDrag = null;
    if (!G.running || G.over) return;
    this.select(d.sel);
    if (Plan.planning) this.planMenu(sx, sy, w, d.sel);
    else issueOrder(d.sel, 'move', { x: w.x, y: w.y, mode: G.ui.moveMode });
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
    m.appendChild(el('div', 'pmhead', (unit ? PLAN_UNITS[unit] : selName(sel)) + ' · ' + gridRef(w.x, w.y)));
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

  // The menu for a control measure tapped on the map: change it to another kind, rename
  // it, open it in the order, or delete it.
  graphicMenu(sx, sy, g) {
    this.closePlanMenu();
    const K = GRAPHIC_KINDS[g.kind], m = el('div', 'planmenu');
    m.id = 'planMenu';
    m.appendChild(el('div', 'pmhead', g.name + ' · ' + K.label));
    const item = (label, note, fn, cls) => {
      const b = el('button', 'pmitem' + (cls ? ' ' + cls : ''));
      b.appendChild(el('b', null, label)); if (note) b.appendChild(el('span', null, note));
      b.addEventListener('click', fn); m.appendChild(b); return b;
    };
    const used = Plan.lines.filter(l => l.where === g.id || l.target === g.id).length;
    // Rename in place.
    const rn = el('div', 'pmrename');
    const inp = el('input'); inp.type = 'text'; inp.value = g.name; inp.maxLength = 18;
    const ok = el('button', 'obtn mini', 'Rename');
    const rename = () => { g.name = inp.value.trim().toUpperCase() || g.name; this.closePlanMenu(); OPORD.refresh(); };
    ok.addEventListener('click', rename);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') rename(); e.stopPropagation(); });
    rn.appendChild(inp); rn.appendChild(ok); m.appendChild(rn);
    const kinds = Plan.kindsLike(g);
    if (kinds.length) {
      m.appendChild(el('div', 'pmsub', 'Change to'));
      const grid = el('div', 'pmkinds');
      for (const k of kinds) {
        const b = el('button', 'obtn mini', GRAPHIC_KINDS[k].short);
        b.title = GRAPHIC_KINDS[k].label;
        b.addEventListener('click', () => { const old = g.name; Plan.changeKind(g, k); this.closePlanMenu(); OPORD.refresh(); this.toast(old + ' is now ' + g.name + '.'); });
        grid.appendChild(b);
      }
      m.appendChild(grid);
    }
    item('Edit in the order', used ? used + ' plan line' + (used > 1 ? 's' : '') + ' use it' : 'details, sector of fire', () => { this.closePlanMenu(); Plan.selected = g.id; OPORD.show('E'); });
    item('Delete', used ? 'its plan lines lose their place' : '', () => { this.closePlanMenu(); Plan.removeGraphic(g.id); OPORD.refresh(); this.toast(g.name + ' deleted.'); }, 'pmdanger');
    item('Cancel', '', () => this.closePlanMenu(), 'pmcancel');
    document.body.appendChild(m);
    const r = m.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    m.style.left = clamp(sx + 10, 8, vw - r.width - 8) + 'px';
    m.style.top = clamp(sy - r.height / 2, 8, vh - r.height - 8) + 'px';
  },

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
      head.appendChild(el('span', 'rname', t.num ? t.name : 'Squad leader · with 1st FT'));
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
      r.ammo.dataset.state = s.ammoLeft === 0 ? 'bad' : s.ammoFrac < 0.25 ? 'warn' : '';
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
  // Team buttons named for the force: fire teams, squads, sections, groups.
  labelTeams() {
    const sq = G.squads.blue;
    this.chipTeams.forEach((c, i) => { c.textContent = ORDINAL[i] + ' ' + (sq.teamWord || 'FT'); });
    this.chipSquad.textContent = sq.kind === 'usmc' || /^usmc19[789]/.test(sq.kind) ? 'Whole squad' : 'Whole unit';
  },

  showBriefing() {
    const set = G.settings;
    const box = $('briefBody');
    box.innerHTML = '';
    const sit = el('div', 'bsit');
    // The scenario: the enemy, the era, the ground. Today's generic enemy, or a force from history.
    sit.appendChild(el('h3', null, 'Scenario'));
    const sp = el('p');
    const scSel = el('select'); scSel.id = 'missionScenario';
    for (const k of SCENARIO_KEYS) { const o = el('option', null, SCENARIOS[k].label); o.value = k; if (set.scenario === k) o.selected = true; scSel.appendChild(o); }
    const sdesc = el('span', 'bdesc');
    const scText = () => {
      const sc = scenarioOf(set);
      if (sc.custom) return 'Your own battle: pick the enemy and its strength, your force, the mission and the ground below. Any force can fight on any ground, in any era: Viet Cong in the Montana snow, Soviet paratroopers on the California coast.';
      if (!sc.opfor) return 'Today\'s Marines against a present-day enemy of regular soldiers, irregulars, reconnaissance troops or aircrew, depending on the mission.';
      return sc.status + ' · ' + sc.date + ' · ' + sc.place + '. ' + sc.history + ' Enemy: ' + FORCES[sc.opfor].label + ', ' + sc.size[0] + '-' + sc.size[1] + ' men.';
    };
    sdesc.textContent = scText();
    sp.appendChild(scSel); sp.appendChild(sdesc);
    sit.appendChild(sp);
    // Your force: the era's own, or another.
    sit.appendChild(el('h3', null, 'Your force'));
    const fp = el('p');
    const frSel = el('select'); frSel.id = 'missionFriendly';
    const fdesc = el('span', 'bdesc');
    const fillFriendly = () => {
      frSel.innerHTML = '';
      const era = scenarioOf(set).blue || 'usmc';
      const custom = scenarioOf(set).custom;
      const o0 = el('option', null, (custom ? 'Default: ' : 'Of the era: ') + friendlyLabel(era)); o0.value = 'era'; frSel.appendChild(o0);
      for (const k of FRIENDLY_KEYS) { const o = el('option', null, friendlyLabel(k)); o.value = k; frSel.appendChild(o); }
      frSel.value = set.friendly || 'era';
      const k = set.friendly === 'era' || !set.friendly ? era : set.friendly;
      fdesc.textContent = forceInfo(k).unit + (k === era || custom ? '' : ' Not of the era: historical fiction.');
    };
    frSel.addEventListener('change', () => { set.friendly = frSel.value; fillFriendly(); eyebrow(); });
    // The dialog's subtitle: the force you will command.
    const eyebrow = () => {
      const k = set.friendly === 'era' || !set.friendly ? scenarioOf(set).blue || 'usmc' : set.friendly;
      const F = FORCES[k], n = F ? 1 + (F.hq || []).length + 3 * F.groups[0].length : 13;
      $('briefEyebrow').textContent = (F ? F.unitName + ' · ' + F.label : '1st Squad · Marine rifle squad') + ', ' + n + ' men';
    };
    fp.appendChild(frSel); fp.appendChild(fdesc);
    sit.appendChild(fp);
    // A custom battle: the enemy force and its strength.
    const enemyBox = el('div');
    enemyBox.appendChild(el('h3', null, 'Enemy'));
    const ep = el('p'), enSel = el('select'), szSel = el('select'), edesc = el('span', 'bdesc');
    enSel.id = 'missionEnemy'; szSel.id = 'missionEnemySize';
    for (const k of ['generic', ...ENEMY_KEYS]) { const o = el('option', null, enemyLabel(k)); o.value = k; enSel.appendChild(o); }
    for (const k of Object.keys(ENEMY_SIZES)) { const o = el('option', null, ENEMY_SIZES[k].label); o.value = k; szSel.appendChild(o); }
    enSel.value = set.enemy || 'generic'; szSel.value = set.enemySize || 'default';
    const enText = () => {
      const k = enSel.value, z = ENEMY_SIZES[szSel.value];
      const usual = k === 'generic' ? 'as the mission calls for' : usualSize(k).join('-') + ' men';
      edesc.textContent = (k === 'generic' ? 'Regular soldiers, irregulars, reconnaissance troops or aircrew, depending on the mission.' : forceInfo(k).unit + ' Fights by: ' + DOCTRINES[FORCES[k].doctrine].label.toLowerCase() + '.') +
        ' Strength: ' + (z.range ? z.range.join('-') + ' men' : usual) + '.';
    };
    enSel.addEventListener('change', () => { set.enemy = enSel.value; enText(); });
    szSel.addEventListener('change', () => { set.enemySize = szSel.value; enText(); });
    ep.appendChild(enSel); ep.appendChild(szSel); ep.appendChild(edesc);
    enemyBox.appendChild(ep);
    sit.appendChild(enemyBox);
    const showEnemy = () => { enemyBox.hidden = !scenarioOf(set).custom; enText(); };
    showEnemy();
    sit.appendChild(el('h3', null, 'Mission'));
    const mp = el('p');
    // The mission: one of many, at random unless one is picked. The description is the
    // enemy's activity as the order will give it, in general terms.
    const blurb = (k) => k === 'random' ? 'Any of ' + MISSION_KEYS.length + ' missions, chosen at random. The order tells you what you face.'
      : MISSIONS[k].activity({ name: 'the objective', kind: 'open' }, 'toward you') + ' Enemy ' + MISSIONS[k].size[0] + (MISSIONS[k].size[1] > MISSIONS[k].size[0] ? '-' + MISSIONS[k].size[1] : '') + ' men.';
    const modeSel = el('select'); modeSel.id = 'missionMode';
    const desc = el('span', 'bdesc');
    // The missions that fit the scenario.
    const fillModes = () => {
      const pool = scenarioOf(set).missions || MISSION_KEYS;
      if (!pool.includes(set.mode)) set.mode = 'random';
      modeSel.innerHTML = '';
      for (const [k, t] of [['random', 'Random mission' + (pool.length < MISSION_KEYS.length ? ' (' + pool.length + ' fit this scenario)' : '')], ...pool.map(k => [k, MISSIONS[k].label]).sort((a, b) => a[1].localeCompare(b[1]))]) {
        const o = el('option', null, t); o.value = k; if (set.mode === k) o.selected = true; modeSel.appendChild(o);
      }
      desc.textContent = set.mode === 'random' ? 'Any of the ' + pool.length + ' missions that fit, chosen at random. The order tells you what you face.' : blurb(set.mode);
    };
    fillModes();
    modeSel.addEventListener('change', () => { set.mode = modeSel.value; desc.textContent = set.mode === 'random' ? 'Any of the missions that fit, chosen at random. The order tells you what you face.' : blurb(set.mode); });
    mp.appendChild(modeSel); mp.appendChild(desc);
    sit.appendChild(mp);
    const rp = el('p');
    const regSel = el('select'); regSel.id = 'missionRegion';
    for (const [k, t] of [['random', 'Random region'], ...REGION_KEYS.map(k => [k, REGIONS[k].label])]) {
      const o = el('option', null, t); o.value = k; if (set.region === k) o.selected = true; regSel.appendChild(o);
    }
    const rdesc = el('span', 'bdesc');
    const regText = () => {
      const sc = scenarioOf(set);
      if (set.region === 'random') return sc.region ? 'The scenario\'s own ground: ' + REGIONS[sc.region].label + '. ' + REGIONS[sc.region].brief : 'Any of the present-day regions, drawn from the map number.';
      return REGIONS[set.region].brief + (sc.region && sc.region !== set.region ? ' Not the scenario\'s own ground.' : '');
    };
    regSel.options[0].textContent = scenarioOf(set).region ? 'Scenario\'s ground' : 'Random region';
    rdesc.textContent = regText();
    regSel.addEventListener('change', () => { set.region = regSel.value; rdesc.textContent = regText(); });
    scSel.addEventListener('change', () => {
      set.scenario = scSel.value; sdesc.textContent = scText(); fillFriendly(); fillModes(); showEnemy();
      regSel.options[0].textContent = scenarioOf(set).region ? 'Scenario\'s ground' : 'Random region';
      rdesc.textContent = regText(); eyebrow();
    });
    fillFriendly(); eyebrow();
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
    how.appendChild(el('p', null, 'The clock runs while you plan, at ' + PLAN_RATE + '× speed. Nothing moves while you plan, but the enemy uses the time: it digs in, or marches closer. Use no more than a third of the time available.'));
    box.appendChild(how);
    this.showModal('briefing');
  },

  // Another era's force carries what it carried: shown, not chosen.
  renderEraLoadout(box, sq) {
    const wrap = el('div', 'bload');
    wrap.appendChild(el('h4', null, 'Arms and equipment'));
    const tableWrap = el('div', 'tablewrap'), tbl = el('table', 'ltable'), head = el('tr');
    for (const h of ['', 'Billet', 'Weapon', 'Rounds', 'Other', 'Men']) head.appendChild(el('th', null, h));
    tbl.appendChild(head);
    const rows = new Map();
    for (const s of sq.all) {
      const key = s.title + '|' + s.weapon.name + '|' + (s.launcher ? s.launcher.name : '');
      const r = rows.get(key) || { s, n: 0 };
      r.n++; rows.set(key, r);
    }
    for (const { s, n } of rows.values()) {
      const tr = el('tr'), sc = el('td');
      sc.appendChild(symbolCanvas(s.billet, 'blue', 22)); tr.appendChild(sc);
      tr.appendChild(el('td', 'bname', s.title));
      tr.appendChild(el('td', null, s.weapon.name));
      tr.appendChild(el('td', null, s.weapon.mag === 1 ? s.ammoLeft + ' charges' : s.mags + 1 + ' × ' + s.weapon.mag));
      const other = [s.launcher ? s.launcher.name + ' (' + s.lRounds + ')' : '', s.frags ? s.frags + ' ' + s.grenade.name : '', MELEE[s.meleeKey] && s.meleeKey !== 'butt' ? MELEE[s.meleeKey].name : ''].filter(Boolean).join(', ');
      tr.appendChild(el('td', null, other || '—'));
      tr.appendChild(el('td', 'kg', String(n)));
      tbl.appendChild(tr);
    }
    tableWrap.appendChild(tbl); wrap.appendChild(tableWrap);
    box.appendChild(wrap);
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

  // The engagement summed up as an encyclopedia battle box: name, a sketch of the field,
  // when and where, the result, then the two sides column by column.
  battleInfobox(result) {
    const blue = G.squads.blue, red = G.squads.red, m = G.map;
    const fighters = G.soldiers.filter(s => s.shots > 0);
    const c = fighters.length ? centroid(fighters) : { x: (centroid(blue.all).x + G.enemyArea.x) / 2, y: (centroid(blue.all).y + G.enemyArea.y) / 2 };
    // Named for the nearest settlement or hill to where the fighting was.
    let name = null, bd = Infinity;
    for (const p of m.places) { const d = dist(p.x, p.y, c.x, c.y); if (d < bd) { bd = d; name = p.name; } }
    for (const p of m.peaks) { const d = dist(p.x, p.y, c.x, c.y) * 1.3; if (d < bd) { bd = d; name = 'Hill ' + Math.round(m.elevBase + p.e); } }
    const box = el('table', 'wbox');
    const tr = (cls) => { const r = el('tr', cls); box.appendChild(r); return r; };
    const th = (text, cls) => { const r = tr(); const h = el('th', cls || 'wband', text); h.colSpan = 2; r.appendChild(h); return r; };
    const pair = (a, b, cls) => { const r = tr(cls); const x = el('td'), y = el('td'); for (const [cell, v] of [[x, a], [y, b]]) { if (v instanceof Node) cell.appendChild(v); else cell.innerHTML = v; } r.appendChild(x); r.appendChild(y); return r; };
    const lines = (arr) => arr.filter(Boolean).join('<br>');
    th('Battle of ' + (name || gridRef(c.x, c.y)), 'wtitle');
    const sc = G.mission.scenario || SCENARIOS.modern, bi = forceInfo(blue.kind), ri = forceInfo(red.kind);
    if (sc.war) th('Part of ' + sc.war + (sc.status ? ' · ' + sc.status : ''), 'wpart');
    th(G.mission.label + ' · Sand Table Exercise ' + String(G.settings.seed).padStart(5, '0') + ', ' + m.R.label, 'wpart');
    // A sketch of the field: the sheet around the fight, each man where he ended.
    const cell = el('td', 'wimg'); cell.colSpan = 2;
    const cv = el('canvas'); cv.width = 320; cv.height = 210;
    // Framed to take in every man still on the field, with a margin.
    const on = G.soldiers.filter(s => !s.routed);
    let bx0 = Math.min(...on.map(s => s.x)), bx1 = Math.max(...on.map(s => s.x)), by0 = Math.min(...on.map(s => s.y)), by1 = Math.max(...on.map(s => s.y));
    const asp = cv.height / cv.width, span = Math.max(500, bx1 - bx0 + 160, (by1 - by0 + 160) / asp);
    const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
    const ctx = cv.getContext('2d'), k = cv.width / span, x0 = mx - span / 2, y0 = my - span * asp / 2, P = SHEET_PPM;
    if (R.sheet) ctx.drawImage(R.sheet, (SHEET.ml + x0) * P, (SHEET.mt + y0) * P, span * P, span * cv.height / cv.width * P, 0, 0, cv.width, cv.height);
    for (const s of G.soldiers) {
      if (s.routed) continue;
      const px = (s.x - x0) * k, py = (s.y - y0) * k;
      ctx.fillStyle = s.side === 'blue' ? '#1f4fbf' : '#c62828'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (s.side === 'blue') ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      else { ctx.moveTo(px, py - 4); ctx.lineTo(px + 4, py); ctx.lineTo(px, py + 4); ctx.lineTo(px - 4, py); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
      if (!s.active) { ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py + 4); ctx.moveTo(px + 4, py - 4); ctx.lineTo(px - 4, py + 4); ctx.stroke(); }
    }
    cell.appendChild(cv);
    cell.appendChild(el('div', 'wcap', 'The field at the end, H+' + fmtClock(Plan.stepOff != null ? G.time - Plan.stepOff : G.time) + ': ' + bi.men + ' blue, enemy red, casualties crossed.'));
    tr().appendChild(cell);
    const kv = (k, v) => { const r = tr('wkv'); r.appendChild(el('th', 'wk', k)); const d = el('td'); d.innerHTML = v; r.appendChild(d); };
    const dur = Plan.stepOff != null ? G.time - Plan.stepOff : G.time;
    kv('Date', (sc.date ? sc.date + ', ' : '') + 'H-hour to H+' + fmtClock(dur) + ' (' + Math.max(1, Math.round(dur / 60)) + ' min)');
    kv('Location', (sc.place || m.R.label) + '<br><span class="wlink">◉ Grid ' + gridRef(c.x, c.y) + '</span>');
    const bn = '<span class="wlink">' + bi.nation + '</span>', rn = '<span class="wlink">' + ri.nation + '</span>';
    kv('Result', result === 'ammo' ? rn + ' victory: ' + blue.name + ' out of ammunition, withdrew' : result === 'victory' ? bn + ' victory' : result === 'escaped' ? 'Inconclusive: the ' + rn + ' force escaped' : rn + ' victory');
    th('Belligerents');
    pair(bn + (blue.kind === 'usmc' || /^usmc/.test(blue.kind) ? '<br>U.S. Marine Corps' : ''), rn);
    th('Commanders and leaders');
    const sl = blue.leader, el0 = red.leader || red.all[0];
    pair('<span class="wlink">' + sl.label + '</span>' + (sl.health === 'kia' ? ' †' : ''), '<span class="wlink">' + (el0 ? el0.title : 'Unknown') + '</span>' + (el0 && el0.health === 'kia' ? ' †' : ''));
    th('Units involved');
    pair('<span class="wlink">' + blue.name + '</span>, three ' + (blue.teamName || 'Fire Team').toLowerCase() + 's', '<span class="wlink">' + red.name + '</span>, ' + ri.men);
    th('Strength');
    const arms = (sq) => {
      const n = new Map();
      for (const s of sq.all) { n.set(s.weapon.name, (n.get(s.weapon.name) || 0) + 1); if (s.launcher) n.set(s.launcher.name, (n.get(s.launcher.name) || 0) + 1); }
      return [...n].map(([w, k]) => k + ' ' + w);
    };
    const sz = Plan.intel && Plan.intel.sizeReport;
    pair(lines([blue.all.length + ' ' + bi.men, ...arms(blue)]), lines([red.all.length + ' men', ...arms(red), sz ? '<i>Reported: ' + sz.text.replace('OPFOR ', '') + '</i>' : '']));
    th('Casualties and losses');
    const loss = (sq, men) => {
      const kia = sq.all.filter(s => s.health === 'kia').length, ser = sq.all.filter(s => s.health === 'serious').length, wia = sq.all.filter(s => s.health === 'light').length, fled = sq.all.filter(s => (s.routed || s.routing) && s.health !== 'kia' && s.health !== 'serious').length;
      return lines([kia + ' killed', ser + ' seriously wounded', wia + ' wounded', fled ? fled + ' fled' : '', (sq.all.length - kia - ser - fled) + ' of ' + sq.all.length + ' ' + men + ' still fighting']);
    };
    pair(loss(blue, bi.men), loss(red, 'men'));
    th('Ammunition expended');
    const spent = (sq) => {
      const rds = sq.all.reduce((n, s) => n + s.shots, 0), hits = sq.all.reduce((n, s) => n + s.hits, 0);
      const fr = sq.all.reduce((n, s) => n + ((s.fragsStart || 0) - s.frags), 0), gl = sq.all.reduce((n, s) => n + ((s.lStart || 0) - s.lRounds), 0);
      // What is left, against the basic load carried at the start.
      const left = sq.all.reduce((n, s) => n + s.ammoLeft, 0), start = sq.all.reduce((n, s) => n + (s.ammoStart || 0), 0);
      const frLeft = sq.all.reduce((n, s) => n + s.frags, 0), glLeft = sq.all.reduce((n, s) => n + s.lRounds, 0);
      const used = start ? Math.round(clamp(1 - left / start, 0, 1) * 100) : 0;
      return lines([rds + ' rounds fired', hits + ' hits' + (rds ? ' (' + (hits / rds * 100).toFixed(1) + '%)' : ''),
        '<b>' + used + '%</b> of the basic load used; ' + left + ' of ' + start + ' rounds left',
        fr + ' hand grenades thrown, ' + frLeft + ' left', gl || glLeft ? gl + ' launcher rounds fired, ' + glLeft + ' left' : '']);
    };
    pair(spent(blue), spent(red));
    // Hits and kills by weapon: an overview by kind of weapon, then every weapon in detail.
    const ws = G.wstats || { blue: new Map(), red: new Map() };
    const sum = (list) => list.reduce((a, e) => { for (const k of ['shots', 'hits', 'kia', 'serious', 'light']) a[k] += e[k]; return a; }, { shots: 0, hits: 0, kia: 0, serious: 0, light: 0 });
    const byClass = (side) => {
      const m = new Map();
      for (const e of ws[side].values()) { if (!m.has(e.cls)) m.set(e.cls, []); m.get(e.cls).push(e); }
      return [...m].map(([cls, list]) => ({ cls, ...sum(list) })).filter(c => c.shots || c.hits).sort((a, b) => b.hits - a.hits || b.shots - a.shots);
    };
    const overview = (side) => {
      const rows = byClass(side);
      if (!rows.length) return '<i>No fire</i>';
      return lines(rows.map(c => '<b>' + c.cls + '</b>: ' + c.hits + ' hit' + (c.hits === 1 ? '' : 's') + (c.kia ? ', ' + c.kia + ' killed' : '') + (c.serious ? ', ' + c.serious + ' seriously wounded' : '') + (c.light ? ', ' + c.light + ' wounded' : '')));
    };
    th('Hits and kills by weapon');
    pair(overview('blue'), overview('red'));
    const det = tr(), dc = el('td', 'wdetail'); dc.colSpan = 2; det.appendChild(dc);
    const d = el('details'); d.appendChild(el('summary', null, 'In detail: every weapon and every soldier'));
    for (const [side, sq] of [['blue', blue], ['red', red]]) {
      d.appendChild(el('div', 'wdhead', side === 'blue' ? blue.name + ' (' + bi.nation + ')' : red.name + ' (' + ri.nation + ')'));
      const t = el('table', 'wdtable'), h = el('tr');
      for (const c of ['Weapon', 'Fired', 'Hits', 'Hit %', 'Killed', 'Serious', 'Wounded']) h.appendChild(el('th', null, c));
      t.appendChild(h);
      const list = [...ws[side].values()].filter(e => e.shots || e.hits).sort((a, b) => b.hits - a.hits || b.shots - a.shots);
      for (const e of [...list, ...(list.length > 1 ? [{ name: 'Total', ...sum(list), total: true }] : [])]) {
        const r = el('tr', e.total ? 'wdtotal' : null);
        for (const v of [e.name, e.shots, e.hits, e.shots ? (e.hits / e.shots * 100).toFixed(1) : '—', e.kia, e.serious, e.light]) r.appendChild(el('td', null, String(v)));
        t.appendChild(r);
      }
      if (!list.length) { const r = el('tr'), c = el('td', null, 'No fire.'); c.colSpan = 7; r.appendChild(c); t.appendChild(r); }
      d.appendChild(t);
    }
    // Every man who fired or scored: who he was, what he carried, what he did, how he ended.
    d.appendChild(el('div', 'wdhead wdsec', 'By soldier'));
    for (const [side, sq] of [['blue', blue], ['red', red]]) {
      d.appendChild(el('div', 'wdhead', side === 'blue' ? blue.name : red.name));
      const t = el('table', 'wdtable'), h = el('tr');
      for (const c of ['Soldier', 'Weapon', 'Fired', 'Hits', 'Killed', 'Serious', 'Wounded', 'Fate']) h.appendChild(el('th', null, c));
      t.appendChild(h);
      const sc = (s) => s.score || { kia: 0, serious: 0, light: 0 };
      // Rounds, launcher rounds and grenades together.
      const fired = (s) => s.shots + Math.max(0, (s.lStart || 0) - s.lRounds) + Math.max(0, (s.fragsStart || 0) - s.frags);
      const men = sq.all.filter(s => fired(s) || s.hits || side === 'blue')
        .sort((a, b) => sc(b).kia - sc(a).kia || b.hits - a.hits || fired(b) - fired(a));
      for (const s of men) {
        const r = el('tr'), k = sc(s);
        const who = side === 'blue' ? s.label + '<br><small>' + s.title + ', ' + s.team.short + '</small>' : s.title + '<br><small>' + (s.team.num ? s.team.name.replace(/^Enemy /, '') : 'command') + '</small>';
        const fate = s.health === 'kia' ? 'Killed' : s.health === 'serious' ? 'Casualty' : s.escaped ? 'Got away' : s.routed || s.routing ? 'Fled' : s.health === 'light' ? 'Wounded' : 'Fighting';
        const cells = [who, s.weapon.name + (s.launcher ? ', ' + s.launcher.name : ''), fired(s), s.hits, k.kia, k.serious, k.light, fate];
        cells.forEach((v, i) => { const c = el('td'); if (i === 0) c.innerHTML = v; else c.textContent = String(v); r.appendChild(c); });
        t.appendChild(r);
      }
      if (!men.length) { const r = el('tr'), c = el('td', null, 'No one fired.'); c.colSpan = 8; r.appendChild(c); t.appendChild(r); }
      if (side === 'red' && men.length < sq.all.length) {
        const r = el('tr'), c = el('td', null, (sq.all.length - men.length) + ' others never fired.'); c.colSpan = 8; r.appendChild(c); t.appendChild(r);
      }
      d.appendChild(t);
    }
    d.appendChild(el('div', 'wcap', 'Fired counts rounds, grenades, rockets and blows. A man wounded by one weapon (or one soldier) and later killed by another counts under both.'));
    dc.appendChild(d);
    return box;
  },

  showDebrief(result) {
    const box = $('debriefBody');
    box.innerHTML = '';
    const won = result === 'victory';
    $('debriefTitle').textContent = won ? 'Enemy defeated' : result === 'escaped' ? 'Enemy escaped' : result === 'ammo' ? 'Out of ammunition: mission failed' : 'Squad combat ineffective';
    const wrap = el('div', 'dgrid');
    wrap.appendChild(this.battleInfobox(result));
    const side = el('div', 'dside');
    side.appendChild(el('p', 'dsub', G.mission.label + '. ' + (won ? 'The enemy is destroyed or has withdrawn.' : result === 'escaped' ? 'The enemy got away before you could finish it.' : result === 'ammo' ? 'Your squad ran out of ammunition with no resupply available, and fell back off the field.' : 'Your squad can no longer fight.') + ' Elapsed time ' + fmtClock(G.time) + '.'));
    if (Plan.timeAvail) {
      const aar = Plan.afterAction(result);
      const done = Plan.lines.filter(l => l.status === 'done').length;
      const used = Plan.planning ? G.time - Plan.planStart : Plan.planUsed;
      const head = el('div', 'daar');
      head.appendChild(el('b', 'oletter', aar.letter));
      head.appendChild(el('span', null, 'Mission grade ' + Math.round(aar.total) + '/100'));
      side.appendChild(head);
      const g = el('pre', 'dtable');
      const row = (a, v, w, pts) => a.padEnd(12) + String(v).padStart(7) + String(w).padStart(8) + String(pts).padStart(8);
      g.textContent = [row('', 'Score', 'Weight', 'Points'),
        ...aar.rows.map(([a, v, w]) => row(a, Math.round(v), w + '%', Math.round(v * w / 100))),
        '-'.repeat(35), row('Total', '', '', Math.round(aar.total))].join('\n');
      side.appendChild(g);
      side.appendChild(el('p', 'dsub', 'Plan grade ' + (Plan.score != null ? Plan.letter(Plan.score) + ' (' + Math.round(Plan.score) + ')' : 'none: the squad never stepped off') +
        '. Planning took ' + fmtClock(used) + ' of ' + fmtClock(Plan.timeAvail) + ' available (one third is ' + fmtClock(Plan.timeAvail / 3) + '). ' +
        done + ' of ' + Plan.lines.length + ' plan lines completed.'));
    }
    // Ammunition used by each side, against the basic load it started with.
    const ammo = (sq, who) => {
      const fired = sq.all.reduce((n, s) => n + s.shots, 0), left = sq.all.reduce((n, s) => n + s.ammoLeft, 0), start = sq.all.reduce((n, s) => n + (s.ammoStart || 0), 0);
      const pct = start ? Math.round(clamp(1 - left / start, 0, 1) * 100) : 0;
      return who + ' fired ' + fired.toLocaleString() + ' rounds, ' + pct + '% of its basic load (' + left.toLocaleString() + ' of ' + start.toLocaleString() + ' left)';
    };
    side.appendChild(el('p', 'dsub', 'Ammunition: ' + ammo(G.squads.blue, G.squads.blue.name) + '. ' + ammo(G.squads.red, 'The enemy') + '.'));
    // Hits scored by each side, and what they did to the other.
    const effect = (sq, foe, who) => {
      const fired = sq.all.reduce((n, s) => n + s.shots, 0), hits = sq.all.reduce((n, s) => n + s.hits, 0);
      const kia = foe.all.filter(s => s.health === 'kia').length, ser = foe.all.filter(s => s.health === 'serious').length, wia = foe.all.filter(s => s.health === 'light').length;
      return who + ' scored ' + hits + ' hit' + (hits === 1 ? '' : 's') + (fired ? ' (' + (hits / fired * 100).toFixed(1) + '% of rounds)' : '') +
        ': ' + kia + ' killed, ' + ser + ' seriously wounded, ' + wia + ' wounded';
    };
    side.appendChild(el('p', 'dsub', 'Hits and kills: ' + effect(G.squads.blue, G.squads.red, G.squads.blue.name) + '. ' + effect(G.squads.red, G.squads.blue, 'The enemy') + '.'));
    wrap.appendChild(side);
    box.appendChild(wrap);
    $('debrief').hidden = false;
  },
};

function togglePause() {
  if (!G.running) return;
  G.paused = !G.paused;
  UI.refreshBar();
}

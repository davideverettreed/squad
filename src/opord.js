'use strict';
// The operation order panel: Orientation, Situation, Mission, Execution (the planning
// board), Admin & Logistics, Command & Signal, and after step-off a phase tracker.

const OPORD_TABS = [
  ['O', 'Orientation', 'Orient'], ['S', 'Situation', 'Situation'], ['M', 'Mission', 'Mission'], ['E', 'Execution', 'Execution'],
  ['A', 'Admin & Logistics', 'Admin/Log'], ['C', 'Command & Signal', 'Cmd/Sig'], ['T', 'Tracker', 'Tracker'],
];

const OPORD = {
  tab: 'O', open: false, built: false,

  init() {
    const nav = $('opordTabs');
    for (const [k, name, short] of OPORD_TABS) {
      const b = el('button', 'otab', k);
      b.title = name; b.dataset.tab = k;
      b.appendChild(el('span', 'otabname', short));
      b.addEventListener('click', () => this.show(k));
      nav.appendChild(b);
    }
    $('btnStepOff').addEventListener('click', () => { Plan.stepOffNow(); this.show('T'); UI.refreshBar(); });
    $('btnOpordMin').addEventListener('click', () => this.hide());
    $('btnOrder').addEventListener('click', () => this.open ? this.hide() : this.show(this.tab));
    this.built = true;
  },

  show(tab) {
    this.tab = tab || this.tab;
    this.open = true;
    $('opord').hidden = false;
    document.body.classList.add('opord-open');
    this.refresh();
  },
  hide() {
    this.open = false;
    $('opord').hidden = true;
    document.body.classList.remove('opord-open');
    Plan.tool = null; Plan.plStart = null;
  },

  refresh() {
    if (!this.built || !G.squads.blue) return;
    document.querySelectorAll('.otab').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === this.tab);
      b.hidden = b.dataset.tab === 'T' && Plan.planning;
    });
    $('btnStepOff').hidden = !Plan.planning;
    if (!this.open) return;
    const body = $('opordBody');
    body.innerHTML = '';
    ({ O: this.orientation, S: this.situation, M: this.mission, E: this.execution, A: this.admin, C: this.command, T: this.tracker })[this.tab].call(this, body);
    this.refreshClock();
  },

  refreshClock() {
    const box = $('planClock');
    if (!Plan.timeAvail) { box.textContent = ''; return; }
    if (!Plan.planning) {
      box.innerHTML = '';
      box.appendChild(el('span', 'pcl', 'H+' + fmtClock(G.time - Plan.stepOff)));
      box.appendChild(el('span', 'pcs', 'Planning took ' + fmtClock(Plan.planUsed)));
      return;
    }
    const used = G.time - Plan.planStart, third = Plan.timeAvail / 3;
    box.innerHTML = '';
    box.appendChild(el('span', 'pcl', 'Planning ' + fmtClock(used)));
    box.appendChild(el('span', 'pcs', 'Your third: ' + fmtClock(third) + ' of ' + fmtClock(Plan.timeAvail) + ' available'));
    const bar = el('div', 'pbar'), fill = el('i'), tick = el('b');
    fill.style.width = clamp(used / Plan.timeAvail * 100, 0, 100) + '%';
    fill.dataset.state = used > third * 1.5 ? 'bad' : used > third ? 'warn' : 'ok';
    tick.style.left = '33.33%';
    bar.appendChild(fill); bar.appendChild(tick);
    box.appendChild(bar);
  },

  focus(x, y, zoom) {
    R.cam.x = x; R.cam.y = y; R.cam.zoom = Math.max(R.minZoom, zoom || 1.2); clampCam();
  },
  para(box, title, text) {
    if (title) box.appendChild(el('h4', null, title));
    if (text) box.appendChild(el('p', null, text));
  },
  factRow(box, label, text, at, zoom) {
    const row = el('div', 'ofact');
    row.appendChild(el('b', null, label));
    row.appendChild(el('span', null, text));
    if (at) {
      const go = el('button', 'obtn mini', 'Show');
      go.addEventListener('click', () => this.focus(at.x, at.y, zoom));
      row.appendChild(go);
    }
    box.appendChild(row);
  },

  // ------------------------------------------------------------ 1. Orientation
  orientation(box) {
    const f = Plan.terrainFacts(), m = G.map;
    this.para(box, 'Orientation', 'Study the ground before anything else. The sheet covers 3 × 3 km of farmland, woods and villages in 1 km grid squares. North is up. Contours are 5 m apart, with an index contour every 25 m.');
    this.factRow(box, 'You', 'Grid ' + gridRef(f.b.x, f.b.y) + ', elevation ' + Math.round(m.elevBase + m.elevAt(f.b.x, f.b.y)) + ' m.', f.b, 2.2);
    this.factRow(box, 'Enemy', 'Reported at grid ' + gridRef(f.e.x, f.e.y) + ': bearing ' + pad3(bearing(f.b.x, f.b.y, f.e.x, f.e.y)) + '°, ' + Math.round(f.d / 10) * 10 + ' m.', f.e, 1.6);
    this.factRow(box, 'Between', f.woodsPct + '% of the direct line is woods or orchard. ' + (f.streams ? f.streams + ' stream' + (f.streams > 1 ? 's' : '') + ' to cross. ' : 'No streams on the direct line. ') + (f.roads ? f.roads + ' road crossing' + (f.roads > 1 ? 's' : '') + '.' : ''), null);
    this.factRow(box, 'High ground', 'Highest point on the direct line: ' + Math.round(m.elevBase + f.hi.e) + ' m at grid ' + gridRef(f.hi.x, f.hi.y) + '. Ground that sees the objective is key terrain.', f.hi, 1.6);
    box.appendChild(el('h4', null, 'Key terrain'));
    const peaks = m.peaks.filter(p => dist(p.x, p.y, (f.b.x + f.e.x) / 2, (f.b.y + f.e.y) / 2) < 1400).slice(0, 3);
    for (const p of peaks) this.factRow(box, 'Hill ' + Math.round(m.elevBase + p.e), 'Grid ' + gridRef(p.x, p.y) + '.', p, 1.4);
    const places = m.places.filter(p => dist(p.x, p.y, (f.b.x + f.e.x) / 2, (f.b.y + f.e.y) / 2) < 1300).slice(0, 4);
    for (const p of places) this.factRow(box, p.name, (p.kind === 'village' ? 'Village' : 'Farm') + ', grid ' + gridRef(p.x, p.y) + '.', p, 1.6);
    const all = el('button', 'obtn', 'Show both positions');
    all.addEventListener('click', () => {
      const z = Math.min(R.w / (Math.abs(f.e.x - f.b.x) + 500), (R.h - 260) / (Math.abs(f.e.y - f.b.y) + 500));
      this.focus((f.b.x + f.e.x) / 2, (f.b.y + f.e.y) / 2, z);
    });
    box.appendChild(all);
  },

  // ------------------------------------------------------------ 2. Situation
  situation(box) {
    const i = Plan.intel;
    this.para(box, 'Enemy forces: SALUTE', null);
    for (const [k, v] of [['Size', i.size], ['Activity', i.activity], ['Location', i.location], ['Unit', i.unit], ['Time', i.time], ['Equipment', i.equipment]]) {
      this.factRow(box, k, v, k === 'Location' ? Plan.reported : null, 1.6);
    }
    this.para(box, 'Enemy capabilities: DRAW-D', null);
    for (const [k, v, likely] of Plan.drawD()) {
      const row = el('div', 'ofact' + (likely ? ' likely' : ''));
      row.appendChild(el('b', null, k));
      row.appendChild(el('span', null, v));
      box.appendChild(row);
    }
    this.para(box, 'Friendly forces', 'No higher or adjacent units are near you, and there is no indirect fire support. 1st Squad is on its own.');
    this.para(box, 'Time available', fmtClock(Plan.timeAvail) + ' (' + (G.mode === 'attack' ? 'the enemy will have finished digging in by then' : 'the enemy could reach you by then') +
      '). Use one third to plan; leave two thirds to the fire teams. The clock is running at ' + PLAN_RATE + '× while you plan.');
  },

  // ------------------------------------------------------------ 3. Mission
  mission(box) {
    this.para(box, 'Mission', null);
    box.appendChild(el('blockquote', 'omission', Plan.missionText()));
    this.para(box, null, 'Who, what, when, where and why, in one sentence. Everything in the plan serves it.');
  },

  // ------------------------------------------------------------ 4. Execution
  execution(box) {
    this.para(box, 'Execution', 'Draw control measures on the map, then write the scheme of maneuver line by line. After you step off, each line starts on its trigger. You can still give any unit direct orders; that takes it off its current line.');
    // Tools
    const tools = el('div', 'otools');
    for (const [k, K] of Object.entries(GRAPHIC_KINDS)) {
      const b = el('button', 'obtn' + (Plan.tool === k ? ' on' : ''), K.short);
      b.title = 'Place a ' + K.label.toLowerCase();
      b.addEventListener('click', () => {
        Plan.tool = Plan.tool === k ? null : k; Plan.plStart = null;
        if (Plan.tool) G.toast(K.line ? 'Tap one end of the phase line on the map.' : 'Tap the map to place the ' + K.label.toLowerCase() + '.');
        this.refresh();
      });
      tools.appendChild(b);
    }
    box.appendChild(tools);
    const acts = el('div', 'otools');
    const draft = el('button', 'obtn', 'Draft a plan');
    draft.title = 'Replace the plan with a hasty attack drawn from the map';
    draft.addEventListener('click', () => { Plan.draft(); G.toast('Draft plan drawn. Check it against the ground and change what you like.'); });
    acts.appendChild(draft);
    const clear = el('button', 'obtn', 'Clear all');
    clear.addEventListener('click', () => { Plan.graphics = []; Plan.lines = []; Plan.selected = null; this.refresh(); });
    if (Plan.planning) acts.appendChild(clear);
    box.appendChild(acts);

    // The selected control measure: rename or delete.
    const g = Plan.graphic(Plan.selected);
    if (g) {
      const row = el('div', 'osel');
      row.appendChild(el('span', null, GRAPHIC_KINDS[g.kind].label + ':'));
      const name = el('input'); name.type = 'text'; name.value = g.name; name.id = 'gname-' + g.id; name.maxLength = 18;
      name.addEventListener('change', () => { g.name = name.value.trim().toUpperCase() || g.name; this.refresh(); });
      row.appendChild(name);
      const del = el('button', 'obtn mini', 'Delete');
      del.addEventListener('click', () => { Plan.removeGraphic(g.id); this.refresh(); });
      row.appendChild(del);
      box.appendChild(row);
    } else {
      box.appendChild(el('p', 'onote', 'Drag a control measure to move it; tap it to rename or delete it.'));
    }

    // Lines
    box.appendChild(el('h4', null, 'Scheme of maneuver'));
    const pointGraphics = Plan.graphics.filter(x => x.kind !== 'pl');
    const sel = (opts, value, onChange, id) => {
      const s = el('select'); if (id) s.id = id;
      for (const [v, t] of opts) { const o = el('option', null, t); o.value = v; if (String(v) === String(value)) o.selected = true; s.appendChild(o); }
      s.addEventListener('change', () => { onChange(s.value); this.refresh(); });
      return s;
    };
    Plan.lines.forEach((l, i) => {
      const card = el('div', 'oline' + (l.status !== 'pending' ? ' ' + l.status : ''));
      const head = el('div', 'olhead');
      head.appendChild(el('b', null, 'Line ' + (i + 1)));
      if (l.status !== 'pending') head.appendChild(el('span', 'ostatus', l.status));
      const tb = el('span', 'olbtns');
      for (const [t, fn] of [['↑', () => Plan.moveLine(l.id, -1)], ['↓', () => Plan.moveLine(l.id, 1)], ['✕', () => Plan.removeLine(l.id)]]) {
        const b = el('button', 'obtn mini', t); b.addEventListener('click', () => { fn(); this.refresh(); }); tb.appendChild(b);
      }
      head.appendChild(tb);
      card.appendChild(head);
      const row = el('div', 'olrow');
      row.appendChild(sel(Object.entries(TRIGGERS), l.trigger, v => { l.trigger = v; }, 'ltrig-' + l.id));
      if (l.trigger === 'signal') row.appendChild(sel(Object.entries(SIGNALS).map(([k, s]) => [k, s.label]), l.signal, v => { l.signal = v; }, 'lsig-' + l.id));
      if (l.trigger === 'time') {
        const m = el('input'); m.type = 'number'; m.min = 0; m.max = 120; m.value = l.minutes; m.id = 'lmin-' + l.id;
        m.addEventListener('change', () => { l.minutes = clamp(parseInt(m.value, 10) || 0, 0, 120); this.refresh(); });
        row.appendChild(m);
      }
      card.appendChild(row);
      const row2 = el('div', 'olrow');
      const T = TASKS[l.task];
      if (!T.noUnit) row2.appendChild(sel(Object.entries(PLAN_UNITS), l.unit, v => { l.unit = v; }, 'lunit-' + l.id));
      row2.appendChild(sel(Object.entries(TASKS).map(([k, t]) => [k, t.label]), l.task, v => { l.task = v; }, 'ltask-' + l.id));
      if (T.where) row2.appendChild(sel([['', 'where…'], ...pointGraphics.map(x => [x.id, x.name])], l.where || '', v => { l.where = v ? Number(v) : null; }, 'lwhere-' + l.id));
      if (T.target) row2.appendChild(sel([['', 'target…'], ...pointGraphics.map(x => [x.id, x.name])], l.target || '', v => { l.target = v ? Number(v) : null; }, 'ltgt-' + l.id));
      if (T.signal) row2.appendChild(sel(Object.entries(SIGNALS).map(([k, s]) => [k, s.label]), l.signal, v => { l.signal = v; }, 'lsigt-' + l.id));
      if (l.task === 'move' || l.task === 'sbf') row2.appendChild(sel(Object.entries(MOVE).map(([k, m]) => [k, m.label]), l.mode, v => { l.mode = v; }, 'lmode-' + l.id));
      card.appendChild(row2);
      const bad = Plan.problems(l);
      card.appendChild(el('p', 'oltext' + (bad ? ' bad' : ''), bad || Plan.lineText(l)));
      box.appendChild(card);
    });
    const add = el('button', 'obtn', 'Add line');
    add.addEventListener('click', () => { Plan.addLine(); this.refresh(); });
    box.appendChild(add);

    // Concept of operations, written out.
    if (Plan.lines.length) {
      box.appendChild(el('h4', null, 'Concept of operations'));
      const ol = el('ol', 'oconcept');
      Plan.lines.forEach(l => ol.appendChild(el('li', null, Plan.triggerText(l) + ': ' + Plan.lineText(l))));
      box.appendChild(ol);
    }
  },

  // ------------------------------------------------------------ 5. Admin & Logistics
  admin(box) {
    this.para(box, 'Administration and logistics', 'No resupply. Every Marine carries the basic load below. Casualties go to the casualty collection point (CCP); place one in Execution. Redistribute ammunition at the CCP if the fight runs long.');
    if (Plan.planning) UI.renderLoadout(box, () => applyLoadout(G.squads.blue, G.settings.loadout));
    else box.appendChild(el('p', 'onote', 'The loadout was fixed at step-off.'));
    const ccp = Plan.graphics.find(g => g.kind === 'ccp');
    this.factRow(box, 'CCP', ccp ? ccp.name + ' at grid ' + gridRef(ccp.pts[0].x, ccp.pts[0].y) + '.' : 'Not yet placed.', ccp ? ccp.pts[0] : null, 2);
  },

  // ------------------------------------------------------------ 6. Command & Signal
  command(box) {
    this.para(box, 'Signal', 'Visual signals, fired by the squad leader. Fire them from the Tracker after step-off, or write a "Fire signal" line into the plan.');
    for (const [k, s] of Object.entries(SIGNALS)) {
      const row = el('div', 'ofact');
      const dot = el('i', 'sigdot'); dot.style.background = s.color;
      row.appendChild(dot);
      row.appendChild(el('b', null, s.label));
      row.appendChild(el('span', null, s.meaning + '.'));
      box.appendChild(row);
    }
    this.para(box, 'Command', 'The squad leader moves with the squad and controls the fight. Succession of command: squad leader, then 1st, 2nd and 3rd fire team leaders. Within a fire team: team leader, then the automatic rifleman.');
  },

  // ------------------------------------------------------------ Tracker
  tracker(box) {
    const sig = el('div', 'otools');
    for (const [k, s] of Object.entries(SIGNALS)) {
      const b = el('button', 'obtn sig', s.label.replace(' star cluster', ''));
      b.style.setProperty('--sig', s.color);
      b.title = s.label + ': ' + s.meaning;
      if (Plan.signals[k]) b.classList.add('fired');
      b.addEventListener('click', () => { Plan.fireSignal(k); this.refresh(); });
      sig.appendChild(b);
    }
    box.appendChild(el('h4', null, 'Signals'));
    box.appendChild(sig);
    box.appendChild(el('h4', null, 'Phases'));
    if (!Plan.lines.length) box.appendChild(el('p', 'onote', 'No plan lines. You are fighting by direct orders.'));
    const list = el('div', 'otrack');
    Plan.lines.forEach((l, i) => {
      const row = el('div', 'otline ' + l.status);
      row.appendChild(el('span', 'otmark', { pending: '○', active: '▶', done: '✓', failed: '✕', overridden: '↷', stalled: '‖' }[l.status]));
      row.appendChild(el('span', 'ottext', (i + 1) + '. ' + Plan.triggerText(l) + ': ' + Plan.lineText(l)));
      if (l.status === 'pending' || l.status === 'stalled') {
        const go = el('button', 'obtn mini', l.status === 'stalled' ? 'Resume' : 'Now');
        go.title = l.status === 'stalled' ? 'Carry on with this line' : 'Start this line now';
        go.addEventListener('click', () => Plan.executeNow(l.id));
        row.appendChild(go);
      }
      list.appendChild(row);
    });
    box.appendChild(list);
    this._trackerList = list;
  },

  refreshTracker() {
    if (this.open && this.tab === 'T') this.refresh();
  },
};

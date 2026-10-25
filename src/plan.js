'use strict';
// The plan: control measures drawn on the map, the phased scheme of maneuver, and the
// executor that carries the phases out after the squad steps off. Also writes the
// generated parts of the order: orientation facts, SALUTE, DRAW-D and the mission.

const GRAPHIC_KINDS = {
  cp:   { label: 'Checkpoint', short: 'CP', numbered: true },
  obj:  { label: 'Objective', short: 'OBJ', names: ['IRON', 'HAMMER', 'ANVIL', 'SPEAR', 'FLINT', 'SABER'], r: 45 },
  sbf:  { label: 'Support by fire position', short: 'SBF', numbered: true },
  aslt: { label: 'Assault position', short: 'ASLT POS', numbered: true, r: 25 },
  pl:   { label: 'Phase line', short: 'PL', names: ['RED', 'BLUE', 'GOLD', 'GREEN', 'BLACK'], line: true },
  ccp:  { label: 'Casualty collection point', short: 'CCP', numbered: true },
  rte:  { label: 'Route', short: 'RTE', names: ['GOLD', 'SILVER', 'COPPER', 'BRASS', 'STEEL'], line: true, multi: true },
  fp:   { label: 'Fighting position', short: 'FP', numbered: true },
  loa:  { label: 'Limit of advance', short: 'LOA', single: true, line: true },
  rly:  { label: 'Rally point', short: 'RLY PT', numbered: true },
  rel:  { label: 'Release point', short: 'RP', numbered: true },
  trp:  { label: 'Target reference point', short: 'TRP', numbered: true },
};
// Control measures grouped as the graphics manuals group them: points, lines and areas.
const GRAPHIC_GROUPS = [
  ['Points', ['cp', 'rel', 'rly', 'ccp', 'trp', 'fp', 'sbf']],
  ['Lines', ['pl', 'loa', 'rte']],
  ['Areas', ['obj', 'aslt']],
];
const TASKS = {
  move:     { label: 'Move to', where: true },
  route:    { label: 'Move along route', where: true, whereKinds: ['rte'] },
  occupy:   { label: 'Occupy fighting position', where: true, whereKinds: ['fp'] },
  bound:    { label: 'Bound to', where: true },
  sbf:      { label: 'Support by fire from', where: true, target: true },
  suppress: { label: 'Suppress', target: true },
  assault:  { label: 'Assault', target: true },
  lift:     { label: 'Lift fire and hold' },
  hold:     { label: 'Halt and hold' },
  signal:   { label: 'Fire signal', signal: true, noUnit: true },
};
const TRIGGERS = {
  start: 'At step-off', after: 'After the line above', with: 'With the line above',
  signal: 'On signal', time: 'At H+ minutes', contact: 'On enemy contact',
};
const SIGNALS = {
  red:   { label: 'Red star cluster',   meaning: 'Commence the assault',          color: '#e53935' },
  green: { label: 'Green star cluster', meaning: 'Shift or lift supporting fire', color: '#43a047' },
  white: { label: 'White star cluster', meaning: 'Withdraw to the CCP and rally', color: '#eeeeee' },
};
const PLAN_UNITS = { squad: 'Squad', t1: '1st FT', t2: '2nd FT', t3: '3rd FT' };
const PLAN_RATE = 4; // game seconds per real second while planning

const Plan = {
  graphics: [], lines: [], nextId: 1,
  phase: 'planning', stepOff: null, planStart: 0, planUsed: 0, timeAvail: 0,
  signals: {}, contact: false, tool: null, plStart: null, selected: null, drag: null,
  reported: null, crossings: new Map(), timer: 0,

  reset() {
    this.graphics = []; this.lines = []; this.nextId = 1;
    this.phase = 'planning'; this.stepOff = null; this.planStart = G.time; this.planUsed = 0;
    this.signals = {}; this.contact = false; this.tool = null; this.plStart = null; this.selected = null; this.drag = null;
    this.crossings = new Map(); this.timer = 0;
    this.conf = 1; this.score = null; this.routeDraft = null; this.loaSide = null;
    // The report is a little off, as reports are.
    this.reported = { x: clamp(G.enemyArea.x + gauss() * 50, 30, MAP_W - 30), y: clamp(G.enemyArea.y + gauss() * 50, 30, MAP_H - 30) };
    const sep = dist(centroid(G.squads.blue.all).x, centroid(G.squads.blue.all).y, this.reported.x, this.reported.y);
    // Time available: in a meeting engagement, until the enemy could reach you; in an
    // attack, until the enemy finishes digging in.
    this.timeAvail = G.mode === 'meeting' ? Math.round(sep / 1.25 / 60) * 60 : G.echelon.attackTime * 60;
    this.intel = this.makeIntel();
    this.terrain = this.keyTerrain();
    this.ao = this.aoFacts();
    this.showTerrain = true;
  },

  // Facts about the area of operations for the orientation: extent, relief, obstacles and
  // restrictive terrain (ponds, streams, woods, steep ground, villages), avenues of approach.
  aoFacts() {
    const m = G.map, N = GW * GH;
    let lo = Infinity, hi = -Infinity, woods = 0, steep = 0, worst = { s: 0 }, swamp = 0, sx0 = 0, sy0 = 0;
    const count = new Float64Array(32);
    for (let cy = 1; cy < GH - 1; cy++) for (let cx = 1; cx < GW - 1; cx++) {
      const i = cy * GW + cx, e = m.elev[i];
      const k = m.ter[i];
      count[k]++;
      if (k === TER.OCEAN) continue;
      if (e < lo) lo = e; if (e > hi) hi = e;
      if (k === TER.WOODS || k === TER.ORCHARD) woods++;
      if (k === TER.SWAMP) { swamp++; sx0 += cx; sy0 += cy; }
      const s = Math.hypot(m.elev[i + 1] - m.elev[i - 1], m.elev[i + GW] - m.elev[i - GW]) / (2 * CELL);
      if (s > 0.3) { steep++; if (s > worst.s) worst = { s, x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL }; }
    }
    // Ponds: connected water, largest first.
    const seen = new Uint8Array(N), ponds = [];
    for (let i = 0; i < N; i++) {
      if (seen[i] || m.ter[i] !== TER.POND) continue;
      let n = 0, sx = 0, sy = 0;
      const q = [i]; seen[i] = 1;
      while (q.length) {
        const c = q.pop(), x = c % GW, y = Math.floor(c / GW);
        n++; sx += x; sy += y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, j = ny * GW + nx;
          if (m.inGrid(nx, ny) && !seen[j] && m.ter[j] === TER.POND) { seen[j] = 1; q.push(j); }
        }
      }
      ponds.push({ ha: n * CELL * CELL / 10000, x: (sx / n + 0.5) * CELL, y: (sy / n + 0.5) * CELL });
    }
    ponds.sort((a, b) => b.ha - a.ha);
    const paved = m.roads.find(r => r.kind === 'paved');
    let road = null;
    if (paved) {
      const a = paved.pts[0], b = paved.pts[paved.pts.length - 1], brg = bearing(a.x, a.y, b.x, b.y);
      const ends = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
      const from = ends[Math.round(((brg + 180) % 360) / 45) % 8], to = ends[Math.round(brg / 45) % 8];
      const via = m.places.filter(p => p.kind === 'village' && paved.pts.some(q => dist(q.x, q.y, p.x, p.y) < 200)).map(p => p.name.toUpperCase());
      road = { text: 'Runs ' + from + ' to ' + to + ' across the AO' + (via.length ? ', through ' + via.join(' and ') : '') + '.', at: paved.pts[Math.floor(paved.pts.length / 2)] };
    }
    return {
      e0: G.grid.e, n0: G.grid.n, lo: Math.round(m.elevBase + lo), hi: Math.round(m.elevBase + hi),
      woodsPct: Math.round(woods / N * 100), river: m.river, pct: (k) => count[k] / N * 100,
      swampPct: swamp / N * 100, swampAt: swamp ? { x: (sx0 / swamp + 0.5) * CELL, y: (sy0 / swamp + 0.5) * CELL } : null, steepPct: steep / N * 100, worst, ponds,
      streams: m.streams.length, road, tracks: m.roads.filter(r => r.kind === 'track').length,
      villages: m.places.filter(p => p.kind === 'village'), farms: m.places.filter(p => p.kind === 'farm').length,
    };
  },

  // Marks for the orientation: our assembly area, the reported enemy, and key terrain
  // (hills and settlements near the axis, and the high ground on the direct line).
  keyTerrain() {
    const f = this.terrainFacts(), m = G.map, mid = { x: (f.b.x + f.e.x) / 2, y: (f.b.y + f.e.y) / 2 };
    const reach = f.d / 2 + 700;
    const out = [{ kind: 'aa', name: 'AA', x: f.b.x, y: f.b.y }, { kind: 'eny', name: 'ENY (REPORTED)', x: f.e.x, y: f.e.y }];
    for (const p of m.peaks.filter(p => dist(p.x, p.y, mid.x, mid.y) < reach).slice(0, 3)) {
      out.push({ kind: 'hill', name: 'HILL ' + Math.round(m.elevBase + p.e), x: p.x, y: p.y, note: 'Hilltop' });
    }
    if (!out.some(k => k.kind === 'hill' && dist(k.x, k.y, f.hi.x, f.hi.y) < 250)) {
      out.push({ kind: 'hill', name: 'HIGH GROUND ' + Math.round(m.elevBase + f.hi.e), x: f.hi.x, y: f.hi.y, note: 'Highest point on the direct line' });
    }
    for (const p of m.places.filter(p => dist(p.x, p.y, mid.x, mid.y) < reach).slice(0, 4)) {
      out.push({ kind: 'town', name: p.name.toUpperCase(), x: p.x, y: p.y, note: p.kind === 'village' ? 'Village' : G.map.R.farmWord });
    }
    return out;
  },

  get planning() { return this.phase === 'planning'; },
  // Header clock while planning: time left in the leader's third, then time over it.
  countdown() {
    const left = this.timeAvail / 3 - (G.time - this.planStart);
    return left >= 0 ? 'PLAN −' + fmtClock(left) : 'OVER +' + fmtClock(-left);
  },
  graphic(id) { return this.graphics.find(g => g.id === id) || null; },
  gname(g) { return g ? g.name : '—'; },

  // ---------------------------------------------------------------- control measures
  nextName(kind) {
    const K = GRAPHIC_KINDS[kind], used = this.graphics.filter(g => g.kind === kind).map(g => g.name);
    if (K.single && !used.includes(K.short)) return K.short;
    if (K.names) return (K.short + ' ' + (K.names.find(n => !used.includes(K.short + ' ' + n)) || K.names[0]));
    for (let n = 1; ; n++) if (!used.includes(K.short + ' ' + n)) return K.short + ' ' + n;
  },
  addGraphic(kind, pts) {
    const g = { id: this.nextId++, kind, name: this.nextName(kind), pts: pts.map(p => ({ x: p.x, y: p.y })), r: GRAPHIC_KINDS[kind].r || 0 };
    // A fighting position faces the reported enemy, with a 90 degree sector, until changed.
    if (kind === 'fp') { g.dir = angleTo(pts[0].x, pts[0].y, this.reported.x, this.reported.y); g.width = Math.PI / 2; }
    this.graphics.push(g);
    return g;
  },
  removeGraphic(id) {
    this.graphics = this.graphics.filter(g => g.id !== id);
    for (const l of this.lines) { if (l.where === id) l.where = null; if (l.target === id) l.target = null; }
    if (this.selected === id) this.selected = null;
  },
  // Tap on the map with a tool chosen: place it. Lines take two taps; a route takes a tap
  // for each waypoint and ends with Finish route (or a tap on its last point).
  place(w) {
    const kind = this.tool, K = GRAPHIC_KINDS[kind];
    if (!kind) return false;
    if (K.multi) {
      this.routeDraft = this.routeDraft || [];
      const last = this.routeDraft[this.routeDraft.length - 1];
      if (last && this.routeDraft.length > 1 && dist(last.x, last.y, w.x, w.y) < 18 / R.cam.zoom) return this.finishRoute();
      this.routeDraft.push({ x: w.x, y: w.y });
      G.toast('Waypoint ' + this.routeDraft.length + '. Tap the next one, or Finish route.');
      OPORD.refresh();
      return true;
    }
    if (K.line) {
      if (!this.plStart) { this.plStart = { x: w.x, y: w.y }; G.toast('Tap the other end of the ' + K.label.toLowerCase() + '.'); return true; }
      const g = this.addGraphic(kind, [this.plStart, w]);
      this.plStart = null; this.selected = g.id;
      if (K.single) this.tool = null;
    } else {
      // The tool stays on, so each tap places another; tap its button again (or Esc) to stop.
      const g = this.addGraphic(kind, [w]);
      this.selected = g.id;
      G.toast(g.name + ' placed. Tap again for another, or tap ' + K.short + ' to stop.');
    }
    OPORD.refresh();
    return true;
  },
  finishRoute() {
    const pts = this.routeDraft || [];
    if (pts.length >= 2) {
      const g = this.addGraphic('rte', pts); this.selected = g.id;
      // A route begun from the map menu also becomes a line of the plan for that unit.
      if (this.routeUnit) {
        this.addLine({ unit: this.routeUnit, task: 'route', where: g.id, mode: G.ui.moveMode || 'walk' });
        G.toast(PLAN_UNITS[this.routeUnit] + ' moves along ' + g.name + '. Added to the plan.');
      }
    }
    else G.toast('A route needs at least two waypoints.');
    this.routeDraft = null; this.tool = null; this.routeUnit = null;
    OPORD.refresh();
    return true;
  },
  // The plan unit for a selection: a Marine plans with his fire team, the SL with the squad.
  planUnit(sel) {
    if (!sel) return null;
    const t = sel.level === 'squad' ? null : sel.team;
    return t && t.num ? 't' + t.num : 'squad';
  },
  // A step chosen from the map menu while planning: a control measure at the spot and a
  // line of the plan that sends the unit to it.
  addStep(sel, w, step) {
    const unit = this.planUnit(sel), mode = G.ui.moveMode || 'walk';
    if (!unit) return;
    let g = null, l = null;
    switch (step) {
      case 'cp': g = this.addGraphic('cp', [w]); l = this.addLine({ unit, task: 'move', where: g.id, mode }); break;
      case 'bound': g = this.addGraphic('cp', [w]); l = this.addLine({ unit, task: 'bound', where: g.id }); break;
      case 'fp': g = this.addGraphic('fp', [w]); l = this.addLine({ unit, task: 'occupy', where: g.id }); break;
      case 'sbf': {
        g = this.addGraphic('sbf', [w]);
        const obj = this.graphics.find(o => o.kind === 'obj');
        l = this.addLine({ unit, task: 'sbf', where: g.id, target: obj ? obj.id : null, mode });
        break;
      }
      case 'obj': g = this.addGraphic('obj', [w]); l = this.addLine({ unit, task: 'assault', target: g.id }); break;
      case 'trp': g = this.addGraphic('trp', [w]); l = this.addLine({ unit, task: 'suppress', target: g.id }); break;
      case 'aslt': g = this.addGraphic('aslt', [w]); l = this.addLine({ unit, task: 'move', where: g.id, mode }); break;
      case 'rte':
        this.tool = 'rte'; this.routeUnit = unit; this.routeDraft = [{ x: w.x, y: w.y }];
        G.toast('Route for ' + PLAN_UNITS[unit] + ': tap each waypoint, then Finish route.');
        OPORD.refresh();
        return;
    }
    if (g) this.selected = g.id;
    if (l) G.toast('Line ' + this.lines.length + ': ' + this.lineText(l));
    OPORD.refresh();
  },
  anchor(g) {
    if (g.kind === 'rte') return g.pts[g.pts.length - 1];
    if (g.kind === 'pl' || g.kind === 'loa') return { x: (g.pts[0].x + g.pts[g.pts.length - 1].x) / 2, y: (g.pts[0].y + g.pts[g.pts.length - 1].y) / 2 };
    return g.pts[0];
  },
  hitGraphic(sx, sy) {
    let best = null, bd = 22;
    for (const g of this.graphics) {
      if (GRAPHIC_KINDS[g.kind].line) {
        for (let i = 0; i < g.pts.length; i++) {
          const p = toScreen(g.pts[i].x, g.pts[i].y), d = Math.hypot(p.x - sx, p.y - sy);
          if (d < bd) { bd = d; best = { g, idx: i }; }
        }
        continue;
      }
      const p = toScreen(g.pts[0].x, g.pts[0].y), d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = { g, idx: 0 }; }
    }
    return best;
  },

  // ---------------------------------------------------------------- phase lines
  addLine(o) {
    const l = Object.assign({ id: this.nextId++, trigger: this.lines.length ? 'after' : 'start', signal: 'red', minutes: 5,
      unit: 'squad', task: 'move', where: null, target: null, mode: 'walk', status: 'pending' }, o || {});
    this.lines.push(l);
    return l;
  },
  removeLine(id) { this.lines = this.lines.filter(l => l.id !== id); },
  moveLine(id, d) {
    const i = this.lines.findIndex(l => l.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= this.lines.length) return;
    [this.lines[i], this.lines[j]] = [this.lines[j], this.lines[i]];
  },

  triggerText(l) {
    if (l.trigger === 'signal') return 'On ' + SIGNALS[l.signal].label.toLowerCase();
    if (l.trigger === 'time') return 'At H+' + l.minutes;
    return TRIGGERS[l.trigger];
  },
  lineText(l) {
    const T = TASKS[l.task], who = T.noUnit ? 'Squad leader' : PLAN_UNITS[l.unit];
    const where = this.gname(this.graphic(l.where)), tgt = this.gname(this.graphic(l.target));
    let what;
    switch (l.task) {
      case 'move': what = 'moves to ' + where + ' (' + MOVE[l.mode].label.toLowerCase() + ')'; break;
      case 'route': what = 'moves along ' + where + ' to its end (' + MOVE[l.mode].label.toLowerCase() + ')'; break;
      case 'occupy': { const g = this.graphic(l.where); what = 'occupies ' + where + (g ? ', sector of fire ' + pad3(Math.round(((g.dir * 180 / Math.PI) + 90 + 360) % 360)) + '°' : ''); break; }
      case 'bound': what = 'bounds by overwatch to ' + where; break;
      case 'sbf': what = 'occupies ' + where + ' and supports by fire onto ' + tgt; break;
      case 'suppress': what = 'suppresses ' + tgt; break;
      case 'assault': what = 'assaults through ' + tgt; break;
      case 'lift': what = 'lifts fire and holds'; break;
      case 'hold': what = 'halts and holds'; break;
      case 'signal': what = 'fires a ' + SIGNALS[l.signal].label.toLowerCase() + ' (' + SIGNALS[l.signal].meaning.toLowerCase() + ')'; break;
    }
    return who + ' ' + what + '.';
  },
  problems(l) {
    const T = TASKS[l.task];
    if (T.where && !this.graphic(l.where)) return 'Choose where.';
    if (T.whereKinds && !T.whereKinds.includes(this.graphic(l.where).kind)) return 'Choose a ' + GRAPHIC_KINDS[T.whereKinds[0]].label.toLowerCase() + '.';
    if (T.target && !this.graphic(l.target)) return 'Choose a target.';
    return '';
  },

  // ---------------------------------------------------------------- execution
  stepOffNow() {
    if (!this.planning) return;
    this.planUsed = G.time - this.planStart;
    this.phase = 'execution';
    this.stepOff = G.time;
    this.tool = null; this.plStart = null;
    // The plan is graded, and the grade becomes the squad's confidence: how steady the men
    // are under fire, how fast they break, how quickly they act on radio orders.
    this.score = this.gradeScore();
    this.conf = this.score / 100;
    const sq = G.squads.blue;
    sq.morale = 60 + 32 * this.conf;
    for (const t of [sq.hq, ...sq.teams]) t.morale = sq.morale;
    sq.training = 0.85 * (1.15 - 0.3 * this.conf);
    G.log('Plan grade ' + this.letter(this.score) + ' (' + Math.round(this.score) + '). Squad confidence: ' + this.confName() + '.', this.score >= 65 ? 'plan' : 'warn');
    if (!this.lines.length) G.log('Stepped off without a plan. The fire teams are unsure what is wanted of them.', 'warn');
    G.log('Squad stepping off. H-hour.', 'plan');
    OPORD.refresh();
    this.timer = 0;
    this.update(0, true);
  },

  // ---------------------------------------------------------------- plan grade
  gradeItems() {
    const kinds = new Set(this.graphics.map(g => g.kind));
    const tasked = ['t1', 't2', 't3'].filter(u => this.lines.some(l => l.unit === u || (l.unit === 'squad' && !TASKS[l.task].noUnit)));
    const used = this.planning ? G.time - this.planStart : this.planUsed, third = this.timeAvail / 3;
    return [
      ['Objective on the map', kinds.has('obj') ? 1 : 0, 15],
      ['Every fire team has a task', tasked.length / 3, 20],
      ['Base of fire designated', this.lines.some(l => l.task === 'sbf' || l.task === 'suppress' || l.task === 'occupy') ? 1 : 0, 15],
      ['Control measures (CP, route, PL, LOA, RP)', ['cp', 'rte', 'pl', 'loa', 'rel'].some(k => kinds.has(k)) ? 1 : 0, 10],
      ['Signals planned', this.lines.some(l => l.trigger === 'signal' || l.task === 'signal') ? 1 : 0, 10],
      ['CCP placed', kinds.has('ccp') ? 1 : 0, 10],
      ['Planned within your third', used <= third ? 1 : used <= third * 1.5 ? 0.5 : 0, 20],
    ];
  },
  gradeScore() { return this.gradeItems().reduce((n, [, v, w]) => n + v * w, 0); },
  letter(s) { return s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 40 ? 'D' : 'F'; },
  confName() { const c = this.conf; return c >= 0.85 ? 'high' : c >= 0.65 ? 'steady' : c >= 0.4 ? 'uncertain' : 'shaken'; },

  // After-action grade: the plan, the result, the cost and the time, weighted.
  afterAction(result) {
    const blue = G.squads.blue.all;
    const kia = blue.filter(s => s.health === 'kia').length, ser = blue.filter(s => s.health === 'serious').length, wia = blue.filter(s => s.health === 'light').length;
    const plan = this.score != null ? this.score : 0;
    const res = result === 'victory' ? 100 : 0;
    const cas = Math.max(0, 100 - 15 * kia - 8 * ser - 3 * wia);
    const t = this.stepOff != null ? G.time - this.stepOff : G.time;
    const time = result !== 'victory' ? 0 : t <= this.timeAvail ? 100 : clamp(100 - (t - this.timeAvail) / this.timeAvail * 100, 0, 100);
    const rows = [['Plan', plan, 25], ['Result', res, 35], ['Casualties', cas, 25], ['Time', time, 15]];
    const total = rows.reduce((n, [, v, w]) => n + v * w / 100, 0);
    return { rows, total, letter: this.letter(total), kia, ser, wia, t };
  },

  unitSel(u) {
    const sq = G.squads.blue;
    if (u === 'squad') return { level: 'squad', squad: sq };
    const t = sq.teams[Number(u[1]) - 1];
    return { level: 'team', team: t, squad: sq };
  },
  liveMembers(u) { return selMembers(this.unitSel(u)).filter(commandable); },

  triggerMet(l, i) {
    const prev = this.lines[i - 1];
    switch (l.trigger) {
      case 'start': return true;
      case 'after': return !prev || !['pending', 'active', 'stalled'].includes(prev.status);
      case 'with': return !prev || prev.status !== 'pending';
      case 'signal': return !!this.signals[l.signal];
      case 'time': return G.time - this.stepOff >= l.minutes * 60;
      case 'contact': return this.contact;
    }
    return false;
  },

  update(dt, force) {
    if (this.planning || !G.squads.blue) return;
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.5;
    if (!this.contact) {
      this.contact = [...G.known.blue.values()].some(k => k.visible) ||
        [G.squads.blue.hq, ...G.squads.blue.teams].some(t => G.time - t.lastFiredUpon < 2);
      if (this.contact) G.log('Contact. Plan lines waiting on contact are released.', 'plan');
    }
    this.lines.forEach((l, i) => {
      if (l.status === 'pending' && this.triggerMet(l, i)) this.start(l);
      else if (l.status === 'active') this.check(l);
    });
    this.checkPhaseLines();
    this.checkLOA();
    OPORD.refreshTracker();
  },

  // Nobody crosses the limit of advance: a man who reaches it halts there.
  checkLOA() {
    const loas = this.graphics.filter(g => g.kind === 'loa');
    if (!loas.length) return;
    this.loaSide = this.loaSide || new Map();
    for (const s of G.squads.blue.all) {
      if (!s.active) continue;
      for (const g of loas) {
        const a = g.pts[0], b = g.pts[1], key = s.id + ':' + g.id;
        const side = Math.sign((b.x - a.x) * (s.y - a.y) - (b.y - a.y) * (s.x - a.x));
        const len = dist(a.x, a.y, b.x, b.y), proj = ((s.x - a.x) * (b.x - a.x) + (s.y - a.y) * (b.y - a.y)) / (len * len);
        if (!this.loaSide.has(key)) { this.loaSide.set(key, side); continue; }
        if (side && side !== this.loaSide.get(key) && proj > -0.1 && proj < 1.1 && s.moving) {
          s.path = []; s.assault = false;
          releaseControllers([s]);
          this.loaSide.set(key, side); // an order to go on past it is obeyed
          if (!s.team.atLOA) { s.team.atLOA = true; G.log(s.team.short + ': At the ' + g.name + ', halting.', 'plan'); }
        }
      }
    }
  },

  start(l) {
    const n = this.lines.indexOf(l) + 1;
    const bad = this.problems(l);
    if (bad) { l.status = 'failed'; G.log('Line ' + n + ' cannot start: ' + bad, 'warn'); return; }
    if (l.task === 'signal') {
      l.status = 'done';
      this.fireSignal(l.signal);
      return;
    }
    const sel = this.unitSel(l.unit), m = this.liveMembers(l.unit);
    if (!m.length) { l.status = 'failed'; G.log('Line ' + n + ': ' + PLAN_UNITS[l.unit] + ' cannot carry it out.', 'warn'); return; }
    const where = this.graphic(l.where), tgt = this.graphic(l.target);
    l.status = 'active'; l.startedAt = G.time; l.stage = null;
    G.execIssuing = true;
    try {
      switch (l.task) {
        case 'move': groupMove(sel, this.anchor(where).x, this.anchor(where).y, l.mode); break;
        case 'route': routeMove(sel, where.pts, l.mode); break;
        case 'occupy': occupyPosition(sel, where); l.stage = 'moving'; break;
        case 'bound': issueOrder(sel, 'bound', this.anchor(where)); break;
        case 'assault': issueOrder(sel, 'assault', this.anchor(tgt)); break;
        case 'sbf': groupMove(sel, this.anchor(where).x, this.anchor(where).y, l.mode); l.stage = 'moving'; break;
        case 'suppress': issueOrder(sel, 'suppress', this.anchor(tgt)); l.status = 'done'; break;
        case 'lift': issueOrder(sel, 'lift'); issueOrder(sel, 'halt'); l.status = 'done'; break;
        case 'hold': issueOrder(sel, 'halt'); issueOrder(sel, 'posture', 'prone'); issueOrder(sel, 'fire', 'free'); l.status = 'done'; break;
      }
    } finally { G.execIssuing = false; }
    G.log('Line ' + n + ': ' + this.lineText(l), 'plan');
  },

  check(l) {
    const m = this.liveMembers(l.unit);
    if (!m.length) { l.status = 'failed'; return; }
    const settled = m.every(s => !s.moving) && !G.controllers.some(c => c.members.some(x => m.includes(x)));
    if (!settled) return;
    // Stopped well short, by a halt on contact or by fire: the line waits for the leader.
    const dest = this.graphic(l.task === 'assault' ? l.target : l.where);
    if (dest) {
      const c = centroid(m), a = this.anchor(dest);
      if (dist(c.x, c.y, a.x, a.y) > 70) {
        l.status = 'stalled';
        G.log('Line ' + (this.lines.indexOf(l) + 1) + ': ' + PLAN_UNITS[l.unit] + ' halted short of ' + dest.name + '. Resume it from the Tracker.', 'warn');
        return;
      }
    }
    if (l.task === 'occupy' && l.stage === 'moving') {
      const g = this.graphic(l.where), aim = { x: g.pts[0].x + Math.cos(g.dir) * 150, y: g.pts[0].y + Math.sin(g.dir) * 150 };
      for (const s of m) { s.faceAngle = g.dir; s.homePosture = firingPosture(s, aim.x, aim.y); s.fireControl = 'free'; }
      G.log(PLAN_UNITS[l.unit] + ': Set in ' + g.name + ', watching the sector.', 'plan');
    } else if (l.task === 'sbf' && l.stage === 'moving') {
      G.execIssuing = true;
      try {
        const sel = this.unitSel(l.unit);
        issueOrder(sel, 'posture', 'prone');
        issueOrder(sel, 'suppress', this.anchor(this.graphic(l.target)));
      } finally { G.execIssuing = false; }
      G.log(PLAN_UNITS[l.unit] + ': Set at ' + this.gname(this.graphic(l.where)) + ', fire on ' + this.gname(this.graphic(l.target)) + '.', 'plan');
    } else {
      G.log(PLAN_UNITS[l.unit] + ': At ' + this.gname(this.graphic(l.where || l.target)) + '.', 'plan');
    }
    l.status = 'done';
  },

  // Men carrying out an active line of one of these tasks.
  onLine(s, tasks) {
    if (this.planning) return false;
    return this.lines.some(l => l.status === 'active' && tasks.includes(l.task) && this.liveMembers(l.unit).includes(s));
  },

  // Run a pending line now, whatever its trigger.
  executeNow(id) {
    const l = this.lines.find(x => x.id === id);
    if (l && (l.status === 'pending' || l.status === 'stalled') && !this.planning) { this.start(l); OPORD.refreshTracker(); }
  },

  // A direct order that moves men takes their line off the plan, if it moves at least half
  // of the line's men. Posture and fire orders leave the plan running.
  override(members, type) {
    if (this.planning || G.execIssuing) return;
    if (type && !['move', 'bound', 'assault', 'halt', 'cover', 'fallback'].includes(type)) return;
    for (const l of this.lines) {
      if (l.status !== 'active') continue;
      const lm = this.liveMembers(l.unit);
      if (lm.filter(s => members.includes(s)).length * 2 >= lm.length) {
        l.status = 'overridden';
        G.log('Line ' + (this.lines.indexOf(l) + 1) + ' overridden by your order.', 'plan');
      }
    }
    OPORD.refreshTracker();
  },

  fireSignal(color) {
    if (this.planning) { G.toast('Signals are for after step-off.'); return; }
    const sq = G.squads.blue, by = sq.all.find(s => s.billet === 'SL' && s.active) || sq.teams.map(t => t.leader).find(Boolean);
    const at = by || centroid(sq.all);
    this.signals[color] = true;
    G.effects.push({ type: 'star', x: at.x, y: at.y, color: SIGNALS[color].color, t: 0, life: 5 });
    G.log(SIGNALS[color].label + ' fired: ' + SIGNALS[color].meaning.toLowerCase() + '.', 'plan');
    this.update(0, true);
  },

  // Report each fire team crossing a phase line.
  checkPhaseLines() {
    const pls = this.graphics.filter(g => g.kind === 'pl' && g.pts.length > 1);
    if (!pls.length) return;
    for (const t of G.squads.blue.teams) {
      const live = t.members.filter(s => s.active);
      if (!live.length) continue;
      const c = centroid(live);
      for (const g of pls) {
        const a = g.pts[0], b = g.pts[g.pts.length - 1];
        const side = Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        const key = t.num + ':' + g.id, prev = this.crossings.get(key);
        this.crossings.set(key, side);
        // Only count crossings between the line's ends, not far beyond them.
        const len = dist(a.x, a.y, b.x, b.y), proj = ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (len * len);
        if (prev && side && prev !== side && proj > -0.1 && proj < 1.1) G.log(t.short + ': Crossing ' + g.name + '.', 'plan');
      }
    }
  },

  // How far the defenders have dug in: grows over the time available.
  digIn(s) {
    if (s.side !== 'red' || G.mode !== 'attack' || !this.timeAvail) return 0;
    return clamp(G.time / this.timeAvail, 0, 1);
  },

  // ---------------------------------------------------------------- generated parts of the order
  makeIntel() {
    const red = G.squads.red.all, n = red.length;
    const est = n + randInt(-2, 2);
    const kinds = new Set(red.map(s => s.billet));
    const seen = [];
    if (kinds.has('MG')) seen.push('a PKM machine gun');
    if (kinds.has('AR')) seen.push('an RPK light machine gun');
    if (kinds.has('RPG')) seen.push('an RPG-7');
    if (kinds.has('G')) seen.push('rifle grenades (GP-25)');
    if (kinds.has('MM')) seen.push('a scoped rifle (SVD)');
    const shown = shuffle(seen.slice()).slice(0, Math.max(1, Math.min(2, seen.length)));
    const near = this.placeNear(G.enemyArea, 450);
    const where = near ? (near.kind === 'village' ? 'in the buildings of ' + near.name : 'around ' + near.name) : 'in the open ground near the grid';
    const dirTo = compassWord(bearing(G.enemyArea.x, G.enemyArea.y, centroid(G.squads.blue.all).x, centroid(G.squads.blue.all).y));
    return {
      size: 'Squad-sized element, estimated ' + Math.max(6, est - 1) + ' to ' + (est + 1) + ' men.',
      activity: G.mode === 'attack' ? 'Defending ' + where + ', oriented generally ' + dirTo + ', toward you. Observed preparing positions.'
        : 'Moving ' + dirTo + ' on foot ' + (near ? 'from ' + where : 'across country') + ', toward your position, in a loose wedge.',
      location: 'Vicinity grid ' + gridRef(this.reported.x, this.reported.y) + ' (report accurate to about 100 m).',
      unit: 'Unknown. Dismounted OPFOR infantry. No markings observed.',
      time: 'Observed ' + randInt(15, 40) + ' minutes before this order.',
      equipment: 'Rifles' + (shown.length ? ', ' + shown.join(' and ') : '') + '. Other weapons are possible.',
      near,
    };
  },

  placeNear(p, r) {
    let best = null, bd = r;
    for (const pl of G.map.places) { const d = dist(pl.x, pl.y, p.x, p.y); if (d < bd) { bd = d; best = pl; } }
    if (best) return best;
    for (const pk of G.map.peaks) { const d = dist(pk.x, pk.y, p.x, p.y); if (d < bd) { bd = d; best = { name: 'Hill ' + Math.round(G.map.elevBase + pk.e), kind: 'hill', x: pk.x, y: pk.y }; } }
    return best;
  },

  drawD() {
    const atk = G.mode === 'attack';
    return [
      ['Defend', atk ? 'Most likely. Will defend from its present positions, improving them while you plan.' : 'Can go to ground and defend if it is fired on first.', atk],
      ['Reinforce', 'No other enemy is known in the AO. Reinforcement is unlikely.', false],
      ['Attack', atk ? 'Could counterattack your flank with one group if your assault stalls.' : 'Most likely. Will keep moving and attack on contact.', !atk],
      ['Withdraw', 'Likely to break contact once it loses about half its men.', false],
      ['Delay', 'Could delay from the next covered position if pressed.', false],
    ];
  },

  missionText() {
    const gr = gridRef(this.reported.x, this.reported.y), near = this.intel.near;
    const purpose = near ? (near.kind === 'village' ? 'secure the village of ' + near.name : near.kind === 'farm' ? 'secure ' + near.name : 'seize ' + near.name)
      : 'clear the area for the company';
    if (G.mode === 'attack') return '1st Squad attacks NLT H+' + Math.round(this.timeAvail / 60) + ' to destroy OPFOR vicinity grid ' + gr + ' in order to ' + purpose + '.';
    return '1st Squad moves to contact along bearing ' + pad3(G.axisBearing) + ' to find, fix and destroy OPFOR advancing from vicinity grid ' + gr + ' in order to ' + purpose + '.';
  },

  // Terrain facts along the line from the squad to the reported enemy, for the orientation.
  terrainFacts() {
    const b = centroid(G.squads.blue.all), e = this.reported, d = dist(b.x, b.y, e.x, e.y);
    let woods = 0, open = 0, hi = { e: -Infinity }, streams = 0, lastWet = false, roads = 0, lastRoad = false, river = 0, lastRiv = false, swamp = 0;
    const n = Math.ceil(d / 10);
    for (let i = 0; i <= n; i++) {
      const x = lerp(b.x, e.x, i / n), y = lerp(b.y, e.y, i / n), k = G.map.terAt(x, y), el = G.map.elevAt(x, y);
      if (k === TER.WOODS || k === TER.ORCHARD) woods++; else open++;
      if (el > hi.e) hi = { e: el, x, y };
      const wet = k === TER.STREAM || k === TER.WASH; if (wet && !lastWet) streams++; lastWet = wet;
      const riv = k === TER.RIVER || k === TER.FORD; if (riv && !lastRiv) river++; lastRiv = riv;
      if (k === TER.SWAMP) swamp++;
      const rd = k === TER.ROAD || k === TER.PAVED; if (rd && !lastRoad) roads++; lastRoad = rd;
    }
    return { b, e, d, woodsPct: Math.round(woods / (n + 1) * 100), hi, streams, roads, river, swampM: swamp * CELL };
  },

  // ---------------------------------------------------------------- a draft plan
  // A hasty attack: the squad moves to a checkpoint; the base of fire sets a support-by-fire
  // position on one flank and opens fire; only then do the other two fire teams move by a
  // covered route to an assault position on the other flank; a red star sends them in.
  draft() {
    if (G.mode === 'meeting') return this.draftDefense();
    this.graphics = []; this.lines = [];
    const b = centroid(G.squads.blue.all), o = this.reported;
    const obj = this.addGraphic('obj', [o]);
    const ax = angleTo(o.x, o.y, b.x, b.y); // from the objective back toward us
    const site = (radius, angle, wantLOS) => {
      let best = null, bs = -Infinity;
      for (let k = 0; k < 24; k++) {
        const a = angle + randRange(-0.35, 0.35), r = radius * randRange(0.85, 1.15);
        const x = clamp(o.x + Math.cos(a) * r, 40, MAP_W - 40), y = clamp(o.y + Math.sin(a) * r, 40, MAP_H - 40);
        const c = G.map.nearestPassable(Math.floor(x / CELL), Math.floor(y / CELL));
        const px = (c.cx + 0.5) * CELL, py = (c.cy + 0.5) * CELL, ter = G.map.terAt(px, py);
        const los = G.map.los(px, py, 1.2, o.x, o.y, 1.0);
        let s = (ter === TER.WOODS || ter === TER.ROCK ? 2 : TERRAIN[ter].conceal >= 0.3 ? 1 : 0);
        s += wantLOS ? (los > 0 ? 4 : -4) : (los > 0 ? -2 : 2);
        if (s > bs) { bs = s; best = { x: px, y: py }; }
      }
      return best;
    };
    const side = chance(0.5) ? 1 : -1;
    const sbf = this.addGraphic('sbf', [site(260, ax + side * 0.9, true)]);
    const aslt = this.addGraphic('aslt', [site(180, ax - side * 1.1, false)]);
    const cpPt = { x: lerp(b.x, (sbf.pts[0].x + aslt.pts[0].x) / 2, 0.55), y: lerp(b.y, (sbf.pts[0].y + aslt.pts[0].y) / 2, 0.55) };
    const cp = this.addGraphic('cp', [cpPt]);
    this.addGraphic('ccp', [{ x: lerp(b.x, cpPt.x, 0.6), y: lerp(b.y, cpPt.y, 0.6) }]);
    const base = 't1';
    this.addLine({ trigger: 'start', unit: 'squad', task: 'move', where: cp.id, mode: 'walk' });
    this.addLine({ trigger: 'after', unit: base, task: 'sbf', where: sbf.id, target: obj.id, mode: 'walk' });
    this.addLine({ trigger: 'after', unit: 't2', task: 'move', where: aslt.id, mode: 'walk' });
    this.addLine({ trigger: 'with', unit: 't3', task: 'move', where: aslt.id, mode: 'walk' });
    this.addLine({ trigger: 'after', task: 'signal', signal: 'red' });
    this.addLine({ trigger: 'signal', signal: 'red', unit: 't2', task: 'assault', target: obj.id });
    this.addLine({ trigger: 'with', unit: 't3', task: 'assault', target: obj.id });
    this.addLine({ trigger: 'signal', signal: 'green', unit: base, task: 'lift' });
    // A limit of advance just past the objective stops the assault running on.
    const fwd = angleTo(aslt.pts[0].x, aslt.pts[0].y, o.x, o.y), lx = o.x + Math.cos(fwd) * 80, ly = o.y + Math.sin(fwd) * 80;
    this.addGraphic('loa', [{ x: lx - Math.sin(fwd) * 140, y: ly + Math.cos(fwd) * 140 }, { x: lx + Math.sin(fwd) * 140, y: ly - Math.cos(fwd) * 140 }]);
    OPORD.refresh();
  },

  // A hasty defense for a meeting engagement: move to covered ground that looks down the
  // enemy's likely approach, set in, and let him walk into the squad's fire.
  draftDefense() {
    this.graphics = []; this.lines = [];
    const b = centroid(G.squads.blue.all), o = this.reported, ax = angleTo(b.x, b.y, o.x, o.y);
    let best = null, bs = -Infinity;
    for (let k = 0; k < 40; k++) {
      const a = ax + randRange(-0.6, 0.6), r = randRange(300, 450);
      const c = G.map.nearestPassable(Math.floor(clamp(b.x + Math.cos(a) * r, 40, MAP_W - 40) / CELL), Math.floor(clamp(b.y + Math.sin(a) * r, 40, MAP_H - 40) / CELL));
      const px = (c.cx + 0.5) * CELL, py = (c.cy + 0.5) * CELL, ter = G.map.terAt(px, py);
      // How much of the approach, the ground 150 to 450 m toward the enemy, can be seen from here.
      let view = 0;
      for (let d = 150; d <= 450; d += 75) {
        const tx = px + Math.cos(ax) * d, ty = py + Math.sin(ax) * d;
        if (G.map.los(px, py, 1.2, tx, ty, 1.0) > 0) view++;
      }
      const s = view * 2 + (ter === TER.WOODS || ter === TER.ROCK ? 3 : TERRAIN[ter].conceal >= 0.3 ? 1.5 : 0) + G.map.elevAt(px, py) * 0.05;
      if (s > bs) { bs = s; best = { x: px, y: py }; }
    }
    const cp = this.addGraphic('rel', [best]);
    const obj = this.addGraphic('obj', [o]);
    const pa = { x: best.x + Math.cos(ax) * 200, y: best.y + Math.sin(ax) * 200 };
    const nx = -Math.sin(ax), ny = Math.cos(ax);
    this.addGraphic('pl', [{ x: pa.x + nx * 250, y: pa.y + ny * 250 }, { x: pa.x - nx * 250, y: pa.y - ny * 250 }]);
    this.addGraphic('ccp', [{ x: lerp(b.x, best.x, 0.6), y: lerp(b.y, best.y, 0.6) }]);
    const rly = this.addGraphic('rly', [{ x: best.x - Math.cos(ax) * 150, y: best.y - Math.sin(ax) * 150 }]);
    // Three fighting positions in line across the approach, 35 m apart, sectors overlapping.
    const fps = [-1, 0, 1].map(k => {
      const g = this.addGraphic('fp', [{ x: best.x + nx * 35 * k, y: best.y + ny * 35 * k }]);
      g.dir = ax - k * 0.25; g.width = Math.PI / 2;
      return g;
    });
    this.addLine({ trigger: 'start', unit: 'squad', task: 'move', where: cp.id, mode: 'walk' });
    this.addLine({ trigger: 'after', unit: 't1', task: 'occupy', where: fps[1].id });
    this.addLine({ trigger: 'with', unit: 't2', task: 'occupy', where: fps[0].id });
    this.addLine({ trigger: 'with', unit: 't3', task: 'occupy', where: fps[2].id });
    this.addLine({ trigger: 'contact', unit: 't1', task: 'suppress', target: obj.id });
    this.addLine({ trigger: 'signal', signal: 'white', unit: 'squad', task: 'move', where: rly.id, mode: 'rush' });
    OPORD.refresh();
  },
};

function compassWord(deg) {
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
}

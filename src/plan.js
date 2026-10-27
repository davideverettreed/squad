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
// A team's beaten zone when suppressing: the ground its fire falls on, an ellipse along its
// line of fire, len m deep and wid m wide; the men fire at points spread over it.
const ZONE = { len: 30, wid: 10 };
// Plan lines whose teams can each be given their own spot by dragging their ghosts.
const SPOT_TASKS = ['move', 'route', 'bound', 'assault', 'occupy', 'sbf', 'suppress'];
// What placing a control measure means for a selected unit: its next step of the plan.
const TOOL_STEPS = { cp: 'cp', rel: 'rel', aslt: 'aslt', fp: 'fp', sbf: 'sbf', obj: 'obj', trp: 'trp' };
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
    // Time available: in a meeting engagement, until the enemy could reach you; against a
    // pickup or a repair, until it comes; otherwise the echelon's time for an attack.
    const M = G.mission || {};
    this.timeAvail = G.mode === 'meeting' ? Math.round(sep / 1.25 / 60) * 60 : M.evacAt || M.leaveAt || G.echelon.attackTime * 60;
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
      out.push({ kind: 'town', name: p.name.toUpperCase(), x: p.x, y: p.y, note: p.kind === 'village' ? 'Village' : farmNoun(G.map.R) });
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
  // Make a control measure another kind of the same shape: a point or area into another
  // point or area, a phase line into a limit of advance. Plan lines that use it keep it.
  changeKind(g, kind) {
    if (g.kind === kind) return;
    g.kind = kind; g.name = this.nextName(kind); g.r = GRAPHIC_KINDS[kind].r || 0;
    if (kind === 'fp' && g.dir == null) { g.dir = angleTo(g.pts[0].x, g.pts[0].y, this.reported.x, this.reported.y); g.width = Math.PI / 2; }
  },
  // The kinds a control measure can be changed into.
  kindsLike(g) {
    const K = GRAPHIC_KINDS[g.kind];
    if (K.multi) return [];
    if (K.line) return ['pl', 'loa'].filter(k => k !== g.kind && !(k === 'loa' && this.graphics.some(o => o.kind === 'loa')));
    return Object.keys(GRAPHIC_KINDS).filter(k => k !== g.kind && !GRAPHIC_KINDS[k].line);
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
      // A route drawn with a unit selected is that unit's route.
      if (!this.routeDraft && !this.routeUnit && G.ui.sel) this.routeUnit = G.ui.sel.level === 'group' ? G.ui.sel.teams.map(t => 't' + t.num) : this.planUnit(G.ui.sel) || null;
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
      // With a unit selected, each one is also that unit's next step: checkpoint after
      // checkpoint makes a march, each leg from the last.
      const step = TOOL_STEPS[kind], sel = G.ui.sel;
      if (step && sel && (this.planUnit(sel) || sel.level === 'group')) {
        this.addStep(sel, w, step);
        G.toast(this.graphic(this.selected).name + ' placed, and ' + selName(sel) + ' moves on to it after its last step. Tap again for the next one, or tap ' + K.short + ' to stop.');
        return true;
      }
      const g = this.addGraphic(kind, [w]);
      this.selected = g.id;
      G.toast(g.name + ' placed. Tap again for another, or tap ' + K.short + ' to stop.' + (step ? ' Select a unit first to plan its move to each one.' : ''));
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
        // Several teams: a line for each, the others with the first, each to its own spot at the end.
        const units = Array.isArray(this.routeUnit) ? this.routeUnit : [this.routeUnit], n0 = this.lines.length;
        units.forEach((u, k) => this.addLine(Object.assign({ unit: u, task: 'route', where: g.id, mode: G.ui.moveMode || 'walk' }, k ? { trigger: 'with' } : {})));
        if (units.length > 1) this.spreadSpots(this.lines.slice(n0), units, g.pts[g.pts.length - 1], g.pts[g.pts.length - 2]);
        G.toast(units.map(u => PLAN_UNITS[u]).join(' and ') + ' ' + (units.length > 1 ? 'move' : 'moves') + ' along ' + g.name + '. Added to the plan.');
      }
    }
    else G.toast('A route needs at least two waypoints.');
    this.routeDraft = null; this.tool = null; this.routeUnit = null;
    OPORD.refresh();
    return true;
  },
  // A move whose teams have their own spots: each team goes to its spot.
  moveToSpots(l, sel, dest) {
    const sq = G.squads.blue, members = selMembers(sel);
    Plan.override(members, 'move');
    releaseControllers(members);
    const units = l.unit === 'squad' ? sq.teams.filter(t => t.members.some(commandable)).map(t => 't' + t.num) : [l.unit];
    const spots = this.spotsFor(l, dest, centroid(members.filter(commandable)), units);
    for (const u of units) faceMove(sq.teams[Number(u[1]) - 1], spots[u], l.spots && l.spots[u], l.mode);
  },
  // The teams of a line and each one's end point.
  teamSpots(l, sel, dest) {
    const sq = G.squads.blue, members = selMembers(sel);
    const units = l.unit === 'squad' ? sq.teams.filter(t => t.members.some(commandable)).map(t => 't' + t.num) : [l.unit];
    return { units, spots: this.spotsFor(l, dest, centroid(members.filter(commandable)), units) };
  },
  // Bounding overwatch where the teams have their own spots: each bounds toward its own.
  boundToSpots(l, sel, dest) {
    const { units, spots } = this.teamSpots(l, sel, dest);
    if (l.unit !== 'squad') { issueOrder(sel, 'bound', spots[units[0]]); return; }
    const members = selMembers(sel);
    Plan.override(members, 'bound');
    releaseControllers(members);
    for (const s of members) s.launchQueue = null;
    const elements = boundElements(sel);
    const dests = elements.map(e => { const t = e.find(s => s.team.num); return t && spots['t' + t.team.num] ? spots['t' + t.team.num] : dest; });
    G.controllers.push(new BoundController(elements, dest.x, dest.y, selName(sel), dests));
    G.toast(selName(sel) + ': Bounding overwatch, each team to its spot.');
  },
  // An assault where the teams have their own spots: each fights through to its own.
  assaultToSpots(l, sel, dest) {
    const { units, spots } = this.teamSpots(l, sel, dest), sq = G.squads.blue;
    const members = selMembers(sel);
    Plan.override(members, 'assault');
    releaseControllers(members);
    for (const u of units) faceMove(sq.teams[Number(u[1]) - 1], spots[u], l.spots && l.spots[u], 'walk');
    for (const s of members.filter(commandable)) { s.assault = true; s.fireControl = 'free'; s.homePosture = 'kneel'; }
    G.log(selName(sel) + ': Assault through!', 'fire');
  },
  // The plan unit for a selection: a Marine plans with his fire team, the SL with the squad.
  planUnit(sel) {
    if (!sel) return null;
    if (sel.level === 'group') return null; // several teams: a line for each (see addStep)
    const t = sel.level === 'squad' ? null : sel.team;
    return t && t.num ? 't' + t.num : 'squad';
  },
  // A step chosen from the map menu while planning: a control measure at the spot and a
  // line of the plan that sends the unit to it.
  addStep(sel, w, step) {
    // Several teams: all of them is the squad; otherwise the first team's line, then the
    // others with it, side by side at the spot.
    if (sel && sel.level === 'group') {
      const live = G.squads.blue.teams.filter(t => t.members.some(s => s.active));
      if (sel.teams.length >= live.length) return this.addStep({ level: 'squad', squad: sel.squad }, w, step);
      // A route for several teams is drawn first; each gets its line when it is finished.
      if (step === 'rte') {
        this.groupUnits = sel.teams.map(t => 't' + t.num);
        try { this.addStep({ level: 'team', team: sel.teams[0], squad: sel.squad }, w, step); } finally { this.groupUnits = null; }
        return;
      }
      const n0 = this.lines.length;
      this.addStep({ level: 'team', team: sel.teams[0], squad: sel.squad }, w, step);
      const first = this.lines[n0];
      if (!first || this.lines.length !== n0 + 1) return;
      const units = sel.teams.map(t => 't' + t.num);
      for (const u of units.slice(1)) { const { id, status, spots, ...rest } = first; this.addLine(Object.assign({}, rest, { unit: u, trigger: 'with' })); }
      // Side by side at the spot (or, suppressing, aimed side by side across the target).
      if (SPOT_TASKS.includes(first.task)) this.spreadSpots(this.lines.slice(n0, n0 + units.length), units, w, centroid(selMembers(sel).filter(s => s.active)));
      G.toast(units.length + ' lines: ' + units.map(u => PLAN_UNITS[u]).join(' and ') + ' together.');
      OPORD.refresh();
      return;
    }
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
      case 'rel': g = this.addGraphic('rel', [w]); l = this.addLine({ unit, task: 'move', where: g.id, mode }); break;
      case 'rte':
        this.tool = 'rte'; this.routeUnit = this.groupUnits || unit; this.routeDraft = [{ x: w.x, y: w.y }];
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
  // The control measure under a screen point: a point near its symbol, a line anywhere
  // along it (a vertex near the pointer is picked up to drag), an area anywhere inside.
  // proj: world to screen (the flat map's by default; the sand table passes its own, which
  // gives z > 1 for a point behind the camera).
  hitGraphic(sx, sy, proj) {
    proj = proj || ((x, y) => toScreen(x, y));
    let best = null, bd = 22;
    const segDist = (a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? clamp(((sx - a.x) * dx + (sy - a.y) * dy) / L, 0, 1) : 0;
      return Math.hypot(a.x + dx * t - sx, a.y + dy * t - sy);
    };
    for (const g of this.graphics) {
      const K = GRAPHIC_KINDS[g.kind];
      if (K.line) {
        const q = g.pts.map(p => proj(p.x, p.y));
        if (q.some(p => p.z > 1)) continue;
        for (let i = 0; i < q.length; i++) {
          const d = Math.hypot(q[i].x - sx, q[i].y - sy);
          if (d < bd) { bd = d; best = { g, idx: i }; }
        }
        // Along a segment: grab the nearer end of it, a little less eagerly than a vertex.
        for (let i = 1; i < q.length; i++) {
          const d = segDist(q[i - 1], q[i]) + 4;
          if (d < bd) { bd = d; best = { g, idx: Math.hypot(q[i - 1].x - sx, q[i - 1].y - sy) < Math.hypot(q[i].x - sx, q[i].y - sy) ? i - 1 : i, along: true }; }
        }
        continue;
      }
      const p = proj(g.pts[0].x, g.pts[0].y), d = Math.hypot(p.x - sx, p.y - sy);
      if (p.z > 1) continue;
      if (d < bd) { bd = d; best = { g, idx: 0 }; }
      // Inside an area (objective, assault position): a hit, though a point on top of it wins.
      const e = K.r ? proj(g.pts[0].x + K.r, g.pts[0].y) : null, rr = e ? Math.hypot(e.x - p.x, e.y - p.y) : 0;
      if (rr && d < rr && !best) best = { g, idx: 0, inside: true };
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
    advanceDuringPlanning(this.planUsed);
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

  // Where the plan sends each unit, line by line: a leg for each move, and a ghost of each
  // unit where its last planned move ends. A squad move sends all three teams together;
  // a team sent on alone leaves the squad's ghost and gets one of its own.
  // Where the plan sends each fire team, line by line: a leg for each move, and a ghost of
  // each team where its last planned move ends. A squad move sets the teams out in the
  // squad's formation around the point; a team's spot can be dragged to where it should be
  // (kept in the line as spots[team]).
  projection() {
    const sq = G.squads.blue, legs = [], ghosts = [];
    if (!sq) return { legs, ghosts };
    const pos = {}, mark = {};
    for (const n of [1, 2, 3]) {
      const live = sq.teams[n - 1].members.filter(s => s.active);
      pos['t' + n] = live.length ? centroid(live) : null;
    }
    for (const l of this.lines) {
      if (TASKS[l.task].noUnit) continue;
      // After step-off only what is still to come: lines waiting, under way or held up.
      if (!this.planning && !['pending', 'active', 'stalled'].includes(l.status)) continue;
      // Suppression: no one moves; each team's aim point on the target is its ghost.
      if (l.task === 'suppress') {
        const tg = this.graphic(l.target);
        const units = l.unit === 'squad' ? ['t1', 't2', 't3'].filter(u => pos[u]) : [l.unit].filter(u => pos[u]);
        if (!tg || !units.length) continue;
        const aims = this.aimsFor(l, this.anchor(tg), centroid(units.map(u => pos[u])), units);
        for (const u of units) ghosts.push({ unit: u, x: aims[u].x, y: aims[u].y, name: tg.name, line: l, aim: true, from: { x: pos[u].x, y: pos[u].y }, final: false });
        continue;
      }
      let dest = null, via = null, g = null;
      if (l.task === 'assault') { g = this.graphic(l.target); if (g) dest = this.anchor(g); }
      else if (TASKS[l.task].where) {
        g = this.graphic(l.where);
        if (g) { dest = l.task === 'route' ? g.pts[g.pts.length - 1] : this.anchor(g); if (l.task === 'route') via = g.pts; }
      }
      if (!dest) continue;
      const units = l.unit === 'squad' ? ['t1', 't2', 't3'].filter(u => pos[u]) : [l.unit].filter(u => pos[u]);
      const starts = units.map(u => pos[u]);
      if (!starts.length) continue;
      const from = centroid(starts);
      legs.push({ from, to: dest, via, unit: l.unit, task: l.task });
      const spots = this.spotsFor(l, dest, from, units);
      // A ghost of each team at every step, facing the way it came: where it will be, about,
      // when it gets there. The last step of each team is its final ghost.
      const last = via && via.length > 1 ? via[via.length - 2] : from, h = angleTo(last.x, last.y, dest.x, dest.y);
      for (const u of units) {
        pos[u] = spots[u];
        if (mark[u]) mark[u].final = false;
        // Facing: as turned with Q/E while its ghost was held, else the way it came.
        const sp = l.spots && l.spots[u];
        mark[u] = { unit: u, x: spots[u].x, y: spots[u].y, name: g.name, line: l, h: sp && sp.h != null ? sp.h : h, final: true };
        ghosts.push(mark[u]);
      }
    }
    return { legs, ghosts };
  },
  // Where each team of a line ends up: its dragged spot, or its place in the squad's
  // formation around the point (a squad move), or the point itself (a team's move).
  spotsFor(l, dest, from, units) {
    const sq = G.squads.blue, out = {}, h = angleTo(from.x, from.y, dest.x, dest.y);
    units.forEach((u, k) => {
      // A dragged spot is kept as an offset from the point, so it moves with the point.
      const sp = l.spots && l.spots[u];
      if (sp) { out[u] = sp.dx != null ? { x: dest.x + sp.dx, y: dest.y + sp.dy } : { x: sp.x, y: sp.y }; return; }
      if (l.unit === 'squad' && units.length > 1) {
        const o = scaled(squadSlot(sq.formation, k, units.length), sq.spacing), w = rotateOffset(o.x, o.y, h);
        out[u] = { x: dest.x + w.x, y: dest.y + w.y };
      } else out[u] = { x: dest.x, y: dest.y };
    });
    return out;
  },

  // Several teams on one point: each its own spot, side by side across the way they came
  // (30 m apart; 20 m in a fighting position; aim points 12 m apart across a target).
  spreadSpots(lines, units, dest, from) {
    const task = lines[0].task, gap = task === 'suppress' ? 12 : task === 'occupy' ? 20 : 30;
    const h = angleTo(from.x, from.y, dest.x, dest.y);
    units.forEach((u, k) => {
      const o = rotateOffset((k - (units.length - 1) / 2) * gap, 0, h), l = lines[k];
      if (l) l.spots = Object.assign(l.spots || {}, { [u]: { dx: o.x, dy: o.y } });
    });
  },

  // Every ghost on the map. Planning: the plan's. After step-off: the plan's steps still to
  // come, and where each team moving on an order of its own (not a plan line) is going.
  ghosts() {
    const out = this.projection().ghosts;
    // Where two or more teams go to the same point at a step, a squad ghost at their middle
    // stands for all of them: tap it to take them together, drag it to move them together.
    const by = new Map();
    for (const g of out) {
      if (g.aim || !g.line || !SPOT_TASKS.includes(g.line.task)) continue;
      const id = g.line.task === 'assault' ? g.line.target : g.line.where;
      if (!by.has(id)) by.set(id, []);
      by.get(id).push(g);
    }
    for (const members of by.values()) {
      if (members.length < 2) continue;
      const c = centroid(members);
      out.push({ unit: 'squad', group: true, members, x: c.x, y: c.y, name: members[0].name, line: members[0].line, final: members.some(m => m.final) });
    }
    if (this.planning || !G.squads.blue) return out;
    for (const t of G.squads.blue.teams) {
      const movers = t.members.filter(s => commandable(s) && s.path.length);
      if (!movers.length || movers.some(s => this.onLine(s, Object.keys(TASKS)))) continue;
      const ends = movers.map(s => s.path[s.path.length - 1]), c = centroid(ends);
      const g = { unit: 't' + t.num, x: c.x, y: c.y, name: 'its destination', live: true, ends, mode: movers[0].moveMode, final: true };
      // Being dragged: shown where the pointer has it.
      const d = G.ui.liveDrag;
      if (d && d.unit === g.unit) {
        const to = d.to || c, dx = to.x - c.x, dy = to.y - c.y, r = d.rot || 0, cs = Math.cos(r), sn = Math.sin(r);
        g.x = to.x; g.y = to.y;
        // Turned with Q/E: the men's spots pivot about the middle.
        g.ends = ends.map(e => { const rx = e.x - c.x, ry = e.y - c.y; return { x: to.x + rx * cs - ry * sn, y: to.y + rx * sn + ry * cs }; });
      }
      out.push(g);
    }
    return out;
  },

  // Q or E with a ghost held: the group of ghosts at that step (the teams sent to the same
  // point) pivots about its middle, each team's formation turning with it. A team's own
  // destination (after step-off) turns its formation there. Returns the held ghost's new
  // place, so the drag can carry on from it.
  pivotGhosts(gh, delta) {
    if (gh.group) { this.pivotGhosts(gh.members[0], delta); return null; }
    if (gh.live) { gh.rot = (gh.rot || 0) + delta; G.ui.liveDrag = gh; return null; }
    const gid = (l) => l.task === 'assault' || l.task === 'suppress' ? l.target : l.where, id = gid(gh.line), a = this.anchor(this.graphic(id));
    const set = this.ghosts().filter(g => !g.live && !g.aim && g.line && SPOT_TASKS.includes(g.line.task) && gid(g.line) === id
      && (!this.planning || ['pending', 'active', 'stalled'].includes(g.line.status)));
    if (!set.length) return null;
    const c = centroid(set), cs = Math.cos(delta), sn = Math.sin(delta);
    let held = null;
    for (const g of set) {
      const rx = g.x - c.x, ry = g.y - c.y, nx = c.x + rx * cs - ry * sn, ny = c.y + rx * sn + ry * cs, l = g.line;
      l.spots = l.spots || {};
      const old = l.spots[g.unit] || {};
      l.spots[g.unit] = Object.assign({}, old, { dx: nx - a.x, dy: ny - a.y, h: (old.h != null ? old.h : g.h) + delta });
      if (g.unit === gh.unit && g.line === gh.line) held = { x: nx, y: ny };
      if (!this.planning && l.status === 'active') this.reissueTeam(l, g.unit);
    }
    return held;
  },

  // A squad ghost dragged: every team at that step shifts by the same amount.
  shiftGroup(g, dx, dy) {
    for (const m of g.members) {
      const l = m.line, a = this.anchor(this.graphic(l.task === 'assault' ? l.target : l.where));
      m.x += dx; m.y += dy;
      l.spots = l.spots || {};
      l.spots[m.unit] = Object.assign({}, l.spots[m.unit], { dx: m.x - a.x, dy: m.y - a.y });
    }
    g.x += dx; g.y += dy;
  },

  // A ghost of a line under way dragged to a new spot: the team goes there now.
  reissueTeam(l, u) {
    const sq = G.squads.blue, team = sq.teams[Number(u[1]) - 1];
    if (!team || !team.members.some(commandable)) return;
    const dg = this.graphic(l.task === 'assault' || l.task === 'suppress' ? l.target : l.where);
    if (!dg) return;
    const spot = this.teamSpots(l, this.unitSel(l.unit), this.anchor(dg)).spots[u];
    if (!spot) return;
    switch (l.task) {
      case 'move': case 'sbf': case 'route': faceMove(team, spot, l.spots && l.spots[u], l.mode); break;
      case 'assault':
        faceMove(team, spot, l.spots && l.spots[u], 'walk');
        for (const s of team.members.filter(commandable)) { s.assault = true; s.fireControl = 'free'; }
        break;
      case 'occupy': occupyPosition({ level: 'team', team, squad: sq }, dg, { [u]: spot }); break;
      case 'bound': {
        // The bounding drill carries on, with this team's end point moved.
        const c = G.controllers.find(x => x instanceof BoundController && x.members.some(s => s.team === team));
        if (c) {
          c.dests = c.dests || c.elements.map(() => ({ x: c.dest.x, y: c.dest.y }));
          c.elements.forEach((e, k) => { if (e.some(s => s.team === team)) c.dests[k] = spot; });
          c.starts = c.starts || c.elements.map(e => centroid(e));
        } else teamMove(team, spot.x, spot.y, 'rush');
        break;
      }
    }
    G.log(PLAN_UNITS[u] + ': New spot at ' + dg.name + '.', 'plan');
  },

  // Every beaten zone on the map: while planning, those of the suppress lines (kept in the
  // line's spots: offset, depth, width, axis); after step-off, those the teams are firing
  // on. Each comes with set(), which reshapes it where it is kept.
  beatenZones() {
    const out = [];
    if (!G.squads.blue) return out;
    if (this.planning) {
      for (const gh of this.projection().ghosts) {
        if (!gh.aim) continue;
        const l = gh.line, u = gh.unit, sp = (l.spots && l.spots[u]) || {}, tg = this.anchor(this.graphic(l.target));
        out.push({ x: gh.x, y: gh.y, len: sp.len || ZONE.len, wid: sp.wid || ZONE.wid, ang: sp.ang != null ? sp.ang : angleTo(gh.from.x, gh.from.y, gh.x, gh.y),
          from: gh.from, unit: u, key: 'L' + l.id + u,
          set: (z) => { l.spots = l.spots || {}; l.spots[u] = { dx: z.x - tg.x, dy: z.y - tg.y, len: z.len, wid: z.wid, ang: z.ang }; } });
      }
      return out;
    }
    const by = new Map();
    for (const s of G.squads.blue.all) {
      const p = s.suppressPt;
      if (!s.active || !p || !p.len) continue;
      if (!by.has(p)) by.set(p, []);
      by.get(p).push(s);
    }
    for (const [p, men] of by) {
      const t = men.find(s => s.team.num);
      out.push({ x: p.x, y: p.y, len: p.len, wid: p.wid, ang: p.ang, from: centroid(men), unit: t ? 't' + t.team.num : 'squad', key: p, live: true,
        set: (z) => Object.assign(p, { x: z.x, y: z.y, len: z.len, wid: z.wid, ang: z.ang }) });
    }
    return out;
  },

  // Where each team of a suppress line aims: its dragged aim point, or (a squad) the teams'
  // fire spread 12 m apart across the target as seen from the squad, or the point itself.
  aimsFor(l, dest, from, units) {
    const out = {}, h = angleTo(from.x, from.y, dest.x, dest.y);
    units.forEach((u, k) => {
      const sp = l.spots && l.spots[u];
      if (sp) { out[u] = { x: dest.x + sp.dx, y: dest.y + sp.dy }; return; }
      const w = rotateOffset((k - (units.length - 1) / 2) * 12, 0, h);
      out[u] = units.length > 1 ? { x: dest.x + w.x, y: dest.y + w.y } : { x: dest.x, y: dest.y };
    });
    return out;
  },

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
        case 'move':
          if (l.spots && Object.keys(l.spots).length) this.moveToSpots(l, sel, this.anchor(where));
          else groupMove(sel, this.anchor(where).x, this.anchor(where).y, l.mode);
          break;
        case 'route':
          if (l.spots && Object.keys(l.spots).length) {
            // Along the route together, then each team off to its own spot at the end.
            const { units, spots } = this.teamSpots(l, sel, this.anchor(where));
            for (const u of units) routeMove(this.unitSel(u), [...where.pts.slice(0, -1), spots[u]], l.mode);
          } else routeMove(sel, where.pts, l.mode);
          break;
        case 'occupy': occupyPosition(sel, where, l.spots && Object.keys(l.spots).length ? this.teamSpots(l, sel, this.anchor(where)).spots : null); l.stage = 'moving'; break;
        case 'bound':
          if (l.spots && Object.keys(l.spots).length) this.boundToSpots(l, sel, this.anchor(where));
          else issueOrder(sel, 'bound', this.anchor(where));
          break;
        case 'assault':
          if (l.spots && Object.keys(l.spots).length) this.assaultToSpots(l, sel, this.anchor(tgt));
          else issueOrder(sel, 'assault', this.anchor(tgt));
          break;
        case 'sbf':
          if (l.spots && Object.keys(l.spots).length) this.moveToSpots(l, sel, this.anchor(where));
          else groupMove(sel, this.anchor(where).x, this.anchor(where).y, l.mode);
          l.stage = 'moving';
          break;
        case 'suppress':
          if (l.unit === 'squad' || (l.spots && Object.keys(l.spots).length)) {
            // Each team on its own aim point.
            const sq = G.squads.blue, units = l.unit === 'squad' ? sq.teams.filter(t => t.members.some(commandable)).map(t => 't' + t.num) : [l.unit];
            const aims = this.aimsFor(l, this.anchor(tgt), centroid(m), units);
            for (const u of units) {
              const sp = (l.spots && l.spots[u]) || {}, from = centroid(this.liveMembers(u));
              issueOrder(this.unitSel(u), 'suppress', Object.assign({}, aims[u], { len: sp.len || ZONE.len, wid: sp.wid || ZONE.wid,
                ang: sp.ang != null ? sp.ang : angleTo(from.x, from.y, aims[u].x, aims[u].y) }));
            }
          } else issueOrder(sel, 'suppress', this.anchor(tgt));
          l.status = 'done';
          break;
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
      // Where the teams were meant to end: their own spots, or the point.
      const c = centroid(m), a = l.spots && Object.keys(l.spots).length
        ? centroid(Object.values(this.teamSpots(l, this.unitSel(l.unit), this.anchor(dest)).spots)) : this.anchor(dest);
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
    // The squad leader fires it: shown in real time, so it is seen at any game speed.
    G.flares.push({ x: at.x, y: at.y, color: SIGNALS[color].color, label: SIGNALS[color].label, t: 0, life: FLARE.life });
    if (by) by.lastFired = G.time;
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
    if (s.side !== 'red' || !(G.mission && G.mission.digIn) || !this.timeAvail) return 0;
    return clamp(G.time / this.timeAvail, 0, 1);
  },

  // ---------------------------------------------------------------- generated parts of the order
  makeIntel() {
    const red = G.squads.red.all, n = red.length;
    const est = n + randInt(-2, 2);
    // What was seen: the common shoulder arm, and one or two of the heavier weapons.
    const count = new Map();
    for (const s of red) count.set(s.weapon.name, (count.get(s.weapon.name) || 0) + 1);
    const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const art = (w) => (/^[aeiouAEFHILMNORSX8]/.test(w) && !/^(Uzi|Lu|one)/.test(w) ? 'an ' : 'a ') + w;
    const plural = (w) => /\)$/.test(w) ? w.replace(/ \(/, 's (') : /s$/.test(w) ? w : w + 's';
    const noun = new Map(Object.values(WEAPONS).map(W => [W.name, W.noun || W.name]));
    const heavy = new Set();
    for (const s of red) {
      if (s.launcher) heavy.add(s.launcher.name);
      if (s.billet === 'MG' || s.billet === 'AR' || s.billet === 'MM') heavy.add(s.weapon.name);
    }
    for (const w of count.keys()) if (w !== main && heavy.size < 3) heavy.add(w);
    heavy.delete(main);
    const shown = shuffle([...heavy]).slice(0, 2).map(w => art(noun.get(w) || w));
    const near = this.placeNear(G.enemyArea, 450);
    const where = near ? (near.kind === 'village' ? 'in the buildings of ' + near.name : 'around ' + near.name) : 'in the open ground near the grid';
    const dirTo = compassWord(bearing(G.enemyArea.x, G.enemyArea.y, centroid(G.squads.blue.all).x, centroid(G.squads.blue.all).y));
    const M = G.mission, D = M.def, sz = intelSize(n, M.kind);
    return {
      size: sz.text + ' ' + sz.note,
      sizeReport: sz,
      activity: D.activity(M.site, dirTo),
      location: 'Vicinity grid ' + gridRef(this.reported.x, this.reported.y) + ' (report accurate to about 100 m).',
      unit: forceInfo(M.kind).unit + (M.hvt ? (M.scenario && M.scenario.hvt ? ' ' + M.hvt.title + ' is reported with them.' : ' A commander is with them.') : ''),
      time: 'Observed ' + randInt(15, 40) + ' minutes before this order.',
      equipment: plural(noun.get(main) || main).replace(/^./, c => c.toUpperCase()) + (shown.length ? ', ' + shown.join(' and ') : '') + '. Other weapons are possible.',
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
    const M = G.mission, lk = M.def.likely, esc = M.escape || M.evacAt || M.leaveAt;
    return [
      ['Defend', lk === 'Defend' ? 'Most likely. Will fight from where it is' + (M.digIn ? ', improving its positions while you plan.' : '.') : 'Can go to ground and defend if it is fired on first.', lk === 'Defend'],
      ['Reinforce', 'No other enemy is known in the AO. Reinforcement is unlikely.', false],
      ['Attack', lk === 'Attack' ? 'Most likely. Will keep moving and attack on contact.' : 'Could counterattack your flank with one group if your assault stalls.', lk === 'Attack'],
      ['Withdraw', lk === 'Withdraw' ? 'Most likely. Will break contact and make for the edge of the sheet as soon as it is found.'
        : esc ? 'Means to get away: ' + (M.evacAt ? 'it expects to be gone by about H+' + Math.round(M.evacAt / 60) + '.' : 'it is leaving the area.') : 'Likely to break contact once it loses about half its men.', lk === 'Withdraw'],
      ['Delay', 'Could delay from the next covered position if pressed.', false],
    ];
  },

  missionText() {
    const gr = gridRef(this.reported.x, this.reported.y), near = this.intel.near;
    const purpose = near ? (near.kind === 'village' ? 'secure the village of ' + near.name : near.kind === 'farm' ? 'secure ' + near.name : 'seize ' + near.name)
      : 'clear the area for the company';
    const M = G.mission;
    return G.squads.blue.name + ' ' + M.def.task(M.site, gr, M) + (M.evacAt || M.leaveAt || G.mode === 'meeting' ? '' : ', NLT H+' + Math.round(this.timeAvail / 60)) + '.';
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
    if (G.mission && G.mission.def.draft === 'defense') return this.draftDefense();
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

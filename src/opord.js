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
    $('opordTab').addEventListener('click', () => this.show(this.tab));
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
  // Minimize to the right edge. While planning, a small tool palette stays on the map.
  hide() {
    this.open = false;
    $('opord').hidden = true;
    document.body.classList.remove('opord-open');
    if (!Plan.planning) { Plan.tool = null; Plan.plStart = null; }
    this.refreshPalette();
  },

  // Buttons for placing control measures, shared by Execution and the tool palette.
  toolButtons(box) {
    for (const [label, kinds] of GRAPHIC_GROUPS) {
    const row = el('div', 'tgroup');
    row.appendChild(el('span', 'tglab', label));
    const tools = el('div', 'otools');
    row.appendChild(tools);
    for (const k of kinds) {
      const K = GRAPHIC_KINDS[k];
      const b = el('button', 'obtn' + (Plan.tool === k ? ' on' : ''), K.short);
      b.title = 'Place a ' + K.label.toLowerCase();
      b.addEventListener('click', () => {
        Plan.tool = Plan.tool === k ? null : k; Plan.plStart = null; Plan.routeDraft = null; Plan.routeUnit = null;
        if (Plan.tool) G.toast(K.multi ? 'Tap each waypoint of the route, then Finish route.' : K.line ? 'Tap one end of the ' + K.label.toLowerCase() + ' on the map.' : 'Tap the map to place the ' + K.label.toLowerCase() + '. Each tap places another; tap ' + K.short + ' again to stop.');
        this.refresh();
      });
      tools.appendChild(b);
    }
    box.appendChild(row);
    }
    if (Plan.tool === 'rte') {
      const r = el('div', 'otools');
      const fin = el('button', 'obtn primary', 'Finish route (' + (Plan.routeDraft ? Plan.routeDraft.length : 0) + ' points)');
      fin.addEventListener('click', () => Plan.finishRoute());
      const cancel = el('button', 'obtn', 'Cancel');
      cancel.addEventListener('click', () => { Plan.routeDraft = null; Plan.tool = null; Plan.routeUnit = null; this.refresh(); });
      r.appendChild(fin); r.appendChild(cancel);
      box.appendChild(r);
    }
  },

  // The compact palette shown on the map while planning with the order minimized.
  refreshPalette() {
    const pal = $('toolPalette'), tab = $('opordTab');
    const running = G.running && G.squads.blue && !G.over;
    tab.hidden = !running || this.open;
    const show = running && Plan.planning && !this.open;
    pal.hidden = !show;
    document.body.classList.toggle('palette-open', show);
    if (!show) return;
    pal.innerHTML = '';
    const head = el('div', 'palhead');
    head.appendChild(el('span', 'palclock', Plan.countdown()));
    const go = el('button', 'obtn primary mini', 'Step off');
    go.addEventListener('click', () => { Plan.stepOffNow(); this.show('T'); UI.refreshBar(); });
    head.appendChild(go);
    pal.appendChild(head);
    pal.appendChild(el('div', 'olabel', 'Add to the map'));
    this.toolButtons(pal);
    const g = Plan.graphic(Plan.selected);
    if (g) {
      const row = el('div', 'osel');
      row.appendChild(el('b', null, g.name));
      const edit = el('button', 'obtn mini', 'Edit');
      edit.addEventListener('click', () => this.show('E'));
      const del = el('button', 'obtn mini', 'Delete');
      del.addEventListener('click', () => { Plan.removeGraphic(g.id); this.refresh(); });
      row.appendChild(edit); row.appendChild(del);
      pal.appendChild(row);
    }
    const open = el('button', 'obtn mini', '◀ Open the order');
    open.addEventListener('click', () => this.show('E'));
    pal.appendChild(open);
  },

  refresh() {
    if (!this.built || !G.squads.blue) return;
    document.querySelectorAll('.otab').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === this.tab);
      b.hidden = b.dataset.tab === 'T' && Plan.planning;
    });
    $('btnStepOff').hidden = !Plan.planning;
    this.refreshPalette();
    if (!this.open) return;
    const body = $('opordBody');
    body.innerHTML = '';
    ({ O: this.orientation, S: this.situation, M: this.mission, E: this.execution, A: this.admin, C: this.command, T: this.tracker })[this.tab].call(this, body);
    this.refreshClock();
  },

  refreshClock() {
    const pc = document.querySelector('#toolPalette .palclock');
    if (pc && Plan.timeAvail) pc.textContent = Plan.countdown();
    const box = $('planClock');
    if (!Plan.timeAvail) { box.textContent = ''; return; }
    if (!Plan.planning) {
      box.innerHTML = '';
      box.appendChild(el('span', 'pcl', 'H+' + fmtClock(G.time - Plan.stepOff)));
      box.appendChild(el('span', 'pcs', 'Planning took ' + fmtClock(Plan.planUsed)));
      return;
    }
    const used = G.time - Plan.planStart, third = Plan.timeAvail / 3, left = third - used;
    box.innerHTML = '';
    const big = el('span', 'pcl', left >= 0 ? 'Plan ' + fmtClock(left) + ' left' : 'Over by ' + fmtClock(-left));
    if (left < 0) big.classList.add('over');
    box.appendChild(big);
    box.appendChild(el('span', 'pcs', 'Time available: ' + fmtClock(Math.max(0, Plan.timeAvail - used)) + ' of ' + fmtClock(Plan.timeAvail) + ' left'));
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

  // The plan's grade: a checklist, the score and what it does to the squad's confidence.
  gradeCard(box, final) {
    const card = el('div', 'ograde');
    const score = final && Plan.score != null ? Plan.score : Plan.gradeScore();
    const head = el('div', 'ogradehead');
    head.appendChild(el('b', 'oletter', Plan.letter(score)));
    const t = el('div');
    t.appendChild(el('span', 'ogradet', (final ? 'Plan grade ' : 'Plan grade if you step off now ') + Math.round(score) + '/100'));
    const conf = final ? Plan.confName() : (score >= 85 ? 'high' : score >= 65 ? 'steady' : score >= 40 ? 'uncertain' : 'shaken');
    t.appendChild(el('span', 'ogradec', 'Squad confidence: ' + conf + '. Confidence steadies the men under fire, keeps them from breaking, and speeds their answer to radio orders.'));
    head.appendChild(t);
    card.appendChild(head);
    const ul = el('ul', 'ochecks');
    for (const [label, v, w] of Plan.gradeItems()) {
      const li = el('li', v >= 1 ? 'ok' : v > 0 ? 'part' : 'no');
      li.appendChild(el('span', 'ock', v >= 1 ? '✓' : v > 0 ? '½' : '✗'));
      li.appendChild(el('span', null, label));
      li.appendChild(el('span', 'ocw', Math.round(v * w) + '/' + w));
      ul.appendChild(li);
    }
    card.appendChild(ul);
    box.appendChild(card);
  },

  // ------------------------------------------------------------ 1. Orientation
  orientation(box) {
    const f = Plan.terrainFacts(), m = G.map;
    const ao = Plan.ao, two = (v) => String(v).padStart(2, '0');
    this.para(box, 'Orientation', 'AO is ' + MAP_W / 1000 + ' × ' + MAP_H / 1000 + ' km, grid ' + two(ao.e0) + '–' + two(ao.e0 + MAP_W / 1000) + ' E, ' + two(ao.n0) + '–' + two(ao.n0 + MAP_H / 1000) + ' N. ' +
      m.R.brief + ' Elevation ' + ao.lo + '–' + ao.hi + ' m. North up. CI ' + m.ci + ' m, index ' + m.ci * m.index + ' m.');

    box.appendChild(el('h4', null, 'Obstacles and restrictive terrain'));
    if (ao.river) {
      const rv = ao.river, xs = [...rv.bridges.map(b => 'bridge ' + gridRef(b.x, b.y)), ...rv.fords.map(fd => 'ford ' + gridRef(fd.x, fd.y))];
      const a = rv.pts[0], b = rv.pts[rv.pts.length - 1], brg = bearing(a.x, a.y, b.x, b.y);
      const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
      this.factRow(box, rv.name, 'Flows ' + dirs[Math.round(brg / 45) % 8] + ' across the AO, ' + Math.round(rv.width) + ' m wide. Unfordable on foot except at the fords. ' +
        (xs.length ? 'Crossings: ' + xs.join(', ') + '.' : 'No crossings on the sheet.') +
        (f.river ? ' The direct line crosses it.' : ' It does not cross the direct line.'), rv.bridges[0] || rv.fords[0] || rv.pts[Math.floor(rv.pts.length / 2)], 1.4);
    }
    if (ao.swampPct > 0.1) this.factRow(box, 'Swamp', Math.max(0.1, ao.swampPct).toFixed(1) + '% of the AO, low ground by the water; largest vic grid ' + gridRef(ao.swampAt.x, ao.swampAt.y) +
      '. Very slow going, no cover, good concealment.' + (f.swampM ? ' About ' + Math.round(f.swampM / 10) * 10 + ' m of it on the direct line.' : ''), ao.swampAt, 1.4);
    const pc = (k) => ao.pct(k), pf = (k) => (pc(k) < 1 ? pc(k).toFixed(1) : Math.round(pc(k))) + '% of the AO';
    const sea = (m.R.sea || 'Pacific Ocean').toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
    if (pc(TER.OCEAN) > 0.5 && m.R.island) this.factRow(box, sea, 'All round the island. Impassable. The beach (' + pf(TER.BEACH).replace(' of the AO', '') + ') is coral sand, slow and wide open; there is nowhere to go but across the island.', { x: MAP_W / 2, y: MAP_H * 0.08 }, 0.5);
    else if (pc(TER.OCEAN) > 0.5) this.factRow(box, sea, 'The west edge of the AO. Impassable. The beach (' + pf(TER.BEACH).replace(' of the AO', '') + ') is soft sand, slow and wide open to the bluffs above it.', { x: G.map.coastAt(0.5) / 2, y: MAP_H / 2 }, 0.5);
    if (pc(TER.PADDY) > 2) this.factRow(box, 'Rice paddies', pf(TER.PADDY) + '. Flooded fields, knee-deep mud: very slow going, no cover in the open paddy. The dikes between them, a meter high, are the only cover and the only fast way across.', null);
    if (pc(TER.CHAPARRAL) > 1) this.factRow(box, 'Chaparral', pf(TER.CHAPARRAL) + '. Dense, head-high brush on the slopes. Very slow going; hides men, stops no rounds.', null);
    if (pc(TER.BRUSH) > 1) this.factRow(box, 'Mesquite brush', pf(TER.BRUSH) + '. Thorn thickets two to three meters high. Slow; good concealment, no cover, short fields of fire inside.', null);
    if (pc(TER.DESERT) > 5) this.factRow(box, 'Desert', pf(TER.DESERT) + '. Open desert floor with scattered creosote. Fast going, long fields of fire, little concealment.', null);
    if (pc(TER.ROCK) > 0.5) this.factRow(box, 'Rock', pf(TER.ROCK) + '. Outcrops and talus on the steep slopes and crests. Very slow going; boulders give real cover.', null);
    if (pc(TER.SNOW) > 5) this.factRow(box, 'Deep snow', pf(TER.SNOW) + '. Snow over all open ground: about half walking speed and tiring. No concealment; tracks show.', null);
    if (pc(TER.ICE) > 0.05) this.factRow(box, 'Frozen ponds', 'The ice bears a man: slow footing and wide open.', null);
    if (ao.ponds.length) {
      const big = ao.ponds[0];
      this.factRow(box, 'Ponds', ao.ponds.length + ' on the sheet. Impassable on foot; go around. Largest ' + big.ha.toFixed(1) + ' ha vic grid ' + gridRef(big.x, big.y) + '.', big, 1.4);
    }
    if (m.R.dryStreams) this.factRow(box, 'Dry washes', ao.streams + ' on the sheet, ' + (f.streams ? f.streams + ' across your axis' : 'none across your axis') +
      '. Sandy beds cut below the ground around them: covered routes, but a flash flood after rain.', null);
    else this.factRow(box, 'Streams', ao.streams + ' on the sheet, ' + (f.streams ? f.streams + ' across your axis' : 'none across your axis') +
      '. Fordable, at about a third of walking speed. The gullies give cover.', null);
    if (ao.woodsPct >= 1) this.factRow(box, 'Woods', ao.woodsPct + '% of the AO' + (pc(TER.ORCHARD) > 0.5 ? ', with orchards' : '') + '. Slow going, short fields of fire, good concealment.', null);
    if (ao.steepPct > 0.5) this.factRow(box, 'Steep ground', 'Slopes over 30% on ' + ao.steepPct.toFixed(1) + '% of the AO; steepest vic grid ' + gridRef(ao.worst.x, ao.worst.y) + '. Slow to climb.', ao.worst, 1.6);
    if (ao.villages.length) this.factRow(box, 'Built-up', ao.villages.map(v => v.name.toUpperCase() + ' (' + gridRef(v.x, v.y) + ')').join(', ') + (ao.farms ? '; ' + ao.farms + ' ' + farmNoun(m.R).toLowerCase() + (ao.farms > 1 ? (farmNoun(m.R) === 'Ranch' ? 'es' : 's') : '') : '') + '. ' + (pc(TER.WALL) > 0.05 ? 'Stone walls and buildings' : 'Buildings') + ': hard cover for a defender.', ao.villages[0], 1.6);

    box.appendChild(el('h4', null, 'Avenues of approach'));
    if (ao.road) this.factRow(box, 'Paved road', ao.road.text + ' Fastest going, open to observation.', ao.road.at, 1.4);
    if (ao.tracks) this.factRow(box, 'Tracks', ao.tracks + ' dirt tracks link the farms and villages to the road.', null);
    this.factRow(box, 'Direct line', f.woodsPct + '% woods or orchard, ' + (f.streams ? f.streams + ' stream crossing' + (f.streams > 1 ? 's' : '') : 'no streams') + (f.river ? ', the river' : '') + (f.roads ? ', ' + f.roads + ' road crossing' + (f.roads > 1 ? 's' : '') : '') + '.', null);

    box.appendChild(el('h4', null, 'Positions'));
    this.factRow(box, 'You', 'Grid ' + gridRef(f.b.x, f.b.y) + ', elevation ' + Math.round(m.elevBase + m.elevAt(f.b.x, f.b.y)) + ' m.', f.b, 2.2);
    this.factRow(box, 'Enemy', 'Reported at grid ' + gridRef(f.e.x, f.e.y) + ': bearing ' + pad3(bearing(f.b.x, f.b.y, f.e.x, f.e.y)) + '°, ' + Math.round(f.d / 10) * 10 + ' m.', f.e, 1.6);
    this.factRow(box, 'High ground', Math.round(m.elevBase + f.hi.e) + ' m at grid ' + gridRef(f.hi.x, f.hi.y) + ', the highest point on the direct line. Ground that overlooks the objective is key terrain.', f.hi, 1.6);
    box.appendChild(el('h4', null, 'Key terrain'));
    const tog = el('label', 'otoggle');
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'showTerrain'; cb.checked = Plan.showTerrain;
    cb.addEventListener('change', () => { Plan.showTerrain = cb.checked; });
    tog.appendChild(cb); tog.appendChild(el('span', null, 'Mark key terrain on the map (circled K)'));
    box.appendChild(tog);
    for (const k of Plan.terrain.filter(t => t.kind === 'hill' || t.kind === 'town')) {
      this.factRow(box, k.name, k.note + ', grid ' + gridRef(k.x, k.y) + '.', k, 1.6);
    }
    const all = el('button', 'obtn', 'Show both positions');
    all.addEventListener('click', () => {
      const z = Math.min(R.w / (Math.abs(f.e.x - f.b.x) + 500), (R.h - 260) / (Math.abs(f.e.y - f.b.y) + 500));
      this.focus((f.b.x + f.e.x) / 2, (f.b.y + f.e.y) / 2, z);
    });
    box.appendChild(all);
  },

  // ------------------------------------------------------------ 2. Situation
  situation(box) {
    const i = Plan.intel, sc = G.mission.scenario;
    if (sc && sc.history) this.para(box, sc.label.replace(/^\d+ · /, '') + ' (' + sc.status.toLowerCase() + ')', sc.date + ', ' + sc.place + '. ' + sc.history);
    this.para(box, 'Enemy forces: SALUTE', G.mission.label + '.');
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
    const bq = G.squads.blue;
    this.para(box, 'Friendly forces', (bq.kind !== 'usmc' ? forceInfo(bq.kind).unit + ' ' : '') + 'No higher or adjacent units are near you, and there is no indirect fire support. ' + bq.name + ' is on its own.');
    this.para(box, 'Enemy doctrine', AI.D.label + '.');
    const M = G.mission, why = M.evacAt ? (M.key === 'helo' ? 'the pickup is expected then' : 'the truck should be running by then') : M.leaveAt ? 'the enemy should move on about then'
      : G.mode === 'meeting' ? 'the enemy could reach you by then' : M.digIn ? 'the enemy will have finished digging in by then' : 'the enemy may move by then';
    this.para(box, 'Time available', fmtClock(Plan.timeAvail) + ' (' + why +
      '). Use one third to plan; leave two thirds to the fire teams. The clock is running at ' + PLAN_RATE + '× while you plan.');
  },

  // ------------------------------------------------------------ 3. Mission
  mission(box) {
    this.para(box, 'Mission', null);
    box.appendChild(el('blockquote', 'omission', Plan.missionText()));
    this.para(box, null, 'Who, what, when, where and why, in one sentence. Everything in the plan serves it.');
  },

  // ------------------------------------------------------------ 4. Execution
  // Plain definitions of the control measures, tasks, triggers and signals. It stays open
  // or closed across redraws.
  cheatOpen: false,
  cheatSheet(box) {
    const d = el('details', 'cheat');
    d.open = this.cheatOpen;
    d.addEventListener('toggle', () => { this.cheatOpen = d.open; });
    d.appendChild(el('summary', null, 'Cheat sheet: control measures, tasks, triggers'));
    const sec = (title, rows) => {
      d.appendChild(el('h5', null, title));
      const t = el('dl');
      for (const [k, v] of rows) { t.appendChild(el('dt', null, k)); t.appendChild(el('dd', null, v)); }
      d.appendChild(t);
    };
    sec('Points (one tap)', [
      ['CP · Checkpoint', 'A point on the ground to control and report movement. A unit sent here moves to it and waits for its next line.'],
      ['RP · Release point', 'Where the squad splits and the fire teams go to their own tasks.'],
      ['RLY PT · Rally point', 'Where the squad regroups if it is scattered.'],
      ['CCP · Casualty collection point', 'Where wounded are brought for treatment and evacuation.'],
      ['TRP · Target reference point', 'A marked point that fire can be put onto quickly. Units sent to it suppress it.'],
      ['FP · Fighting position', 'A defensive position with a sector of fire (set its center and width when selected).'],
      ['SBF · Support by fire', 'Where the base of fire sets in to fire onto the objective and cover the assault.'],
    ]);
    sec('Lines (two taps; a route, a tap per waypoint)', [
      ['PL · Phase line', 'A line across the ground; crossing it is reported. Used to control and time the movement.'],
      ['LOA · Limit of advance', 'No one goes past it. Stops the assault from running on into the open or into friendly fire.'],
      ['RTE · Route', 'A path of waypoints. The unit follows it instead of the shortest way: use it to stay in a draw or behind a tree line.'],
    ]);
    sec('Areas (one tap at the center)', [
      ['OBJ · Objective', 'The ground or enemy position to be seized or cleared.'],
      ['ASLT POS · Assault position', 'The last covered ground short of the objective, where the assault element shakes out and waits for the signal.'],
      ['AA · Assembly area', 'Where the squad starts and prepares. Drawn for you at the start.'],
    ]);
    sec('Tasks (plan lines)', [
      ['Move to', 'Go to the point in the chosen mode: walk, rush or crawl.'],
      ['Move along route', 'Follow a route to its end.'],
      ['Bound to', 'Bounding overwatch: one element moves while another covers, then they swap. Slower, but covered.'],
      ['Support by fire from', 'Move to the SBF, then fire onto the target until told to lift.'],
      ['Suppress', 'Area fire on a point to keep the enemy\'s heads down.'],
      ['Assault', 'Close with the enemy and fight through the objective to the LOA.'],
      ['Occupy fighting position', 'Move into an FP and cover its sector.'],
      ['Lift fire and hold', 'Cease fire (or shift it) so the assault is not hit, and hold in place.'],
      ['Halt and hold', 'Stop where the unit is and hold.'],
      ['Fire signal', 'The squad leader fires a star cluster; lines waiting on it start.'],
    ]);
    sec('Triggers (when a line starts)', [
      ['At step-off', 'As soon as the plan runs.'],
      ['After the line above', 'When the line above is finished.'],
      ['With the line above', 'At the same moment as the line above.'],
      ['On signal', 'When that star cluster is fired.'],
      ['At H+ minutes', 'That many minutes after step-off.'],
      ['On enemy contact', 'When the squad first makes contact.'],
    ]);
    sec('Signals', Object.values(SIGNALS).map(s => [s.label, s.meaning + '.']));
    sec('Map menu', [
      ['Tap the map', 'With a unit selected, opens a menu that places a measure at that spot and adds the line for that unit.'],
      ['Tool buttons', 'Place measures without a line. A tool stays on: tap again for another, tap its button or Esc to stop.'],
    ]);
    box.appendChild(d);
  },
  execution(box) {
    this.para(box, 'Execution', 'Draw control measures on the map, then write the scheme of maneuver line by line. After you step off each line starts on its trigger, and your orders go by radio. A better plan makes a more confident squad.');
    this.gradeCard(box, false);
    this.toolButtons(box);
    const acts = el('div', 'otools');
    const draft = el('button', 'obtn', 'Draft a plan');
    draft.title = 'Replace the plan with a hasty attack drawn from the map';
    draft.addEventListener('click', () => { Plan.draft(); G.toast('Draft plan drawn. Check it against the ground and change what you like.'); });
    acts.appendChild(draft);
    const clear = el('button', 'obtn', 'Clear all');
    clear.addEventListener('click', () => { Plan.graphics = []; Plan.lines = []; Plan.selected = null; this.refresh(); });
    if (Plan.planning) acts.appendChild(clear);
    box.appendChild(acts);
    this.cheatSheet(box);

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
      if (g.kind === 'fp') {
        // Sector of fire: center bearing and width.
        const sec = el('div', 'osel');
        sec.appendChild(el('span', null, 'Sector center'));
        const brg = el('input'); brg.type = 'number'; brg.min = 0; brg.max = 359; brg.id = 'fpbrg-' + g.id;
        brg.value = Math.round(((g.dir * 180 / Math.PI) + 90 + 360) % 360);
        brg.addEventListener('change', () => { g.dir = ((parseInt(brg.value, 10) || 0) - 90) * Math.PI / 180; this.refresh(); });
        sec.appendChild(brg); sec.appendChild(el('span', null, '° width'));
        const wd = el('select'); wd.id = 'fpw-' + g.id;
        for (const deg of [45, 60, 90, 120, 180]) { const o = el('option', null, deg + '°'); o.value = deg; if (Math.round(g.width * 180 / Math.PI) === deg) o.selected = true; wd.appendChild(o); }
        wd.addEventListener('change', () => { g.width = Number(wd.value) * Math.PI / 180; });
        sec.appendChild(wd);
        box.appendChild(sec);
      }
    } else {
      box.appendChild(el('p', 'onote', 'Drag a control measure to move it; tap it to rename or delete it.'));
    }

    // Lines
    box.appendChild(el('h4', null, 'Scheme of maneuver'));
    const pointGraphics = Plan.graphics.filter(x => !GRAPHIC_KINDS[x.kind].line);
    const whereFor = (T) => T.whereKinds ? Plan.graphics.filter(x => T.whereKinds.includes(x.kind)) : pointGraphics;
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
      if (T.where) row2.appendChild(sel([['', 'where…'], ...whereFor(T).map(x => [x.id, x.name])], l.where || '', v => { l.where = v ? Number(v) : null; }, 'lwhere-' + l.id));
      if (T.target) row2.appendChild(sel([['', 'target…'], ...pointGraphics.map(x => [x.id, x.name])], l.target || '', v => { l.target = v ? Number(v) : null; }, 'ltgt-' + l.id));
      if (T.signal) row2.appendChild(sel(Object.entries(SIGNALS).map(([k, s]) => [k, s.label]), l.signal, v => { l.signal = v; }, 'lsigt-' + l.id));
      if (l.task === 'move' || l.task === 'sbf' || l.task === 'route') row2.appendChild(sel(Object.entries(MOVE).map(([k, m]) => [k, m.label]), l.mode, v => { l.mode = v; }, 'lmode-' + l.id));
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
    const bq = G.squads.blue;
    this.para(box, 'Administration and logistics', 'No resupply. Every man carries the basic load below. Casualties go to the casualty collection point (CCP); place one in Execution. Redistribute ammunition at the CCP if the fight runs long.');
    if (bq.kind !== 'usmc') UI.renderEraLoadout(box, bq);
    else if (Plan.planning) UI.renderLoadout(box, () => applyLoadout(G.squads.blue, G.settings.loadout));
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
    this.gradeCard(box, true);
    if (Radio.queue.length) box.appendChild(el('p', 'onote', 'Radio: ' + Radio.queue.length + ' order' + (Radio.queue.length > 1 ? 's' : '') + ' awaiting acknowledgment.'));
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

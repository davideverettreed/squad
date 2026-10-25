'use strict';
// Game state, mission setup and the main loop.

const G = {
  map: null, squads: {}, soldiers: [], byId: new Map(),
  known: { blue: new Map(), red: new Map() },
  effects: [], projectiles: [], floaters: [], controllers: [],
  time: 0, paused: true, speed: 1, running: false, over: false,
  spotT: 0, teamT: 0, endT: 0,
  stats: null, grid: { e: 34, n: 72 }, revealAll: false,
  settings: null,
  ui: { sel: null, pending: null, moveMode: 'walk', hover: null, hoverIsPointer: false, panelH: 0 },
  log(msg, kind) { UI.log(msg, kind); },
  toast(msg) { UI.toast(msg); },
};

function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('squad.settings') || 'null'); } catch (e) { saved = null; }
  const s = { seed: Math.floor(Math.random() * 99999) + 1, mode: 'random', loadout: defaultLoadout() };
  if (saved && saved.loadout) {
    for (const k of Object.keys(s.loadout)) {
      const l = saved.loadout[k];
      if (l && WEAPONS[l.weapon] && USMC_BILLETS[k].weapons.includes(l.weapon)) Object.assign(s.loadout[k], l);
    }
    if (saved.mode) s.mode = saved.mode;
  }
  return s;
}
function saveSettings() {
  try { localStorage.setItem('squad.settings', JSON.stringify({ mode: G.settings.mode, loadout: G.settings.loadout })); } catch (e) { /* storage unavailable */ }
}

function newMission() {
  const set = G.settings;
  saveSettings();
  NEXT_ID = 1;
  G.map = new GameMap(set.seed);
  // Grid: a small 100 km digit and two principal digits for each kilometer line.
  G.grid = { e: randInt(10, 85), n: randInt(10, 85), le: randInt(1, 8), ln: randInt(1, 8) };
  const blue = buildUSMCSquad(set.loadout);
  const red = buildOpforSquad();
  G.squads = { blue, red };
  const mode = set.mode === 'random' ? (chance(0.5) ? 'attack' : 'meeting') : set.mode;
  G.mode = mode;

  // The squads start about a kilometer apart, on a random axis.
  const axis = randRange(0, Math.PI * 2), sep = randRange(900, 1150);
  const mid = { x: MAP_W / 2 + randRange(-400, 400), y: MAP_H / 2 + randRange(-400, 400) };
  const bx = clamp(mid.x - Math.cos(axis) * sep / 2, 250, MAP_W - 250), by = clamp(mid.y - Math.sin(axis) * sep / 2, 250, MAP_H - 250);
  const toEnemy = axis;
  placeSquad(blue, G.map, bx, by, toEnemy);
  const blueStart = { x: bx, y: by };
  let rx = clamp(bx + Math.cos(axis) * sep, 250, MAP_W - 250), ry = clamp(by + Math.sin(axis) * sep, 250, MAP_H - 250);

  if (mode === 'attack') {
    // Defenders hold the nearest village or farm to their area, or the ground where they are.
    const near = G.map.buildings.filter(b => dist((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, rx, ry) < 300);
    if (near.length && chance(0.75)) { const b = pick(near); rx = (b.x0 + b.x1) / 2; ry = (b.y0 + b.y1) / 2; }
    placeSquad(red, G.map, rx, ry, toEnemy + Math.PI);
    setupDefense(red, blueStart);
  } else {
    placeSquad(red, G.map, rx, ry, toEnemy + Math.PI);
  }
  G.enemyArea = { x: rx, y: ry };
  G.axisBearing = bearing(bx, by, rx, ry);

  G.soldiers = [...blue.all, ...red.all];
  G.byId = new Map(G.soldiers.map(s => [s.id, s]));
  G.known = { blue: new Map(), red: new Map() };
  G.effects = []; G.projectiles = []; G.floaters = []; G.controllers = [];
  G.stats = { blue: { light: 0, serious: 0, kia: 0 }, red: { light: 0, serious: 0, kia: 0 } };
  G.time = 0; G.spotT = 0; G.teamT = 0; G.endT = 0;
  G.over = false; G.running = true; G.paused = true;
  G.missionId = (G.missionId || 0) + 1;
  $('debrief').hidden = true;
  G.ui.sel = null; G.ui.pending = null;
  for (const t of [blue.hq, ...blue.teams, red.hq, ...red.teams]) { t.routing = false; t.morale = t.squad.morale; }
  initAI(mode === 'attack' ? 'defend' : 'advance', blueStart);

  buildTerrain(G.map);
  fitCamera(centroid(blue.all), Math.max(R.minZoom, 1.3));
  $('log').innerHTML = '';
  UI.logLines = [];
  UI.buildRoster();
  UI.select({ level: 'squad', squad: blue });
  const gr = gridRef(G.enemyArea.x, G.enemyArea.y);
  G.log(mode === 'attack' ? 'Mission: attack. Enemy squad reported holding near grid ' + gr + ', bearing ' + pad3(G.axisBearing) + '.'
    : 'Mission: meeting engagement. Enemy squad reported near grid ' + gr + ', bearing ' + pad3(G.axisBearing) + ', moving toward you.', 'info');
  G.log('Paused. Give your orders, then press Resume.', 'info');
  UI.refreshBar();
}

// ---------------------------------------------------------------- morale and routing
// A broken team falls back about 400 m away from the enemy and is out of the fight.
function routePoint(s) {
  const t = threatCentroid(s.side, [s]);
  const a = angleTo(t.x, t.y, s.x, s.y);
  return { x: clamp(s.x + Math.cos(a) * 400, 20, MAP_W - 20), y: clamp(s.y + Math.sin(a) * 400, 20, MAP_H - 20) };
}

function startRouting(team, reason) {
  if (team.routing) return;
  team.routing = true; team.routeReason = reason;
  for (const s of team.members) {
    if (!s.active) continue;
    s.routing = true; s.assault = false; s.suppressPt = null; s.launchQueue = null;
    s.routeTo = routePoint(s);
    s.path = G.map.findPath(s.x, s.y, s.routeTo.x, s.routeTo.y) || [];
    s.moveMode = 'rush';
  }
  releaseControllers(team.members);
  if (team.side === 'blue' && team.members.some(s => s.active)) G.log(team.name + ' has broken and is falling back!', 'loss');
}

function rally(team) {
  team.routing = false;
  for (const s of team.members) if (s.routing && !s.routed) { s.routing = false; s.routeTo = null; s.path = []; s.homePosture = 'prone'; }
  if (team.side === 'blue') G.log(team.name + ' has rallied.', 'info');
}

function updateTeams(dt) {
  for (const sq of [G.squads.blue, G.squads.red]) {
    for (const t of [sq.hq, ...sq.teams]) {
      const quiet = G.time - t.lastFiredUpon;
      if (quiet > 10) t.morale = Math.min(sq.morale, t.morale + 0.6 * dt);
      if (!t.routing && t.broken && t.members.some(s => s.active)) startRouting(t, 'break');
      if (t.routing && t.routeReason === 'break' && t.morale > 35 && quiet > 15) rally(t);
      for (const s of t.members) {
        if (!s.routing || s.routed || !s.active) continue;
        if (!s.routeTo) s.routeTo = routePoint(s);
        if (dist(s.x, s.y, s.routeTo.x, s.routeTo.y) < 8) { s.routed = true; s.path = []; }
        else if (!s.moving) { s.path = G.map.findPath(s.x, s.y, s.routeTo.x, s.routeTo.y) || []; s.moveMode = 'rush'; }
      }
    }
  }
}

function inCover(s) {
  const k = G.map.terAt(s.x, s.y);
  if (k === TER.WOODS || k === TER.STREAM) return true;
  const o = CELL * 0.8;
  for (const [dx, dy] of [[o, 0], [-o, 0], [0, o], [0, -o]]) {
    const n = G.map.terAt(s.x + dx, s.y + dy);
    if (n === TER.WALL || n === TER.BUILDING) return true;
  }
  return k === TER.GRASS && s.posture === 'prone';
}

function updateSuppression(s, dt) {
  if (!s.active) { s.supp = 0; return; }
  let rate = inCover(s) ? 14 : 9;
  const lead = s.team.leader;
  if (!lead || (lead.billet !== 'TL' && lead.billet !== 'SL')) rate *= 0.8;
  rate *= clamp(s.team.morale / 80, 0.5, 1.2);
  if (G.time - s.team.lastFiredUpon < 1.5) rate *= 0.3;
  s.supp = Math.max(0, s.supp - rate * dt);
}

// ---------------------------------------------------------------- loop
function update(dt) {
  G.time += dt;
  G.spotT -= dt;
  if (G.spotT <= 0) { G.spotT = 0.25; updateSpotting(); }
  for (const c of G.controllers) c.update(dt);
  G.controllers = G.controllers.filter(c => !c.done);
  updateAI(dt);
  for (const s of G.soldiers) {
    if (!s.alive || s.routed) continue;
    updateSuppression(s, dt);
    updateMovement(s, dt);
    updateCombat(s, dt);
  }
  updateProjectiles(dt);
  for (const list of [G.effects, G.floaters]) {
    for (let i = list.length - 1; i >= 0; i--) { list[i].t += dt; if (list[i].t > list[i].life) list.splice(i, 1); }
  }
  G.teamT -= dt;
  if (G.teamT <= 0) { G.teamT = 0.5; updateTeams(0.5); }
  G.endT -= dt;
  if (G.endT <= 0) { G.endT = 1; checkEnd(); }
}

function checkEnd() {
  const up = (sq) => sq.all.some(s => s.active && !s.routing);
  if (!up(G.squads.red)) endMission('victory');
  else if (!up(G.squads.blue)) endMission('defeat');
}

function endMission(result) {
  G.over = true; G.paused = true;
  G.revealAll = true;
  G.log(result === 'victory' ? 'Enemy defeated.' : 'Your squad is combat ineffective.', result === 'victory' ? 'kill' : 'loss');
  const id = G.missionId;
  setTimeout(() => { if (G.missionId !== id) return; UI.showDebrief(result); G.revealAll = false; }, 1200);
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (G.running && !G.paused && !G.over) {
    let sim = dt * G.speed;
    while (sim > 1e-6) { const step = Math.min(0.05, sim); update(step); sim -= step; }
  }
  render();
  UI.tick(dt);
  requestAnimationFrame(frame);
}

// Building a 3 km sheet takes a few seconds; show a notice and let it paint first.
function withLoading(text, fn) {
  $('loading').textContent = text;
  $('loading').hidden = false;
  requestAnimationFrame(() => setTimeout(() => { try { fn(); } finally { $('loading').hidden = true; } }, 30));
}

function boot() {
  G.settings = loadSettings();
  initRender($('view'));
  UI.init();
  Input.init($('view'));
  $('btnBegin').addEventListener('click', () => {
    G.settings.seed = parseInt($('missionSeed').value, 10) || G.settings.seed;
    UI.hideModal('briefing');
    withLoading('Drawing the map sheet…', newMission);
  });
  $('btnAgain').addEventListener('click', () => { $('debrief').hidden = true; withLoading('Drawing the map sheet…', newMission); });
  $('btnNext').addEventListener('click', () => {
    $('debrief').hidden = true;
    G.settings.seed = Math.floor(Math.random() * 99999) + 1;
    UI.showBriefing();
  });
  requestAnimationFrame(frame);
  // Draw a map behind the briefing so the first view is the ground, not a blank table.
  withLoading('Drawing the map sheet…', () => {
    G.map = new GameMap(G.settings.seed);
    buildTerrain(G.map);
    fitCamera(null, R.minZoom);
    UI.showBriefing();
  });
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();

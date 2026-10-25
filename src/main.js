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
  ui: { cones: true, sel: null, pending: null, moveMode: 'walk', hover: null, hoverIsPointer: false, panelH: 0,
    ghostForm: null, measuring: false, tapeStart: null, tapes: [] },
  log(msg, kind) { UI.log(msg, kind); },
  toast(msg) { UI.toast(msg); },
};

function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('squad.settings') || 'null'); } catch (e) { saved = null; }
  const s = { seed: Math.floor(Math.random() * 99999) + 1, mode: 'random', region: 'random', echelon: 'squad', loadout: defaultLoadout() };
  if (saved && saved.loadout) {
    for (const k of Object.keys(s.loadout)) {
      const l = saved.loadout[k];
      if (l && WEAPONS[l.weapon] && USMC_BILLETS[k].weapons.includes(l.weapon)) Object.assign(s.loadout[k], l);
    }
    if (saved.mode) s.mode = saved.mode;
    if (saved.region && (saved.region === 'random' || REGIONS[saved.region])) s.region = saved.region;
  }
  return s;
}
function saveSettings() {
  try { localStorage.setItem('squad.settings', JSON.stringify({ mode: G.settings.mode, region: G.settings.region, loadout: G.settings.loadout })); } catch (e) { /* storage unavailable */ }
}

function newMission() {
  const set = G.settings;
  saveSettings();
  NEXT_ID = 1;
  G.echelon = ECHELONS[set.echelon] || ECHELONS.squad;
  setMapSize(G.echelon.size); resizeSheet();
  G.map = new GameMap(set.seed, set.region);
  // Grid: a small 100 km digit and two principal digits for each kilometer line.
  G.grid = { e: randInt(10, 85), n: randInt(10, 85), le: randInt(1, 8), ln: randInt(1, 8) };
  const blue = buildUSMCSquad(set.loadout);
  const red = buildOpforSquad();
  G.squads = { blue, red };
  const mode = set.mode === 'random' ? (chance(0.5) ? 'attack' : 'meeting') : set.mode;
  G.mode = mode;

  // The sides start apart by the echelon's distance (1.0-1.4 km for squads, beyond spotting range), on a random
  // axis, both well inside the sheet.
  const M = G.echelon.margin, inside = (x, y) => x >= M && y >= M && x <= MAP_W - M && y <= MAP_H - M;
  let axis = 0, sep = G.echelon.sep[0], bx = M, by = M, rx = MAP_W - M, ry = MAP_H - M;
  // Choose the distance first, then find a placement that fits, so long distances are as
  // likely as short ones.
  sep = randRange(G.echelon.sep[0], G.echelon.sep[1]);
  for (let k = 0; k < 2000; k++) {
    axis = randRange(0, Math.PI * 2);
    bx = randRange(M, MAP_W - M); by = randRange(M, MAP_H - M);
    rx = bx + Math.cos(axis) * sep; ry = by + Math.sin(axis) * sep;
    if (inside(rx, ry)) break;
  }
  if (!inside(rx, ry)) { bx = M; by = M; rx = MAP_W - M; ry = MAP_H - M; axis = angleTo(bx, by, rx, ry); }
  const toEnemy = axis;
  placeSquad(blue, G.map, bx, by, toEnemy);
  const blueStart = { x: bx, y: by };

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
  G.over = false; G.running = true; G.paused = false;
  G.missionId = (G.missionId || 0) + 1;
  $('debrief').hidden = true;
  G.ui.sel = null; G.ui.pending = null; G.ui.tapes = []; G.ui.tapeStart = null;
  for (const t of [blue.hq, ...blue.teams, red.hq, ...red.teams]) { t.routing = false; t.morale = t.squad.morale; }
  initAI(mode === 'attack' ? 'defend' : 'advance', blueStart);

  buildTerrain(G.map);
  fitCamera(centroid(blue.all), Math.max(R.minZoom, 1.3));
  $('log').innerHTML = '';
  UI.logLines = [];
  UI.buildRoster();
  UI.select({ level: 'squad', squad: blue });
  Plan.reset();
  Fog.reset();
  for (let k = 0; k < 4; k++) Fog.update();
  Radio.reset();
  OPORD.show('O');
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

// Immediate action on contact: a Marine fire team walking when it takes fire, or when it
// sees a new enemy within 250 m, halts, gets down and returns fire. Rushing, assaulting
// and bounding teams carry on; those orders mean to move under fire.
function reactToContact(t) {
  if (t.routing) return;
  // Teams occupying a support-by-fire position, bounding or assaulting press on, rushing if fired on.
  const walk = (s) => commandable(s) && s.moving && s.moveMode === 'walk' && !s.assault;
  const pressing = t.members.filter(s => walk(s) && Plan.onLine(s, ['sbf', 'bound', 'assault']));
  const firedOn = G.time - t.lastFiredUpon < 1.5;
  if (pressing.length && firedOn && G.time - (t.rushedAt || -99) > 10) {
    t.rushedAt = G.time;
    for (const s of pressing) s.moveMode = 'rush';
    G.log(t.short + ': Taking fire! Rushing to position.', 'contact');
  }
  // A team on a planned move ignores a sighting, but goes to ground when fired on.
  const walking = t.members.filter(s => walk(s) && !pressing.includes(s));
  if (!walking.length) return;
  t.reacted = t.reacted || new Set();
  const underFire = firedOn && G.time - (t.reactedAt || -99) > 20;
  const unplanned = walking.filter(s => !Plan.onLine(s, ['move']));
  const fresh = [...G.known.blue.values()].filter(k => k.visible && !t.reacted.has(k.id) && G.byId.get(k.id)?.active
    && unplanned.some(s => dist(s.x, s.y, k.x, k.y) < 250));
  if (!underFire && !fresh.length) return;
  for (const k of fresh) t.reacted.add(k.id);
  const halt = underFire ? walking : unplanned;
  t.reactedAt = G.time;
  releaseControllers(halt);
  for (const s of halt) { s.path = []; s.homePosture = 'prone'; }
  G.log(t.short + ': ' + (underFire ? 'Taking fire!' : 'Enemy close!') + ' Get down, return fire.', 'contact');
}

function updateTeams(dt) {
  for (const t of [G.squads.blue.hq, ...G.squads.blue.teams]) reactToContact(t);
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
  if (k === TER.WOODS || k === TER.STREAM || k === TER.WASH || k === TER.ROCK) return true;
  const o = CELL * 0.8;
  for (const [dx, dy] of [[o, 0], [-o, 0], [0, o], [0, -o]]) {
    const n = G.map.terAt(s.x + dx, s.y + dy);
    if (n === TER.WALL || n === TER.BUILDING) return true;
  }
  // Low vegetation (grass, scrub, reeds) hides a man who lies down in it.
  return TERRAIN[k].conceal >= 0.45 && s.posture === 'prone';
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
  // While the order is being planned the field is frozen: no one moves or fires. Men still
  // look about and spot, and the clock runs (the enemy's time is accounted at step-off).
  const frozen = Plan.planning;
  if (!frozen) {
    for (const c of G.controllers) c.update(dt);
    G.controllers = G.controllers.filter(c => !c.done);
    updateAI(dt);
  }
  Plan.update(dt);
  Radio.update();
  for (const s of G.soldiers) {
    if (!s.alive || s.routed) continue;
    updateSuppression(s, dt);
    if (!frozen) { updateMovement(s, dt); updateCombat(s, dt); }
    updateLook(s, dt);
  }
  updateProjectiles(dt);
  for (const list of [G.effects, G.floaters]) {
    for (let i = list.length - 1; i >= 0; i--) { list[i].t += dt; if (list[i].t > list[i].life) list.splice(i, 1); }
  }
  G.teamT -= dt;
  if (G.teamT <= 0) { G.teamT = 0.5; updateTeams(0.5); }
  G.ammoT = (G.ammoT || 0) - dt;
  if (G.ammoT <= 0) { G.ammoT = 3; shareAmmo(); }
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
    // While planning the clock runs at a fixed rate; after step-off at the chosen speed.
    let sim = dt * (Plan.planning ? PLAN_RATE : G.speed);
    while (sim > 1e-6) { const step = Math.min(0.05, sim); update(step); sim -= step; }
  }
  Fog.update();
  Nudge.update();
  if (View3D.active) View3D.frame(dt); else render();
  UI.tick(dt);
  requestAnimationFrame(frame);
}

// Building a sheet can take a second or two; show a notice and let it paint first.
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
    setMapSize(ECHELONS[G.settings.echelon].size); resizeSheet();
    G.map = new GameMap(G.settings.seed, G.settings.region);
    buildTerrain(G.map);
    fitCamera(null, R.minZoom);
    UI.showBriefing();
  });
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();

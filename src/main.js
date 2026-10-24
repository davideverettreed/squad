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
  G.grid = { e: randInt(10, 80), n: randInt(20, 90) };
  const blue = buildUSMCSquad(set.loadout);
  const red = buildOpforSquad();
  G.squads = { blue, red };
  const mode = set.mode === 'random' ? (chance(0.5) ? 'attack' : 'meeting') : set.mode;
  G.mode = mode;

  const bx = randRange(70, MAP_W - 70), by = MAP_H - 16;
  placeSquad(blue, G.map, bx, by, -Math.PI / 2);
  const blueStart = { x: bx, y: by - 10 };

  if (mode === 'attack') {
    const north = G.map.buildings.filter(b => (b.y0 + b.y1) / 2 < 105);
    let anchor;
    if (north.length && chance(0.7)) { const b = pick(north); anchor = { x: (b.x0 + b.x1) / 2, y: b.y1 + 4 }; }
    else anchor = { x: randRange(50, MAP_W - 50), y: randRange(30, 60) };
    placeSquad(red, G.map, anchor.x, anchor.y, Math.PI / 2);
    setupDefense(red, blueStart);
  } else {
    placeSquad(red, G.map, randRange(60, MAP_W - 60), 14, Math.PI / 2);
  }

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
  fitCamera(centroid(blue.all));
  $('log').innerHTML = '';
  UI.logLines = [];
  UI.buildRoster();
  UI.select({ level: 'squad', squad: blue });
  G.log(mode === 'attack' ? 'Mission: attack. Enemy reported holding to the north.' : 'Mission: meeting engagement. Enemy reported moving south toward you.', 'info');
  G.log('Paused. Give your orders, then press Resume.', 'info');
  UI.refreshBar();
}

// ---------------------------------------------------------------- morale and routing
function startRouting(team, reason) {
  if (team.routing) return;
  team.routing = true; team.routeReason = reason;
  const edgeY = team.side === 'blue' ? MAP_H - 1 : 1;
  for (const s of team.members) {
    if (!s.active) continue;
    s.routing = true; s.assault = false; s.suppressPt = null; s.launchQueue = null;
    s.path = G.map.findPath(s.x, s.y, s.x, edgeY) || [];
    s.moveMode = 'rush';
  }
  releaseControllers(team.members);
  if (team.side === 'blue' && team.members.some(s => s.active)) G.log(team.name + ' has broken and is falling back!', 'loss');
}

function rally(team) {
  team.routing = false;
  for (const s of team.members) if (s.routing && !s.routed) { s.routing = false; s.path = []; s.homePosture = 'prone'; }
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
        const edgeY = s.side === 'blue' ? MAP_H - 1 : 1;
        if (Math.abs(s.y - edgeY) < 4) { s.routed = true; s.path = []; }
        else if (!s.moving) { s.path = G.map.findPath(s.x, s.y, s.x, edgeY) || []; s.moveMode = 'rush'; }
      }
    }
  }
}

function inCover(s) {
  const k = G.map.terAt(s.x, s.y);
  if (k === TER.WOODS) return true;
  for (const [dx, dy] of [[1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8]]) {
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

function boot() {
  G.settings = loadSettings();
  initRender($('view'));
  UI.init();
  Input.init($('view'));
  $('btnBegin').addEventListener('click', () => {
    G.settings.seed = parseInt($('missionSeed').value, 10) || G.settings.seed;
    UI.hideModal('briefing');
    newMission();
  });
  $('btnAgain').addEventListener('click', () => { $('debrief').hidden = true; newMission(); });
  $('btnNext').addEventListener('click', () => {
    $('debrief').hidden = true;
    G.settings.seed = Math.floor(Math.random() * 99999) + 1;
    UI.showBriefing();
  });
  // Draw a map behind the briefing so the first view is the ground, not a blank screen.
  G.map = new GameMap(G.settings.seed);
  buildTerrain(G.map);
  fitCamera();
  UI.showBriefing();
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();

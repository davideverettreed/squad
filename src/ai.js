'use strict';
// Enemy squad AI. On contact the heaviest group becomes the base of fire and the
// others try to flank and assault. It breaks contact after heavy losses.

const AI = { mode: 'defend', objective: null, contact: false, withdrawing: false, timer: 0, lastContact: -99, routine: null, breakOff: false, escape: null };

function initAI(mode, objective, extra) {
  AI.mode = mode; AI.objective = objective;
  AI.contact = false; AI.withdrawing = false; AI.timer = 2; AI.lastContact = -99;
  AI.routine = extra && extra.routine || null; AI.breakOff = !!(extra && extra.breakOff); AI.escape = extra && extra.escape || null;
  for (const t of [G.squads.red.hq, ...G.squads.red.teams]) t.task = null;
}

// Defenders start dug in: each man takes the best cover near the position.
function setupDefense(sq, threat) {
  const reserved = [];
  for (const s of sq.all) {
    const c = G.map.findCover(s.x, s.y, threat.x, threat.y, 16, reserved);
    reserved.push(c);
    s.x = c.x; s.y = c.y;
    s.homePosture = c.posture; s.posture = c.posture;
    s.facing = angleTo(s.x, s.y, threat.x, threat.y);
    s.faceAngle = s.facing; s.look = s.facing;
  }
}

function aiTakeCover(members, threat) {
  const reserved = [];
  for (const s of members) {
    s.assault = false;
    const c = G.map.findCover(s.x, s.y, threat.x, threat.y, 14, reserved);
    reserved.push(c);
    orderMove(s, c.x, c.y, 'rush');
    s.homePosture = c.posture;
    s.faceAngle = angleTo(c.x, c.y, threat.x, threat.y);
  }
}

function firepower(t) {
  return t.members.reduce((n, s) => n + (s.active ? (s.billet === 'MG' ? 4 : s.billet === 'AR' ? 2.5 : 1) : 0), 0);
}

function assignTasks(sq) {
  const teams = sq.teams.filter(t => t.members.some(commandable)).sort((a, b) => firepower(b) - firepower(a));
  let maneuvers = 0;
  teams.forEach((t, i) => {
    if (i === 0) { t.task = { type: 'base' }; return; }
    const go = t.morale > 45 && (AI.mode === 'advance' ? true : maneuvers === 0 && chance(0.55));
    t.task = go ? { type: 'maneuver', phase: 'start', t0: G.time } : { type: 'hold' };
    if (go) maneuvers++;
  });
  sq.hq.task = { type: 'hold' };
}

// The planning time in a meeting engagement: nothing moves while the order is planned, but
// the enemy has been marching all the while. At step-off it is placed as far along its
// route as it would have walked in that time, at a walk over the ground, stopping short
// of the squad's start so the fight still opens at range.
function advanceDuringPlanning(seconds) {
  const exit = AI.routine && AI.routine.kind === 'exit';
  if ((AI.mode !== 'advance' && !exit) || !AI.objective) return;
  const sq = G.squads.red, act = sq.all.filter(commandable);
  if (!act.length) return;
  // Marching on the squad, it stops 600 m short; leaving the sheet, 300 m short of the edge.
  const goal = exit ? AI.routine.pts[AI.routine.pts.length - 1] : AI.objective, stop = exit ? 300 : 600;
  const c = centroid(act), route = G.map.findPath(c.x, c.y, goal.x, goal.y);
  if (!route || !route.length) return;
  let left = Math.min(seconds * MOVE.walk.speed * 0.8, Math.max(0, dist(c.x, c.y, goal.x, goal.y) - stop));
  if (exit) AI.routine.i = AI.routine.pts.length - 1;
  let px = c.x, py = c.y;
  for (const p of route) {
    const d = dist(px, py, p.x, p.y);
    if (d >= left) { px += (p.x - px) * left / d; py += (p.y - py) * left / d; left = 0; break; }
    left -= d; px = p.x; py = p.y;
  }
  const h = angleTo(px, py, goal.x, goal.y);
  placeSquad(sq, G.map, px, py, h);
  for (const s of sq.all) s.path = [];
}

// The edge of the sheet along a bearing from a point.
function edgeFrom(p, ang) {
  let x = p.x, y = p.y;
  for (let r = 0; r < MAP_W * 2; r += 20) { x = p.x + Math.cos(ang) * r; y = p.y + Math.sin(ang) * r; if (x < 15 || y < 15 || x > MAP_W - 15 || y > MAP_H - 15) break; }
  return { x: clamp(x, 8, MAP_W - 8), y: clamp(y, 8, MAP_H - 8) };
}

// What the enemy does before contact: walk its patrol round or out and back, go from
// place to place with a pause at each, or make its way off the sheet.
function runRoutine(sq, act) {
  const r = AI.routine, movers = r.teams ? r.teams.flatMap(t => t.members.filter(commandable)) : act;
  if (!movers.length || movers.some(s => s.moving)) return;
  if (r.pause > G.time) return;
  if (r.kind === 'exit') {
    if (r.i >= r.pts.length) {
      // Off the sheet: those who made it are gone.
      for (const s of movers) if (dist(s.x, s.y, r.pts[r.pts.length - 1].x, r.pts[r.pts.length - 1].y) < 40) { s.routed = true; s.escaped = true; s.path = []; }
      return;
    }
    const p = r.pts[r.i++];
    for (const s of movers) s.homePosture = 'kneel';
    if (r.teams) for (const t of r.teams) teamMove(t, p.x, p.y, 'walk'); else squadMove(sq, p.x, p.y, 'walk');
    return;
  }
  const p = r.pts[r.i];
  if (r.kind === 'loop') r.i = (r.i + 1) % r.pts.length;
  else if (r.kind === 'shuttle') { if (r.i + r.dir >= r.pts.length || r.i + r.dir < 0) r.dir = -r.dir; r.i += r.dir; }
  else { r.i = (r.i + 1) % r.pts.length; r.pause = G.time + randRange(20, 60); }
  for (const s of movers) s.homePosture = 'kneel';
  if (r.teams) for (const t of r.teams) teamMove(t, p.x + gauss() * 8, p.y + gauss() * 8, 'walk'); else squadMove(sq, p.x, p.y, 'walk');
}

function updateAI(dt) {
  AI.timer -= dt;
  if (AI.timer > 0) return;
  AI.timer = 1.5;
  const sq = G.squads.red;
  const act = sq.all.filter(commandable);
  if (!act.length || AI.withdrawing) return;

  if (sq.active.length / sq.all.length < 0.45) {
    AI.withdrawing = true;
    for (const t of [sq.hq, ...sq.teams]) startRouting(t, 'withdraw');
    if (sq.all.some(s => G.known.blue.get(s.id)?.visible)) G.log('Enemy is breaking contact.', 'kill');
    return;
  }

  const contacts = [...G.known.red.values()].filter(k => G.time - k.t < 30 && G.byId.get(k.id)?.active);
  if (contacts.length) AI.lastContact = G.time;
  const enemyC = contacts.length ? centroid(contacts) : null;

  // Done at the water point (or wherever it stopped): it moves on, away from the squad.
  const M = G.mission;
  if (M && M.leaveAt != null && G.time >= M.leaveAt && !AI.contact && !(AI.routine && AI.routine.kind === 'exit')) {
    M.leaveAt = null;
    for (const s of act) s.relaxed = false;
    const c = centroid(act), b = centroid(G.squads.blue.all), out = edgeFrom(c, angleTo(b.x, b.y, c.x, c.y));
    AI.routine = { kind: 'exit', pts: [out], i: 0, pause: 0 }; AI.escape = out;
    if (sq.all.some(s => G.known.blue.get(s.id)?.visible)) G.log('The enemy is moving off.', 'contact');
  }

  if (!enemyC) {
    if (AI.contact && G.time - AI.lastContact > 40) { AI.contact = false; for (const t of sq.teams) t.task = null; }
    if (!AI.contact && AI.routine) runRoutine(sq, act);
    if (!AI.contact && AI.mode === 'advance' && act.every(s => !s.moving)) {
      const c = centroid(act);
      if (dist(c.x, c.y, AI.objective.x, AI.objective.y) > 15) {
        for (const s of act) { s.homePosture = 'kneel'; }
        squadMove(sq, AI.objective.x, AI.objective.y, 'walk');
      }
    }
    return;
  }

  if (!AI.contact) {
    AI.contact = true;
    // Men at rest come awake.
    for (const s of sq.all) s.relaxed = false;
    // A force out to watch, forage or get away breaks contact and makes for the edge.
    if (AI.breakOff || (AI.routine && AI.routine.kind === 'exit')) {
      const c = centroid(act);
      AI.escape = AI.escape || edgeFrom(c, angleTo(enemyC.x, enemyC.y, c.x, c.y));
      AI.withdrawing = true;
      for (const t of [sq.hq, ...sq.teams]) startRouting(t, 'withdraw');
      return;
    }
    assignTasks(sq);
    if (AI.mode === 'advance') {
      for (const s of act) { s.path = []; }
    }
  }

  for (const t of [sq.hq, ...sq.teams]) {
    const m = t.members.filter(commandable);
    if (!m.length || !t.task) continue;
    runTask(t, m, enemyC);
  }
}

function runTask(t, m, enemyC) {
  const task = t.task;
  const avgSupp = m.reduce((n, s) => n + s.supp, 0) / m.length;

  if (task.type === 'base' || task.type === 'hold') {
    if (!task.covered) { aiTakeCover(m, enemyC); task.covered = true; }
    // Automatic weapons in the base of fire keep rounds on the enemy's last position.
    if (task.type === 'base') {
      for (const s of m) {
        if ((s.billet === 'MG' || s.billet === 'AR') && !s.targetId) s.suppressPt = { x: enemyC.x + gauss() * 4, y: enemyC.y + gauss() * 4 };
      }
    }
    return;
  }

  // Maneuver: flank, then assault. Give up and go to ground when the fire is too heavy.
  if (t.morale < 35 || avgSupp > 65) {
    t.task = { type: 'hold' };
    return;
  }
  const c = centroid(m);
  if (task.phase === 'start') {
    const toUs = angleTo(enemyC.x, enemyC.y, c.x, c.y);
    const options = [1, -1].map(side => {
      const a = toUs + side * Math.PI / 2;
      const x = clamp(enemyC.x + Math.cos(a) * 55 + Math.cos(toUs) * 25, 6, MAP_W - 6);
      const y = clamp(enemyC.y + Math.sin(a) * 55 + Math.sin(toUs) * 25, 6, MAP_H - 6);
      let cover = 0;
      for (let i = 1; i <= 8; i++) {
        const k = G.map.terAt(lerp(c.x, x, i / 8), lerp(c.y, y, i / 8));
        if (TERRAIN[k].conceal >= 0.45 || TERRAIN[k].cover >= 0.3) cover++;
      }
      return { x, y, score: cover + rand() * 2 };
    });
    const p = options[0].score > options[1].score ? options[0] : options[1];
    task.flank = p;
    task.phase = 'flank';
    task.t0 = G.time;
    teamMove(t, p.x, p.y, 'walk');
    return;
  }
  if (task.phase === 'flank') {
    if (m.every(s => !s.moving || s.pinned) || G.time - task.t0 > 70) {
      task.phase = 'assault';
      task.t0 = G.time;
      teamMove(t, enemyC.x, enemyC.y, 'walk');
      for (const s of m) { s.assault = true; s.fireControl = 'free'; }
    }
    return;
  }
  if (task.phase === 'assault') {
    if (m.every(s => !s.moving)) {
      if (dist(c.x, c.y, enemyC.x, enemyC.y) > 20 && G.time - task.t0 < 90) {
        teamMove(t, enemyC.x, enemyC.y, 'walk');
        for (const s of m) s.assault = true;
      } else {
        t.task = { type: 'hold' };
      }
    }
  }
}

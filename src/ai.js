'use strict';
// Enemy AI. On contact the heaviest group becomes the base of fire and the others try to
// flank and assault; it breaks contact after heavy losses. How it does so goes with the
// force's doctrine: redcoats in line, a war party in the woods, a Stoßtrupp, a Soviet
// platoon on line, guerrillas in ambush, a gang with no plan at all.

// hold: the share of the force still fighting below which it breaks contact. maneuvers:
// teams sent round the flanks (the rest hold, the heaviest is the base of fire). flank: how
// wide they go, in meters. assault: whether they close: true; 'weak', only on an enemy that
// is shaken or thinned out; false, never. cover: how far a man looks for cover when contact
// comes (0, he keeps his place in the ranks). ambush: in a defense, fire is held until the
// enemy is this close. hug: maneuver teams close to this range and fight from there.
// breakAfter: seconds of fighting before it pulls out whatever its losses. scatter: it pulls
// out by teams, each its own way. line: it forms line, fires volleys and charges with the
// bayonet (volley, charge: ranges). charge: the assault goes in at a run, every man for the
// nearest enemy, to fight hand to hand. rigid: a team whose leader falls stops where it is.
const DOCTRINES = {
  modern:    { label: 'Fire and maneuver', hold: 0.45, maneuvers: 1, flank: 55, assault: true, cover: 14 },
  line:      { label: 'Line, volley and bayonet', hold: 0.4, line: true, volley: 90, charge: 45, assault: true, cover: 0 },
  woodland:  { label: 'From cover, round the flanks; the club when the enemy wavers', hold: 0.7, maneuvers: 2, flank: 90, assault: 'weak', charge: 30, cover: 16, ambush: 70, open: true },
  stoss:     { label: 'Machine gun base of fire; grenades and spades in the assault', hold: 0.45, maneuvers: 2, flank: 40, assault: true, cover: 14, rushes: true },
  soviet:    { label: 'Frontal assault on line, fire on the move', hold: 0.4, maneuvers: 9, flank: 10, assault: true, cover: 10, rigid: true },
  elite:     { label: 'Fix, then envelop from both flanks', hold: 0.35, maneuvers: 2, flank: 65, assault: true, cover: 14 },
  spetsnaz:  { label: 'Strike from ambush, then break contact', hold: 0.6, maneuvers: 1, flank: 50, assault: 'weak', cover: 14, ambush: 120, breakAfter: 240, scatter: true },
  nva:       { label: 'Hug the enemy close, then pull back', hold: 0.6, maneuvers: 2, flank: 35, assault: true, hug: 35, cover: 14, ambush: 60, breakAfter: 360, scatter: true, open: true },
  guerrilla: { label: 'Ambush close, then slip away', hold: 0.7, maneuvers: 1, flank: 35, assault: 'weak', hug: 40, cover: 14, ambush: 50, breakAfter: 180, scatter: true, open: true },
  gang:      { label: 'No plan: fire from where they stand, scatter when hurt', hold: 0.8, maneuvers: 0, assault: false, cover: 5, scatter: true },
};

const AI = { mode: 'defend', objective: null, contact: false, withdrawing: false, timer: 0, lastContact: -99, routine: null, breakOff: false, escape: null,
  D: DOCTRINES.modern, ambushing: false, contactStart: null };

function initAI(mode, objective, extra) {
  AI.mode = mode; AI.objective = objective;
  AI.contact = false; AI.withdrawing = false; AI.timer = 2; AI.lastContact = -99;
  AI.routine = extra && extra.routine || null; AI.breakOff = !!(extra && extra.breakOff); AI.escape = extra && extra.escape || null;
  AI.D = DOCTRINES[extra && extra.doctrine] || DOCTRINES.modern; AI.contactStart = null;
  const sq = G.squads.red;
  for (const t of [sq.hq, ...sq.teams]) { t.task = null; t.escape = null; }
  // Forces that fight in open order move spread out.
  if (AI.D.open) { sq.spacing = 1.8; for (const t of sq.teams) t.spacing = 1.8; }
  if (AI.D.line) { sq.formation = 'line'; for (const t of sq.teams) t.formation = 'line'; }
  // Lying in wait: no one fires until the enemy is close.
  AI.ambushing = !!AI.D.ambush && mode === 'defend';
  if (AI.ambushing) for (const s of sq.all) s.fireControl = 'hold';
}

// The enemy is shaken or thinned out: time to close.
function blueWeak() {
  const b = G.squads.blue, act = b.all.filter(s => s.active && !s.routing);
  if (act.length < 0.65 * b.all.length) return true;
  return act.length && act.reduce((n, s) => n + s.supp, 0) / act.length > 45;
}

// Every man runs at the nearest enemy he knows of, to fight hand to hand.
function charge(m) {
  const known = [...G.known.red.values()].filter(k => G.time - k.t < 20 && G.byId.get(k.id)?.active);
  for (const s of m) {
    let best = null, bd = Infinity;
    for (const k of known) { const d = dist(s.x, s.y, k.x, k.y); if (d < bd) { bd = d; best = k; } }
    if (!best) continue;
    const e = G.byId.get(best.id), tx = best.visible ? e.x : best.x, ty = best.visible ? e.y : best.y;
    orderMove(s, tx, ty, 'rush');
    s.assault = true; s.homePosture = 'stand'; s.fireControl = 'free';
  }
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

function aiTakeCover(members, threat, radius) {
  const reserved = [];
  for (const s of members) {
    s.assault = false;
    const c = G.map.findCover(s.x, s.y, threat.x, threat.y, radius || 14, reserved);
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
  const D = AI.D, teams = sq.teams.filter(t => t.members.some(commandable)).sort((a, b) => firepower(b) - firepower(a));
  sq.hq.task = { type: 'hold' };
  if (D.line) { for (const t of teams) t.task = { type: 'line', phase: 'form', t0: G.time }; return; }
  let maneuvers = 0;
  teams.forEach((t, i) => {
    if (i === 0 || !D.maneuvers) { t.task = { type: i === 0 && D.maneuvers ? 'base' : 'hold' }; return; }
    // Attacking, every team allowed goes; defending, one may go out after a flank, and a force
    // that envelops (a war party, paratroopers) always does.
    const eager = AI.mode === 'advance' || D.maneuvers >= 2 || D.rigid;
    const go = t.morale > 45 && maneuvers < D.maneuvers && (eager || (maneuvers === 0 && chance(0.55)));
    t.task = go ? { type: 'maneuver', phase: 'start', t0: G.time, side: maneuvers % 2 ? -1 : 1 } : { type: 'hold' };
    if (go) maneuvers++;
  });
}

// Pull out: the whole force for one edge, or each team its own way.
function breakContact(sq, enemyC, why) {
  const c = centroid(sq.all.filter(commandable).length ? sq.all.filter(commandable) : sq.all);
  AI.withdrawing = true;
  if (AI.D.scatter && enemyC) {
    const away = angleTo(enemyC.x, enemyC.y, c.x, c.y);
    [sq.hq, ...sq.teams].forEach((t, i) => {
      const m = t.members.filter(commandable);
      if (m.length) t.escape = edgeFrom(centroid(m), away + (i % 3 - 1) * 0.7 + gauss() * 0.2);
    });
  }
  for (const t of [sq.hq, ...sq.teams]) startRouting(t, 'withdraw');
  if (sq.all.some(s => G.known.blue.get(s.id)?.visible)) G.log(why || 'Enemy is breaking contact.', 'kill');
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

  const contacts = [...G.known.red.values()].filter(k => G.time - k.t < 30 && G.byId.get(k.id)?.active);
  if (contacts.length) AI.lastContact = G.time;
  const enemyC = contacts.length ? centroid(contacts) : null;

  if (sq.active.length / sq.all.length < AI.D.hold) { breakContact(sq, enemyC); return; }
  if (AI.D.breakAfter && AI.contactStart != null && G.time - AI.contactStart > AI.D.breakAfter) {
    breakContact(sq, enemyC, 'The enemy is pulling back.'); return;
  }

  // An ambush is sprung when the enemy comes close enough, or fires first.
  if (AI.ambushing) {
    const close = contacts.some(k => k.visible && act.some(s => dist(s.x, s.y, k.x, k.y) < AI.D.ambush));
    const firedOn = sq.all.some(s => G.time - s.team.lastFiredUpon < 3);
    if (close || firedOn) {
      AI.ambushing = false;
      for (const s of sq.all) s.fireControl = 'free';
    } else if (contacts.length) {
      // Waiting: still, and silent.
      AI.contact = true;
      for (const s of sq.all) s.relaxed = false;
      return;
    }
  }

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

  if (!AI.contact || AI.contactStart == null) {
    AI.contact = true; AI.contactStart = G.time;
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
    if (AI.D.line && sq.all.some(s => G.known.blue.get(s.id)?.visible)) G.log('The enemy is forming line.', 'contact');
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
  const task = t.task, D = AI.D;
  const avgSupp = m.reduce((n, s) => n + s.supp, 0) / m.length;
  const c = centroid(m), dE = dist(c.x, c.y, enemyC.x, enemyC.y);

  if (task.type === 'line') { runLine(t, m, enemyC, dE); return; }

  if (task.type === 'base' || task.type === 'hold') {
    if (!task.covered) {
      if (D.cover) aiTakeCover(m, enemyC, D.cover);
      else for (const s of m) { s.faceAngle = angleTo(s.x, s.y, enemyC.x, enemyC.y); s.homePosture = 'kneel'; }
      task.covered = true;
    }
    // Automatic weapons in the base of fire keep rounds on the enemy's last position.
    if (task.type === 'base') {
      for (const s of m) {
        if ((s.billet === 'MG' || s.billet === 'AR') && !s.targetId) s.suppressPt = { x: enemyC.x + gauss() * 4, y: enemyC.y + gauss() * 4 };
      }
    }
    // A war party holding its ground still closes on a beaten enemy.
    if (D.charge && D.assault === 'weak' && blueWeak() && dE < 120 && t.morale > 40 && !task.charged) { task.charged = true; charge(m); }
    return;
  }

  // Maneuver: flank, then assault. Give up and go to ground when the fire is too heavy.
  if (t.morale < 35 || avgSupp > 65) {
    t.task = { type: 'hold' };
    return;
  }
  // A drilled conscript team without its leader goes no further.
  if (D.rigid && !t.members.some(s => s.active && s.billet === 'TL')) { t.task = { type: 'hold' }; return; }
  if (task.phase === 'start') {
    const toUs = angleTo(enemyC.x, enemyC.y, c.x, c.y), fl = D.flank || 55;
    const sides = task.side && D.maneuvers >= 2 ? [task.side] : [1, -1];
    const options = sides.map(side => {
      const a = toUs + side * Math.PI / 2;
      const x = clamp(enemyC.x + Math.cos(a) * fl + Math.cos(toUs) * (D.hug || 25), 6, MAP_W - 6);
      const y = clamp(enemyC.y + Math.sin(a) * fl + Math.sin(toUs) * (D.hug || 25), 6, MAP_H - 6);
      let cover = 0;
      for (let i = 1; i <= 8; i++) {
        const k = G.map.terAt(lerp(c.x, x, i / 8), lerp(c.y, y, i / 8));
        if (TERRAIN[k].conceal >= 0.45 || TERRAIN[k].cover >= 0.3) cover++;
      }
      return { x, y, score: cover + rand() * 2 };
    });
    const p = options.length > 1 && options[1].score > options[0].score ? options[1] : options[0];
    task.flank = p;
    task.phase = 'flank';
    task.t0 = G.time;
    // Storm troops cover the last stretch in rushes.
    teamMove(t, p.x, p.y, D.rushes && dist(c.x, c.y, p.x, p.y) < 90 ? 'rush' : 'walk');
    if (D.rigid) for (const s of m) { s.assault = true; s.fireControl = 'free'; }
    return;
  }
  if (task.phase === 'flank') {
    if (m.every(s => !s.moving || s.pinned) || G.time - task.t0 > 70) {
      // Guerrillas hug the enemy and fight from close in; they go in only on a beaten enemy.
      if (D.assault === false || (D.assault === 'weak' && !blueWeak())) { task.phase = 'hug'; task.t0 = G.time; return; }
      task.phase = 'assault';
      task.t0 = G.time;
      if (D.charge) charge(m);
      else teamMove(t, enemyC.x, enemyC.y, 'walk');
      for (const s of m) { s.assault = true; s.fireControl = 'free'; }
    }
    return;
  }
  if (task.phase === 'hug') {
    if (!task.covered) { aiTakeCover(m, enemyC, D.cover || 14); task.covered = true; }
    if (D.assault && (D.assault === true ? G.time - task.t0 > 40 : blueWeak())) { task.phase = 'flank'; task.t0 = G.time - 71; task.covered = false; }
    return;
  }
  if (task.phase === 'assault') {
    if (m.every(s => !s.moving)) {
      if (dE > 20 && G.time - task.t0 < 90) {
        if (D.charge) charge(m); else teamMove(t, enemyC.x, enemyC.y, 'walk');
        for (const s of m) s.assault = true;
      } else {
        t.task = { type: 'hold' };
      }
    }
  }
}

// Infantry of the line: form line facing the enemy, march up without firing, give fire by
// volley at close range, then go in with the bayonet. Beaten back, it re-forms and fires.
function runLine(t, m, enemyC, dE) {
  const task = t.task, D = AI.D;
  if (task.phase === 'form') {
    t.formation = 'line';
    for (const s of m) { s.homePosture = 'stand'; s.fireControl = 'hold'; }
    if (AI.mode !== 'defend' && dE > D.volley + 25) {
      const a = angleTo(enemyC.x, enemyC.y, centroid(m).x, centroid(m).y), stop = D.volley * 0.85;
      teamMove(t, enemyC.x + Math.cos(a) * stop, enemyC.y + Math.sin(a) * stop, 'walk', a + Math.PI, false);
    }
    task.phase = 'advance'; task.t0 = G.time;
    return;
  }
  if (task.phase === 'advance') {
    // Defending, the line holds its fire until the enemy is close.
    if (dE < D.volley || (AI.mode !== 'defend' && m.every(s => !s.moving))) {
      // Halt, present, fire: the whole team together.
      for (const s of m) { s.path = []; s.fireControl = 'free'; s.fireCD = randRange(0, 0.5); s.faceAngle = angleTo(s.x, s.y, enemyC.x, enemyC.y); }
      task.phase = 'volley'; task.t0 = G.time;
      if (G.time - (AI.volleyLogT || -99) > 30 && G.squads.red.all.some(s => G.known.blue.get(s.id)?.visible)) { AI.volleyLogT = G.time; G.log('The enemy line fires a volley.', 'contact'); }
    }
    return;
  }
  if (task.phase === 'volley') {
    // Two volleys or so, then the bayonet; sooner on a shaken enemy, or one already close.
    if ((G.time - task.t0 > 32 || blueWeak() || dE < D.charge) && t.morale > 40) {
      task.phase = 'charge'; task.t0 = G.time;
      charge(m);
      if (G.time - (AI.chargeLogT || -99) > 30 && G.squads.red.all.some(s => G.known.blue.get(s.id)?.visible)) { AI.chargeLogT = G.time; G.log('The enemy is charging with the bayonet!', 'contact'); }
    }
    return;
  }
  if (task.phase === 'charge') {
    if (G.time - task.t0 > 50 || t.morale < 35) { task.phase = 'form'; return; }
    if (m.every(s => !s.moving)) charge(m);
  }
}

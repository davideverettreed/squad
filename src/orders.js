'use strict';
// Orders to a Marine, a fire team or the squad, and the movement that carries them out.

// A selection is { level: 'soldier' | 'team' | 'squad' | 'group', soldier, team, squad },
// a group being { teams, except }: every team but one, picked by double-clicking it.
// The squad leader moves with 1st Fire Team: selecting it takes him along. He can still be
// picked alone, and the other teams move without him.
function slWith(team) {
  return team.num === 1 && team.side === 'blue' && team.squad.leader ? [team.squad.leader] : [];
}
function selMembers(sel) {
  if (!sel) return [];
  if (sel.level === 'soldier') return [sel.soldier];
  if (sel.level === 'team') return [...sel.team.members, ...slWith(sel.team)];
  if (sel.level === 'group') return sel.teams.flatMap(t => [...t.members, ...slWith(t)]);
  return sel.squad.all;
}
function selName(sel) {
  if (sel.level === 'soldier') return sel.soldier.label;
  if (sel.level === 'team') return sel.team.name;
  if (sel.level === 'group') return sel.except ? 'All but ' + sel.except.short : sel.teams.map(t => t.short).join(' + ');
  return sel.squad.name;
}
// Every team of the squad but this one.
function groupBut(team) {
  const sq = team.squad;
  return { level: 'group', squad: sq, except: team, teams: sq.teams.filter(t => t !== team && t.members.some(s => s.active)) };
}
// A formation offset at a unit's chosen interval.
function scaled(o, k) { return { x: o.x * (k || 1), y: o.y * (k || 1) }; }
function commandable(s) { return s.active && !s.routing; }

function setPosture(s, p) {
  if (s.posture === p) return;
  s.postureBusy = Math.max(s.postureBusy, POSTURE_TIME[s.posture][p] || 0.5);
  s.posture = p;
}

// Lowest posture from which a man can still see and fire on a point: prone, else kneeling.
function firingPosture(s, x, y) {
  if (G.map.los(s.x, s.y, POSTURE.prone.eye, x, y, 0.8) > 0.3) return 'prone';
  if (G.map.los(s.x, s.y, POSTURE.kneel.eye, x, y, 0.8) > 0) return 'kneel';
  return 'prone';
}

function turnToward(a, b, step) {
  const d = angleDiff(a, b);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

// Any new order to a man releases him from a bounding drill.
function releaseControllers(members) {
  G.controllers = G.controllers.filter(c => !c.members.some(m => members.includes(m)));
}

function orderMove(s, x, y, mode) {
  if (!commandable(s)) return false;
  s.nudging = false; s.resume = null; s.holdFacing = null;
  const p = G.map.findPath(s.x, s.y, x, y);
  s.path = p || [];
  s.moveMode = mode;
  s.faceAngle = null;
  return true;
}

function teamMove(team, x, y, mode, heading, alone) {
  // Moving on its own, 1st Fire Team brings the squad leader, a little behind its center.
  const sl = alone === false ? null : slWith(team).find(commandable);
  if (sl) {
    const c0 = centroid(team.members.filter(commandable).concat(sl)), h = heading != null ? heading : angleTo(c0.x, c0.y, x, y);
    const w = rotateOffset(0, -9, h);
    orderMove(sl, x + w.x, y + w.y, mode);
  }
  const act = team.members.filter(commandable);
  if (!act.length) return;
  const c = centroid(act);
  if (heading == null) heading = angleTo(c.x, c.y, x, y);
  // On a long move the team plots one route and each man keeps station on it.
  if (dist(c.x, c.y, x, y) > 120) {
    const route = G.map.findPath(c.x, c.y, x, y);
    if (route) {
      act.forEach((s, i) => {
        if (!commandable(s)) return;
        const o = scaled(teamSlot(team.formation, i), team.spacing);
        s.path = G.map.offsetPath(s.x, s.y, route, o.x, o.y);
        s.moveMode = mode; s.faceAngle = null;
      });
      return;
    }
  }
  act.forEach((s, i) => {
    const o = scaled(teamSlot(team.formation, i), team.spacing), w = rotateOffset(o.x, o.y, heading);
    orderMove(s, x + w.x, y + w.y, mode);
  });
}

function squadMove(sq, x, y, mode, face) {
  const act = sq.all.filter(commandable);
  if (!act.length) return;
  const c = centroid(act), heading = face != null ? face : angleTo(c.x, c.y, x, y);
  const teams = sq.teams.filter(t => t.members.some(commandable));
  // On a long move the whole force follows one route, each man at his station on it.
  if (face == null && dist(c.x, c.y, x, y) > 120) {
    const route = G.map.findPath(c.x, c.y, x, y);
    if (route) {
      const along = (s, ox, oy) => {
        s.nudging = false; s.resume = null; s.holdFacing = null;
        s.path = G.map.offsetPath(s.x, s.y, route, ox, oy); s.moveMode = mode; s.faceAngle = null;
      };
      teams.forEach((t, k) => {
        const q = scaled(squadSlot(sq.formation, k, teams.length), sq.spacing);
        t.members.filter(commandable).forEach((s, i) => { const o = scaled(teamSlot(t.formation, i), t.spacing); along(s, q.x + o.x, q.y + o.y); });
      });
      const so = scaled(squadLeaderSlot(sq.formation), sq.spacing);
      sq.hq.members.forEach((s, i) => { if (commandable(s)) along(s, so.x + (i ? (i % 2 ? -4 : 4) * Math.ceil(i / 2) : 0), so.y); });
      return;
    }
  }
  teams.forEach((t, k) => {
    const o = scaled(squadSlot(sq.formation, k, teams.length), sq.spacing), w = rotateOffset(o.x, o.y, heading);
    teamMove(t, x + w.x, y + w.y, mode, heading, false);
  });
  // The leader at his place; anyone else with him (a deputy, a sniper) beside him.
  const so = scaled(squadLeaderSlot(sq.formation), sq.spacing);
  sq.hq.members.forEach((s, i) => {
    if (!commandable(s)) return;
    const w = rotateOffset(so.x + (i ? (i % 2 ? -4 : 4) * Math.ceil(i / 2) : 0), so.y, heading);
    orderMove(s, x + w.x, y + w.y, mode);
  });
}

// Move along a route: one route is plotted through the waypoints and every man keeps his
// formation station on it (team slot, plus the team's place in the squad).
function routeMove(sel, pts, mode) {
  const members = selMembers(sel).filter(commandable);
  if (!members.length || pts.length < 2) return;
  const c = centroid(members);
  let route = [], px = c.x, py = c.y;
  for (const p of pts) {
    const leg = G.map.findPath(px, py, p.x, p.y) || [{ x: p.x, y: p.y }];
    route = route.concat(leg);
    px = p.x; py = p.y;
  }
  const sq = sel.squad, teams = sq.teams.filter(t => t.members.some(commandable));
  for (const s of members) {
    let ox = 0, oy = 0;
    if (s.team.num) {
      const i = s.team.members.filter(commandable).indexOf(s), o = scaled(teamSlot(s.team.formation, Math.max(0, i)), s.team.spacing);
      ox += o.x; oy += o.y;
      if (sel.level === 'squad') { const k = teams.indexOf(s.team), q = scaled(squadSlot(sq.formation, Math.max(0, k), teams.length), sq.spacing); ox += q.x; oy += q.y; }
    } else if (sel.level === 'squad') { const q = scaled(squadLeaderSlot(sq.formation), sq.spacing); ox = q.x; oy = q.y; }
    s.path = G.map.offsetPath(s.x, s.y, route, ox, oy);
    s.moveMode = mode; s.faceAngle = null; s.assault = false;
  }
}

// Occupy a fighting position: men spread along a line across the sector's center, 6 m apart.
function occupyPosition(sel, g) {
  const members = selMembers(sel).filter(commandable);
  const nx = -Math.sin(g.dir), ny = Math.cos(g.dir);
  members.forEach((s, i) => {
    const off = (i - (members.length - 1) / 2) * 6;
    orderMove(s, g.pts[0].x + nx * off, g.pts[0].y + ny * off, 'walk');
  });
}

// face: a bearing (radians) to face on arrival, the formation set out across it; or null.
function groupMove(sel, x, y, mode, face) {
  const members = selMembers(sel);
  Plan.override(members, 'move');
  releaseControllers(members);
  for (const s of members) { s.assault = false; s.launchQueue = null; }
  if (sel.level === 'soldier') orderMove(sel.soldier, x, y, mode);
  else if (sel.level === 'team') teamMove(sel.team, x, y, mode, face);
  else if (sel.level === 'group') {
    // The teams side by side in a line across the direction of march.
    const act = members.filter(commandable), c = act.length ? centroid(act) : { x, y }, h = face != null ? face : angleTo(c.x, c.y, x, y);
    sel.teams.forEach((t, k) => {
      const w = rotateOffset((k - (sel.teams.length - 1) / 2) * 32, 0, h);
      teamMove(t, x + w.x, y + w.y, mode, h);
    });
  }
  else squadMove(sel.squad, x, y, mode, face);
  // On arrival each man turns to the given front.
  if (face != null) for (const s of members) if (commandable(s)) s.faceAngle = face;
}

// Nearest enemy this man's side knows about, or the last man who shot at his team.
function threatPoint(s) {
  let best = null, bd = Infinity;
  for (const k of G.known[s.side].values()) {
    if (G.time - k.t > 30) continue;
    const e = G.byId.get(k.id);
    if (!e || !e.active) continue;
    const d = dist(s.x, s.y, k.x, k.y);
    if (d < bd) { bd = d; best = { x: k.x, y: k.y }; }
  }
  if (best) return best;
  for (const [id, t] of s.team.threats) {
    if (G.time - t > 20) continue;
    const e = G.byId.get(id);
    if (e) return { x: e.x + gauss() * 15, y: e.y + gauss() * 15 };
  }
  return null;
}

function threatCentroid(side, members) {
  const pts = [];
  for (const k of G.known[side].values()) {
    const e = G.byId.get(k.id);
    if (e && e.active && G.time - k.t < 60) pts.push(k);
  }
  if (pts.length) return centroid(pts);
  const c = centroid(members);
  return { x: c.x, y: side === 'blue' ? 0 : MAP_H };
}

// ---------------------------------------------------------------- bounding overwatch
// Elements take turns: one rushes forward past the others while the rest
// lie in overwatch with fire at will, until every element reaches the objective.
class BoundController {
  // dests: optionally, each element's own end point (a team's spot at the objective).
  constructor(elements, x, y, label, dests) {
    const keep = elements.map(e => e.some(commandable));
    this.elements = elements.filter((e, k) => keep[k]);
    this.dests = dests ? dests.filter((d, k) => keep[k]) : null;
    this.members = this.elements.flat();
    this.label = label;
    this.dest = { x, y };
    this.start = centroid(this.members);
    this.starts = this.elements.map(e => centroid(e.filter(commandable)));
    this.total = Math.max(1, dist(this.start.x, this.start.y, x, y));
    if (this.dests) this.total = Math.max(1, ...this.dests.map((d, k) => dist(this.starts[k].x, this.starts[k].y, d.x, d.y)));
    this.heading = angleTo(this.start.x, this.start.y, x, y);
    this.prog = this.elements.map(() => 0);
    this.boundLen = this.elements.length > 2 ? 35 : 25;
    this.idx = 0; this.timer = 0; this.done = false;
    for (const s of this.members) { s.path = []; s.assault = false; s.fireControl = 'free'; }
    this.startBound();
  }
  slotFor(k, prog, i, m) {
    const n = this.elements.length;
    // Each element on its own line from where it was to its own spot.
    if (this.dests) {
      const a = this.starts[k], b = this.dests[k], w = rotateOffset((i - (m - 1) / 2) * 6, 0, angleTo(a.x, a.y, b.x, b.y));
      return { x: lerp(a.x, b.x, prog) + w.x, y: lerp(a.y, b.y, prog) + w.y };
    }
    const lat = (k - (n - 1) / 2) * (n > 2 ? 24 : 12) + (i - (m - 1) / 2) * 6;
    const w = rotateOffset(lat, 0, this.heading);
    return { x: lerp(this.start.x, this.dest.x, prog) + w.x, y: lerp(this.start.y, this.dest.y, prog) + w.y };
  }
  overwatchPosture(s) {
    const t = threatPoint(s) || { x: s.x + Math.cos(this.heading) * 80, y: s.y + Math.sin(this.heading) * 80 };
    return firingPosture(s, t.x, t.y);
  }
  startBound() {
    const n = this.elements.length;
    for (let tries = 0; tries < n; tries++) {
      const k = (this.idx + tries) % n;
      if (this.prog[k] < 1 && this.elements[k].some(commandable)) { this.idx = k; break; }
      if (tries === n - 1) { this.finish(); return; }
    }
    const k = this.idx;
    const np = Math.min(1, Math.max(...this.prog) + this.boundLen / this.total);
    this.prog[k] = np;
    const movers = this.elements[k].filter(commandable);
    movers.forEach((s, i) => {
      const p = this.slotFor(k, np, i, movers.length);
      orderMove(s, p.x, p.y, 'rush');
    });
    for (const s of this.members) if (!movers.includes(s)) s.homePosture = this.overwatchPosture(s);
    this.timer = 0;
  }
  update(dt) {
    this.timer += dt;
    const movers = this.elements[this.idx].filter(commandable);
    const arrived = movers.every(s => !s.moving || s.pinned);
    if ((arrived && this.timer > 1) || this.timer > 40) {
      for (const s of movers) { s.path = []; s.homePosture = this.overwatchPosture(s); }
      if (this.prog.every(p => p >= 1)) {
        // The last bounds done: anyone well short of his place (held up by woods, a wall, fire)
        // is sent on to it, a few times, before the bounds are called complete.
        this.tries = (this.tries || 0) + 1;
        let short = false;
        if (this.tries <= 3) this.elements.forEach((e, k) => {
          const live = e.filter(commandable);
          live.forEach((s, i) => { const q = this.slotFor(k, 1, i, live.length); if (dist(s.x, s.y, q.x, q.y) > 15) { orderMove(s, q.x, q.y, 'walk'); short = true; } });
        });
        if (short) { this.idx = this.elements.findIndex(e => e.some(s => commandable(s) && s.moving)); if (this.idx < 0) this.idx = 0; this.timer = 0; return; }
        this.finish();
      }
      else { this.idx = (this.idx + 1) % this.elements.length; this.startBound(); }
    }
  }
  finish() {
    this.done = true;
    if (this.members[0].side === 'blue') G.log(this.label + ': Set. Bounds complete.', 'info');
  }
}

function boundElements(sel) {
  if (sel.level === 'group') return sel.teams.map(t => [...t.members, ...slWith(t)].filter(commandable)).filter(e => e.length);
  if (sel.level === 'squad') {
    const teams = sel.squad.teams.map(t => t.members.filter(commandable)).filter(e => e.length);
    const sl = sel.squad.hq.members[0];
    if (commandable(sl) && teams.length) teams[Math.min(1, teams.length - 1)].push(sl);
    return teams;
  }
  // Within a fire team, two buddy pairs: team leader and rifleman, automatic rifleman and grenadier.
  const m = sel.team.members.filter(commandable);
  const a = [], b = [];
  sel.team.members.forEach((s, i) => { if (!commandable(s)) return; ([0, 3, 4].includes(i) ? a : b).push(s); });
  return [a, b].filter(e => e.length).length > 1 ? [a, b] : m.map(s => [s]);
}

// ---------------------------------------------------------------- the order set
function issueOrder(sel, type, arg) {
  // After step-off the player's orders go by radio and take effect when acknowledged.
  if (Radio.routes(sel)) { Radio.send(sel, type, arg); return; }
  const members = selMembers(sel).filter(commandable);
  const who = selName(sel);
  Plan.override(members, type);
  if (!members.length) { G.toast(who + ' cannot take orders.'); return; }
  const team = sel.level === 'soldier' ? sel.soldier.team : sel.level === 'group' ? sel.teams[0] : sel.team;

  switch (type) {
    case 'move':
      groupMove(sel, arg.x, arg.y, arg.mode || G.ui.moveMode, arg.face);
      break;
    case 'posture':
      for (const s of members) { s.homePosture = arg; if (!s.moving) setPosture(s, arg); }
      G.toast(who + ': ' + POSTURE[arg].label.toLowerCase() + '.');
      break;
    case 'fire':
      for (const s of members) { s.fireControl = arg; if (arg === 'hold') { s.suppressPt = null; s.priorityId = null; } }
      G.toast(who + ': ' + { free: 'Fire at will.', return: 'Return fire only.', hold: 'Hold fire.' }[arg]);
      break;
    case 'formation':
      if (sel.level === 'squad') sel.squad.formation = arg;
      else if (sel.level === 'group') for (const t of sel.teams) t.formation = arg;
      else team.formation = arg;
      G.toast(who + ': formation ' + FORMATIONS[arg].label.toLowerCase() + '.');
      break;
    case 'spacing': {
      // Spread out or close up around the unit's center, keeping its front.
      Nudge.apply(sel, { heading: members[0].facing, scale: arg.ratio, text: arg.text });
      G.toast(who + ': ' + arg.text + '.');
      break;
    }
    case 'nudge':
      Nudge.apply(sel, arg);
      G.toast(who + ': ' + arg.text + '.');
      break;
    case 'halt':
      releaseControllers(members);
      for (const s of members) { s.path = []; s.assault = false; s.launchQueue = null; s.nudging = false; s.resume = null; s.holdFacing = null; }
      G.toast(who + ': Halt.');
      break;
    case 'cover': {
      releaseControllers(members);
      const reserved = [];
      for (const s of members) {
        s.assault = false;
        const t = threatPoint(s);
        if (!t) { s.path = []; s.homePosture = 'prone'; continue; }
        const c = G.map.findCover(s.x, s.y, t.x, t.y, 14, reserved);
        reserved.push(c);
        orderMove(s, c.x, c.y, 'rush');
        s.homePosture = c.posture;
      }
      G.toast(who + ': Take cover.');
      break;
    }
    case 'fallback': {
      releaseControllers(members);
      const c = centroid(members), t = threatCentroid(members[0].side, members);
      const a = angleTo(t.x, t.y, c.x, c.y);
      for (const s of members) {
        s.assault = false; s.suppressPt = null; s.launchQueue = null;
        orderMove(s, clamp(s.x + Math.cos(a) * 45, 2, MAP_W - 2), clamp(s.y + Math.sin(a) * 45, 2, MAP_H - 2), 'rush');
        s.homePosture = 'prone';
      }
      G.toast(who + ': Fall back.');
      break;
    }
    case 'assault':
      groupMove(sel, arg.x, arg.y, 'walk');
      for (const s of members) { s.assault = true; s.fireControl = 'free'; s.homePosture = 'kneel'; }
      G.log(who + ': Assault through!', 'fire');
      break;
    case 'bound': {
      if (sel.level === 'soldier') { groupMove(sel, arg.x, arg.y, 'rush'); break; }
      releaseControllers(members);
      for (const s of members) { s.launchQueue = null; }
      G.controllers.push(new BoundController(boundElements(sel), arg.x, arg.y, who));
      G.toast(who + ': Bounding overwatch.');
      break;
    }
    case 'suppress':
      for (const s of members) { s.suppressPt = { x: arg.x, y: arg.y }; s.priorityId = null; if (s.fireControl === 'hold') s.fireControl = 'free'; }
      G.log(who + ': Suppressing, bearing ' + pad3(bearing(members[0].x, members[0].y, arg.x, arg.y)) + '.', 'fire');
      break;
    case 'lift':
      for (const s of members) { s.suppressPt = null; s.priorityId = null; }
      G.toast(who + ': Lift fire.');
      break;
    case 'engage':
      for (const s of members) { s.priorityId = arg.id; s.suppressPt = null; if (s.fireControl === 'hold') s.fireControl = 'free'; }
      G.toast(who + ': Engage the ' + arg.title.toLowerCase() + '.');
      break;
    case 'launcher': {
      const gs = members.filter(s => s.launcher && s.lRounds > 0);
      if (!gs.length) { G.toast('No grenadier with 40mm rounds in ' + who + '.'); break; }
      let any = false;
      for (const s of gs) {
        const d = dist(s.x, s.y, arg.x, arg.y);
        if (d < s.launcher.min || d > s.launcher.range) continue;
        s.launchQueue = { x: arg.x, y: arg.y, count: 3 }; any = true;
      }
      if (any) G.log(who + ': Firing 40mm, three rounds.', 'fire');
      else G.toast('Target is outside 40mm range (' + gs[0].launcher.min + '–' + gs[0].launcher.range + ' m).');
      break;
    }
    case 'frag': {
      const cands = members.filter(s => s.frags > 0 && !s.moving && dist(s.x, s.y, arg.x, arg.y) <= s.grenade.range + 4)
        .sort((a, b) => dist(a.x, a.y, arg.x, arg.y) - dist(b.x, b.y, arg.x, arg.y));
      if (!cands.length) { G.toast('Nobody halted within ' + GRENADES.M67.range + ' m with a grenade.'); break; }
      throwFrag(cands[0], arg.x, arg.y);
      break;
    }
    case 'face':
      for (const s of members) { s.faceAngle = angleTo(s.x, s.y, arg.x, arg.y); }
      G.toast(who + ': Watching bearing ' + pad3(bearing(members[0].x, members[0].y, arg.x, arg.y)) + '.');
      break;
  }
}

// ---------------------------------------------------------------- movement
function updateMovement(s, dt) {
  if (!s.active) return;
  if (s.postureBusy > 0) { s.postureBusy -= dt; return; }

  if (!s.path.length && s.nudging) {
    // The nudge is done: back onto the route he was on, if any, still facing the new front.
    s.nudging = false; s.holdFacing = null;
    const r = s.resume; s.resume = null;
    if (r) { s.path = r.path; s.moveMode = r.mode; }
  }
  if (!s.path.length) {
    s.assault = false;
    let want = s.homePosture;
    // A man ordered prone rises to a knee if that is the only way to see the enemy.
    if (want === 'prone') {
      s.postureCheckT -= dt;
      if (s.postureCheckT <= 0) {
        s.postureCheckT = 2;
        const t = s.fireControl !== 'hold' ? threatPoint(s) : null;
        s.postureAdj = t ? firingPosture(s, t.x, t.y) : null;
      }
      if (s.postureAdj) want = s.postureAdj;
    }
    if (s.supp > 70) want = 'prone';
    else if (s.supp > 40 && want === 'stand') want = 'kneel';
    if (s.posture !== want) setPosture(s, want);
    if (s.faceAngle != null && G.time - s.lastFired > 2) s.facing = turnToward(s.facing, s.faceAngle, dt * 3);
    s.fatigue = Math.max(0, s.fatigue - dt * 4);
    return;
  }

  let mode = s.moveMode;
  if (mode === 'rush' && s.fatigue > 85) mode = 'walk';
  if (s.pinned && mode !== 'crawl' && !s.routing) {
    if (s.posture !== 'prone') setPosture(s, 'prone');
    return;
  }
  let want = MOVE[mode].posture, spMul = 1;
  if (mode === 'walk' && (s.suppressed || s.assault)) { want = 'kneel'; spMul = 0.65; }
  if (s.posture !== want) { setPosture(s, want); return; }

  const tgt = s.path[0], d = dist(s.x, s.y, tgt.x, tgt.y);
  const ter = TERRAIN[G.map.terAt(s.x, s.y)].speed || 0.3;
  const sp = MOVE[mode].speed * spMul * ter * s.loadFactor * (s.health === 'light' ? 0.7 : 1) * (s.fatigue > 60 && mode === 'rush' ? 0.8 : 1);
  const step = sp * dt;
  const a = angleTo(s.x, s.y, tgt.x, tgt.y);
  if (step >= d) { s.x = tgt.x; s.y = tgt.y; s.path.shift(); }
  else { s.x += Math.cos(a) * step; s.y += Math.sin(a) * step; }
  if (!(s.assault && G.time - s.lastFired < 1.5)) s.facing = turnToward(s.facing, s.holdFacing != null ? s.holdFacing : a, dt * 6);
  s.fatigue = clamp(s.fatigue + (MOVE[mode].fatigue - 1.5) * dt, 0, 100);
}

// ---------------------------------------------------------------- nudges (W A S D, Q E)
// A short shift of the selected unit, as in a Total War game: W forward, S back, A and D
// sideways, Q and E turn the formation. The men keep facing the unit's front while they
// shift; the order goes out when the keys stop, and when they get there each man takes
// up again whatever move he was on.
const NUDGE_STEP = 15, NUDGE_SIDE = 10, NUDGE_TURN = Math.PI / 12, NUDGE_WAIT = 0.7;
const Nudge = {
  cur: null,

  key(k) {
    const sel = G.ui.sel;
    if (!sel || !G.running || G.over || Plan.planning) return false;
    const men = selMembers(sel).filter(commandable);
    if (!men.length) return false;
    const n = this.cur && this.cur.sel === sel ? this.cur : this.start(sel, men);
    if (k === 'w') n.f += NUDGE_STEP; else if (k === 's') n.f -= NUDGE_STEP;
    else if (k === 'a') n.r -= NUDGE_SIDE; else if (k === 'd') n.r += NUDGE_SIDE;
    else if (k === 'q') n.rot -= NUDGE_TURN; else if (k === 'e') n.rot += NUDGE_TURN;
    n.t = performance.now();
    this.cur = n;
    return true;
  },
  start(sel, men) {
    const lead = (sel.level === 'soldier' ? sel.soldier : sel.level === 'team' ? sel.team.leader : sel.level === 'group' ? sel.teams[0].leader : sel.squad.leader) || men[0];
    return { sel, men, c: centroid(men), heading: lead.facing, f: 0, r: 0, rot: 0, t: 0 };
  },
  // Where each man ends up: his place in the unit turned by the rotation, then shifted.
  targets(n) {
    const h = n.heading, fx = Math.cos(h), fy = Math.sin(h), rx = -fy, ry = fx;
    const cx = n.c.x + fx * n.f + rx * n.r, cy = n.c.y + fy * n.f + ry * n.r;
    const ca = Math.cos(n.rot), sa = Math.sin(n.rot), k = n.scale || 1;
    return n.men.map(s => {
      const ox = (s.x - n.c.x) * k, oy = (s.y - n.c.y) * k;
      return { s, x: clamp(cx + ox * ca - oy * sa, 2, MAP_W - 2), y: clamp(cy + ox * sa + oy * ca, 2, MAP_H - 2) };
    });
  },
  text(n) {
    const parts = [];
    if (n.f) parts.push((n.f > 0 ? 'move up ' : 'back up ') + Math.abs(n.f) + ' m');
    if (n.r) parts.push('shift ' + (n.r > 0 ? 'right ' : 'left ') + Math.abs(n.r) + ' m');
    if (n.rot) parts.push('face ' + (n.rot > 0 ? 'right ' : 'left ') + Math.round(Math.abs(n.rot) * 180 / Math.PI) + '°');
    return parts.join(', ') || 'hold';
  },
  // Each frame: send the order once the keys have been still a moment.
  update() {
    const n = this.cur;
    if (!n || performance.now() - n.t < NUDGE_WAIT * 1000) return;
    this.cur = null;
    if (!n.f && !n.r && !n.rot) return;
    issueOrder(n.sel, 'nudge', { f: n.f, r: n.r, rot: n.rot, heading: n.heading, text: this.text(n) });
  },
  // Carry out a nudge from where the men are when the order arrives: a short walk to each
  // man's new place, facing the new front, then back to his old route if he had one.
  apply(sel, arg) {
    const men = selMembers(sel).filter(commandable);
    if (!men.length) return;
    const n = { men, c: centroid(men), heading: arg.heading, f: arg.f || 0, r: arg.r || 0, rot: arg.rot || 0, scale: arg.scale || 1 };
    for (const t of this.targets(n)) {
      const s = t.s;
      if (!s.resume) s.resume = s.path.length ? { path: s.path.slice(), mode: s.moveMode, faceAngle: s.faceAngle } : null;
      s.path = G.map.findPath(s.x, s.y, t.x, t.y) || [{ x: t.x, y: t.y }];
      s.moveMode = 'walk';
      s.holdFacing = arg.heading + (arg.rot || 0);
      s.faceAngle = arg.heading + (arg.rot || 0);
      s.nudging = true;
    }
  },
};
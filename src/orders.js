'use strict';
// Orders to a Marine, a fire team or the squad, and the movement that carries them out.

// A selection is { level: 'soldier' | 'team' | 'squad', soldier, team, squad }.
function selMembers(sel) {
  if (!sel) return [];
  if (sel.level === 'soldier') return [sel.soldier];
  if (sel.level === 'team') return sel.team.members.slice();
  return sel.squad.all;
}
function selName(sel) {
  if (sel.level === 'soldier') return sel.soldier.label;
  if (sel.level === 'team') return sel.team.name;
  return sel.squad.name;
}
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
  const p = G.map.findPath(s.x, s.y, x, y);
  s.path = p || [];
  s.moveMode = mode;
  s.faceAngle = null;
  return true;
}

function teamMove(team, x, y, mode, heading) {
  const act = team.members.filter(commandable);
  if (!act.length) return;
  if (heading == null) { const c = centroid(act); heading = angleTo(c.x, c.y, x, y); }
  act.forEach((s, i) => {
    const o = teamSlot(team.formation, i), w = rotateOffset(o.x, o.y, heading);
    orderMove(s, x + w.x, y + w.y, mode);
  });
}

function squadMove(sq, x, y, mode) {
  const act = sq.all.filter(commandable);
  if (!act.length) return;
  const c = centroid(act), heading = angleTo(c.x, c.y, x, y);
  const teams = sq.teams.filter(t => t.members.some(commandable));
  teams.forEach((t, k) => {
    const o = squadSlot(sq.formation, k, teams.length), w = rotateOffset(o.x, o.y, heading);
    teamMove(t, x + w.x, y + w.y, mode, heading);
  });
  const sl = sq.hq.members[0];
  if (commandable(sl)) {
    const o = squadLeaderSlot(sq.formation), w = rotateOffset(o.x, o.y, heading);
    orderMove(sl, x + w.x, y + w.y, mode);
  }
}

function groupMove(sel, x, y, mode) {
  const members = selMembers(sel);
  releaseControllers(members);
  for (const s of members) { s.assault = false; s.launchQueue = null; }
  if (sel.level === 'soldier') orderMove(sel.soldier, x, y, mode);
  else if (sel.level === 'team') teamMove(sel.team, x, y, mode);
  else squadMove(sel.squad, x, y, mode);
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
  constructor(elements, x, y, label) {
    this.elements = elements.filter(e => e.some(commandable));
    this.members = this.elements.flat();
    this.label = label;
    this.dest = { x, y };
    this.start = centroid(this.members);
    this.total = Math.max(1, dist(this.start.x, this.start.y, x, y));
    this.heading = angleTo(this.start.x, this.start.y, x, y);
    this.prog = this.elements.map(() => 0);
    this.boundLen = this.elements.length > 2 ? 35 : 25;
    this.idx = 0; this.timer = 0; this.done = false;
    for (const s of this.members) { s.path = []; s.assault = false; s.fireControl = 'free'; }
    this.startBound();
  }
  slotFor(k, prog, i, m) {
    const n = this.elements.length;
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
      if (this.prog.every(p => p >= 1)) this.finish();
      else { this.idx = (this.idx + 1) % this.elements.length; this.startBound(); }
    }
  }
  finish() {
    this.done = true;
    if (this.members[0].side === 'blue') G.log(this.label + ': Set. Bounds complete.', 'info');
  }
}

function boundElements(sel) {
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
  const members = selMembers(sel).filter(commandable);
  const who = selName(sel);
  if (!members.length) { G.toast(who + ' cannot take orders.'); return; }
  const team = sel.level === 'soldier' ? sel.soldier.team : sel.team;

  switch (type) {
    case 'move':
      groupMove(sel, arg.x, arg.y, G.ui.moveMode);
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
      if (sel.level === 'squad') sel.squad.formation = arg; else team.formation = arg;
      G.toast(who + ': formation ' + FORMATIONS[arg].label.toLowerCase() + '.');
      break;
    case 'halt':
      releaseControllers(members);
      for (const s of members) { s.path = []; s.assault = false; s.launchQueue = null; }
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
  if (!(s.assault && G.time - s.lastFired < 1.5)) s.facing = turnToward(s.facing, a, dt * 6);
  s.fatigue = clamp(s.fatigue + (MOVE[mode].fatigue - 1.5) * dt, 0, 100);
}

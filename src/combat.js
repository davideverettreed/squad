'use strict';
// Spotting, direct fire, suppression, indirect fire (40mm, RPG, hand grenades) and wounds.

const SPOT_RANGE = 800;

function sightLine(a, b) {
  return G.map.los(a.x, a.y, POSTURE[a.posture].eye, b.x, b.y, POSTURE[b.posture].eye);
}

// Share of the target a shooter can hit: 1 fully exposed, 0.3 head only over hard cover.
function exposure(s, e) {
  const eye = POSTURE[s.posture].eye;
  const vc = G.map.los(s.x, s.y, eye, e.x, e.y, POSTURE[e.posture].center);
  if (vc > 0) return vc;
  const vh = G.map.los(s.x, s.y, eye, e.x, e.y, POSTURE[e.posture].eye);
  return vh > 0 ? 0.3 * vh : 0;
}

// ---------------------------------------------------------------- spotting
// Each side shares what any of its men can see. Detection is a roll each check;
// once seen, a man stays tracked while anyone keeps line of sight to him.
function updateSpotting() {
  for (const side of ['blue', 'red']) {
    const known = G.known[side];
    const observers = G.soldiers.filter(s => s.side === side && s.active);
    const fresh = [];
    for (const e of G.soldiers) {
      if (e.side === side || e.routed) continue;
      let entry = known.get(e.id), seenBy = null;
      for (const o of observers) {
        const d = dist(o.x, o.y, e.x, e.y);
        if (d > SPOT_RANGE) continue;
        const v = sightLine(o, e);
        if (v <= 0) continue;
        if (entry && entry.visible) { seenBy = o; break; }
        let p = 0.55 * Math.pow(clamp(1 - d / 760, 0.03, 1), 1.6);
        p *= POSTURE[e.posture].size + 0.1;
        if (e.moving) p *= e.moveMode === 'rush' ? 2.6 : e.moveMode === 'walk' ? 1.8 : 1.1;
        if (G.time - e.lastFired < 4) p *= 5;
        if (!e.alive || e.health === 'serious') p *= 0.5;
        p *= v;
        if (Math.abs(angleDiff(o.facing, angleTo(o.x, o.y, e.x, e.y))) > 1.9) p *= 0.35;
        p *= 1 - o.supp / 120;
        if (d < 25) p = Math.max(p, 0.5 * v);
        if (chance(Math.min(0.95, p))) { seenBy = o; break; }
      }
      if (seenBy) {
        if (!entry) {
          entry = { id: e.id, firstSeen: G.time };
          known.set(e.id, entry);
          if (e.active) fresh.push({ e, o: seenBy });
        }
        entry.visible = true; entry.x = e.x; entry.y = e.y; entry.t = G.time;
        entry.billet = e.billet; entry.health = e.health;
      } else if (entry) {
        entry.visible = false;
        if (G.time - entry.t > 45 && e.active) known.delete(e.id);
      }
    }
    if (side === 'blue' && fresh.length) contactReport(fresh);
  }
}

function contactReport(fresh) {
  fresh.sort((a, b) => dist(a.o.x, a.o.y, a.e.x, a.e.y) - dist(b.o.x, b.o.y, b.e.x, b.e.y));
  const { e, o } = fresh[0];
  const d = Math.round(dist(o.x, o.y, e.x, e.y) / 10) * 10;
  const what = fresh.length > 1 ? fresh.length + ' enemy' : 'enemy ' + e.title.toLowerCase();
  G.log(o.team.short + ': Contact! ' + what + ', ' + d + ' m, bearing ' + pad3(bearing(o.x, o.y, e.x, e.y)) + '.', 'contact');
}

// ---------------------------------------------------------------- direct fire
function pickTarget(s) {
  const known = G.known[s.side];
  if (s.priorityId) {
    const e = G.byId.get(s.priorityId), k = known.get(s.priorityId);
    if (!e || !e.active) s.priorityId = null;
    else if (k && k.visible) {
      const exp = exposure(s, e);
      if (exp > 0 && dist(s.x, s.y, e.x, e.y) <= s.weapon.range * 1.2) return { e, exp };
    }
  }
  const cands = [];
  for (const k of known.values()) {
    if (!k.visible) continue;
    const e = G.byId.get(k.id);
    if (!e || !e.active) continue;
    const d = dist(s.x, s.y, e.x, e.y);
    if (d > s.weapon.range * 1.2) continue;
    if (s.fireControl === 'return' && !(s.team.threats.get(e.id) > G.time - 15) && d > 40) continue;
    let sc = d;
    if (G.time - e.lastFired < 3) sc *= 0.6;
    if (e.id === s.targetId) sc *= 0.7;
    if (e.billet === 'MG' || e.billet === 'AR') sc *= 0.8;
    cands.push({ e, sc });
  }
  cands.sort((a, b) => a.sc - b.sc);
  for (let i = 0; i < cands.length && i < 4; i++) {
    const exp = exposure(s, cands[i].e);
    if (exp > 0) return { e: cands[i].e, exp };
  }
  return null;
}

function updateCombat(s, dt) {
  s.fireCD -= dt; s.launchCD -= dt; s.fragCD -= dt;
  if (s.reloadT > 0) {
    s.reloadT -= dt;
    if (s.reloadT <= 0) s.inMag = s.weapon.mag;
    return;
  }
  if (!s.active || s.routing || s.postureBusy > 0) return;

  // An explicit 40mm mission is fired even under hold fire.
  if (s.launchQueue && !s.moving && s.launchCD <= 0) {
    const q = s.launchQueue;
    if (s.lRounds <= 0 || !launchAt(s, q.x, q.y)) s.launchQueue = null;
    else if (--q.count <= 0) s.launchQueue = null;
    return;
  }
  if (s.fireControl === 'hold') return;
  if (s.moving && !(s.assault && s.moveMode === 'walk')) return;
  if (s.fireCD > 0) return;
  if (s.inMag <= 0) { startReload(s); return; }
  if (s.pinned && chance(0.6)) { s.fireCD = 1.5; return; }

  const tgt = pickTarget(s);
  if (tgt) {
    const e = tgt.e, d = dist(s.x, s.y, e.x, e.y);
    s.targetId = e.id;
    if (s.launcher && s.lRounds > 0 && s.launchCD <= 0 && !s.moving && d >= s.launcher.min && d <= s.launcher.range) {
      const clustered = G.soldiers.some(o => o !== e && o.side === e.side && o.active && dist(o.x, o.y, e.x, e.y) < 8);
      if (tgt.exp < 0.6 || clustered || chance(0.25)) { launchAt(s, e.x, e.y); s.fireCD = 2; return; }
    }
    if (s.frags > 0 && s.fragCD <= 0 && d >= 8 && d <= s.grenade.range && (tgt.exp < 0.6 || s.assault) && chance(0.5)) {
      throwFrag(s, e.x, e.y);
      s.fireCD = 1.5;
      return;
    }
    fireBurst(s, e, tgt.exp);
    return;
  }
  s.targetId = null;

  if (s.suppressPt && !s.moving) {
    const p = s.suppressPt;
    if (s.launcher && s.lRounds > 0 && s.launchCD <= 0 && chance(0.3) && launchAt(s, p.x, p.y)) { s.fireCD = 2; return; }
    fireArea(s, p.x, p.y);
    return;
  }
  // Automatic weapons keep fire on where the enemy was last seen.
  if (s.fireControl === 'free' && !s.moving && (s.billet === 'AR' || s.billet === 'MG')) {
    let best = null, bd = Infinity;
    for (const k of G.known[s.side].values()) {
      if (k.visible || G.time - k.t > 10) continue;
      const e = G.byId.get(k.id);
      if (!e || !e.active) continue;
      const d = dist(s.x, s.y, k.x, k.y);
      if (d < bd && d < s.weapon.range) { bd = d; best = k; }
    }
    if (best) { fireArea(s, best.x, best.y, 0.6); return; }
  }
  s.fireCD = 0.5;
}

function hitChance(s, e, exp, d) {
  const W = s.weapon;
  let p = W.acc * (d <= 100 ? 1 : Math.pow(100 / d, 1.1));
  if (d > W.range) p *= 0.4;
  p *= POSTURE[e.posture].size;
  if (e.moving && e.moveMode === 'rush') p *= 0.6;
  p *= exp;
  p *= POSTURE[s.posture].acc;
  if (s.moving) p *= 0.35;
  p *= 1 - s.supp / 130;
  if (s.health === 'light') p *= 0.7;
  if (s.fatigue > 60) p *= 0.8;
  if (s.pinned) p *= 0.3;
  return p;
}

function fireBurst(s, e, exp) {
  const W = s.weapon, n = Math.min(W.rounds, s.inMag), d = dist(s.x, s.y, e.x, e.y);
  s.inMag -= n; s.shots += n; s.lastFired = G.time;
  s.facing = angleTo(s.x, s.y, e.x, e.y);
  const p = hitChance(s, e, exp, d);
  let hit = false;
  for (let i = 0; i < n; i++) {
    const pi = i === 0 ? p : p * 0.55;
    const h = e.alive && e.health !== 'serious' && chance(Math.min(0.9, pi));
    if (h) { applyHit(e, s); s.hits++; hit = true; }
    const miss = h ? 0 : 1 + d * 0.02;
    addTracer(s, e.x + gauss() * miss, e.y + gauss() * miss, i * 0.07);
  }
  addSupp(e, W.supp * n * (exp < 0.5 ? 0.75 : 1) * (hit ? 1.5 : 1));
  for (const o of G.soldiers) {
    if (o !== e && o.side === e.side && o.active && dist(o.x, o.y, e.x, e.y) < 5) addSupp(o, W.supp * n * 0.4);
  }
  noteFiredUpon(e.team, s);
  s.fireCD = W.cycle * randRange(0.8, 1.3) * (s.pinned ? 2.5 : 1) * (s.moving ? 1.6 : 1);
  if (s.inMag <= 0) startReload(s);
}

// Fire at a place rather than a man: suppresses anyone near it, seen or not.
function fireArea(s, x, y, rate) {
  const W = s.weapon, d = dist(s.x, s.y, x, y);
  if (d > W.range * 1.2 || G.map.los(s.x, s.y, POSTURE[s.posture].eye, x, y, 0.6) <= 0) { s.fireCD = 1; return; }
  const n = Math.min(W.rounds, s.inMag);
  s.inMag -= n; s.shots += n; s.lastFired = G.time;
  s.facing = angleTo(s.x, s.y, x, y);
  const spread = 2 + d * 0.015;
  for (let i = 0; i < n; i++) addTracer(s, x + gauss() * spread, y + gauss() * spread, i * 0.07);
  for (const o of G.soldiers) {
    if (o.side === s.side || !o.active) continue;
    const dd = dist(o.x, o.y, x, y);
    if (dd > 8) continue;
    addSupp(o, W.supp * n * 0.7 * (1 - dd / 10));
    noteFiredUpon(o.team, s);
    if (dd < 3) {
      const exp = exposure(s, o);
      for (let i = 0; i < n; i++) if (o.alive && o.health !== 'serious' && chance(0.025 * POSTURE[o.posture].size * exp)) { applyHit(o, s); s.hits++; }
    }
  }
  s.fireCD = W.cycle * randRange(0.9, 1.4) * (s.pinned ? 2.5 : 1) / (rate || 1);
  if (s.inMag <= 0) startReload(s);
}

function startReload(s) {
  if (s.mags > 0) { s.mags--; s.reloadT = s.weapon.reload * randRange(0.9, 1.3); }
  else if (!s.dryLogged) {
    s.dryLogged = true;
    if (s.side === 'blue') G.log(s.team.short + ': ' + s.label + ' is out of ammunition.', 'warn');
  }
}

function addSupp(t, amount) {
  if (!t.active) return;
  t.supp = Math.min(100, t.supp + amount * t.squad.training * (t.team.shaken ? 1.3 : 1));
}

function noteFiredUpon(team, shooter) {
  team.lastFiredUpon = G.time;
  if (shooter) team.threats.set(shooter.id, G.time);
}

function addTracer(s, x, y, delay) {
  G.effects.push({ type: 'tracer', x1: s.x, y1: s.y, x2: x, y2: y, t: -(delay || 0), life: 0.14, side: s.side });
}

// ---------------------------------------------------------------- indirect fire
// Where a flat-trajectory rocket meets its first building or wall.
function flatImpact(ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by), n = Math.ceil(d / 0.8);
  for (let i = 4; i <= n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    const k = G.map.terAt(x, y);
    if (k === TER.BUILDING || k === TER.WALL) return { x, y };
  }
  return { x: bx, y: by };
}

function launchAt(s, x, y) {
  const L = s.launcher, d = dist(s.x, s.y, x, y);
  if (d < L.min || d > L.range) return false;
  const sc = L.scatter * d * (1 + s.supp / 100) + 1;
  let tx = x + gauss() * sc, ty = y + gauss() * sc;
  const kind = s.launcherKey === 'RPG7' ? 'rpg' : '40mm';
  if (kind === 'rpg') ({ x: tx, y: ty } = flatImpact(s.x, s.y, tx, ty));
  G.projectiles.push({ x0: s.x, y0: s.y, x1: tx, y1: ty, t: 0, flight: dist(s.x, s.y, tx, ty) / L.vel + 0.05, fuse: 0,
    spec: L, side: s.side, shooter: s, kind });
  s.lRounds--; s.launchCD = L.cycle * randRange(1, 1.5); s.lastFired = G.time;
  s.facing = angleTo(s.x, s.y, x, y);
  G.effects.push({ type: 'flash', x: s.x, y: s.y, t: 0, life: 0.2 });
  return true;
}

function throwFrag(s, x, y) {
  const R = s.grenade;
  let d = dist(s.x, s.y, x, y);
  if (d > R.range) {
    const a = angleTo(s.x, s.y, x, y);
    x = s.x + Math.cos(a) * R.range; y = s.y + Math.sin(a) * R.range; d = R.range;
  }
  const sc = 1 + d * 0.08 + s.supp / 40;
  G.projectiles.push({ x0: s.x, y0: s.y, x1: x + gauss() * sc, y1: y + gauss() * sc, t: 0, flight: d / 14, fuse: R.fuse,
    spec: R, side: s.side, shooter: s, kind: 'frag' });
  s.frags--; s.fragCD = 8; s.lastFired = G.time;
  s.loadKg = s.computeLoad();
  if (s.side === 'blue') G.log(s.team.short + ': Frag out!', 'fire');
}

function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.t += dt;
    if (p.t >= p.flight + p.fuse) {
      explode(p.x1, p.y1, p.spec, p.side, p.shooter);
      G.projectiles.splice(i, 1);
    }
  }
}

function explode(x, y, spec, side, shooter) {
  G.effects.push({ type: 'blast', x, y, r: spec.casualty, t: 0, life: 0.7 });
  for (const o of G.soldiers) {
    if (!o.alive || o.routed) continue;
    const d = dist(o.x, o.y, x, y);
    if (d < spec.casualty && o.health !== 'serious') {
      const shielded = G.map.los(x, y, 0.4, o.x, o.y, POSTURE[o.posture].center) <= 0;
      let p = d < spec.lethal ? 0.8 : 0.4 * (1 - (d - spec.lethal) / (spec.casualty - spec.lethal));
      if (o.posture === 'prone') p *= 0.55;
      if (shielded) p *= 0.12;
      if (chance(p)) { applyHit(o, shooter, true); if (shooter && o.side !== shooter.side) shooter.hits++; }
    }
    if (d < spec.casualty * 1.6 && o.active) {
      addSupp(o, 70 * (1 - d / (spec.casualty * 1.6)));
      if (o.side !== side) noteFiredUpon(o.team, shooter);
    }
  }
}

// ---------------------------------------------------------------- wounds and morale
function applyHit(t, shooter, blast) {
  if (!t.alive || t.health === 'serious') return;
  const r = rand();
  let res;
  if (t.health === 'light') res = r < 0.4 ? 'kia' : 'serious';
  else res = r < (blast ? 0.3 : 0.25) ? 'kia' : r < 0.62 ? 'serious' : 'light';
  t.health = res; t.lastHitAt = G.time;
  G.stats[t.side][res]++;
  if (res === 'light') {
    t.supp = Math.min(100, t.supp + 40);
    if (t.side === 'blue') G.log(t.team.short + ': ' + t.label + ' is wounded, still in the fight.', 'warn');
    G.floaters.push({ id: t.id, x: t.x, y: t.y, text: 'WIA', t: 0, life: 1.6, side: t.side });
    return;
  }
  t.path = []; t.posture = 'prone'; t.suppressPt = null; t.launchQueue = null; t.assault = false;
  G.floaters.push({ id: t.id, x: t.x, y: t.y, text: res === 'kia' ? 'KIA' : 'CASUALTY', t: 0, life: 2, side: t.side });
  casualtyEvent(t, res);
}

function casualtyEvent(t, res) {
  const team = t.team, sq = t.squad;
  const leader = t.billet === 'SL' || t.billet === 'TL';
  team.morale -= leader ? 22 : 14;
  for (const other of sq.teams) if (other !== team) other.morale -= t.billet === 'SL' ? 12 : 4;
  for (const tm of [sq.hq, ...sq.teams]) tm.morale = clamp(tm.morale, 0, 100);
  for (const o of sq.all) if (o !== t && o.active && dist(o.x, o.y, t.x, t.y) < 30) addSupp(o, 22);
  if (t.side === 'blue') {
    const what = res === 'kia' ? 'killed' : 'down, serious casualty';
    G.log((leader ? t.title + ' ' : '') + t.label + ' is ' + what + '.', 'loss');
    if (t.billet === 'TL' && team.leader) G.log(team.short + ': ' + team.leader.label + ' takes command of the team.', 'info');
    if (t.billet === 'SL') {
      const next = sq.teams.map(tm => tm.members.find(s => s.billet === 'TL' && s.active)).find(Boolean);
      if (next) G.log(next.label + ' assumes command of the squad.', 'info');
    }
  } else if (G.known.blue.get(t.id)?.visible) {
    G.log('Enemy ' + t.title.toLowerCase() + ' hit.', 'kill');
  }
}

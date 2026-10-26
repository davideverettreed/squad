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
    let observers = G.soldiers.filter(s => s.side === side && s.active);
    // A large force (a war party, a company) looks with a share of its men each check, in
    // turn, so a check stays quick; what any one of them sees, all know.
    if (observers.length > 48) {
      const k = Math.ceil(observers.length / 48), ph = (G.spotPhase = ((G.spotPhase || 0) + 1) % 997);
      observers = observers.filter((o, i) => (i + ph) % k === 0 || (o.billet === 'SL' || o.billet === 'TL'));
    }
    const fresh = [];
    for (const e of G.soldiers) {
      if (e.side === side || e.routed) continue;
      let entry = known.get(e.id), seenBy = null;
      for (const o of observers) {
        const d = dist(o.x, o.y, e.x, e.y);
        if (d > SPOT_RANGE) continue;
        if (entry && entry.visible) { if (sightLine(o, e) > 0) { seenBy = o; break; } continue; }
        let p = 0.55 * Math.pow(clamp(1 - d / 760, 0.03, 1), 1.6);
        p *= POSTURE[e.posture].size + 0.1;
        if (e.moving) p *= e.moveMode === 'rush' ? 2.6 : e.moveMode === 'walk' ? 1.8 : 1.1;
        // A shot gives a man away: for a few seconds, longer under a cloud of black-powder
        // smoke; hardly at all with a bow or a silenced rifle.
        if (G.time - e.lastFired < (e.weapon.smoke ? 12 : e.weapon.quiet ? 2 : 4)) p *= e.weapon.quiet ? 1.6 : 5;
        if (!e.alive || e.health === 'serious') p *= 0.5;
        // Inside the cone a man sees well; at the edge of his vision poorly; behind him hardly at all.
        const off = Math.abs(angleDiff(o.look, angleTo(o.x, o.y, e.x, e.y)));
        p *= off <= o.coneHalf ? 1.25 : off < 1.75 ? 0.45 : 0.12;
        p *= 1 - o.supp / 120;
        if (o.relaxed) p *= 0.3; // at rest, not on watch
        // The chance is p times the share of the line of sight that is clear. Rolling first
        // and tracing the line only when the roll could succeed gives the same odds, cheaply.
        const r = rand(), close = d < 25 ? 0.5 : 0;
        if (r >= Math.min(0.95, Math.max(p, close))) continue;
        const v = sightLine(o, e);
        if (v <= 0) continue;
        if (r < Math.min(0.95, Math.max(p * v, close * v))) { seenBy = o; break; }
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

// ---------------------------------------------------------------- where each man looks
// A man sweeps his sector left and right. Calm, the sweep is wide and slow. Alert, with
// the enemy known to be near or recent fire, it narrows toward the threat and quickens.
// Agitated, suppressed or under fire, it is fast and erratic, with sudden glances aside.
// A man firing holds his eyes on his target.
function updateLook(s, dt) {
  if (!s.active) return;
  const sinceFire = G.time - s.team.lastFiredUpon;
  const threat = threatPoint(s);
  s.alert = threat ? 1 : sinceFire < 30 ? 0.6 : 0;
  s.agit = clamp(Math.max(s.supp / 80, sinceFire < 4 ? 0.6 : 0), 0, 1);
  s.coneHalf = 0.5 - 0.14 * s.alert;

  const aiming = G.time - s.lastFired < 2.5;
  const tgt = aiming && s.targetId ? G.byId.get(s.targetId) : null;
  const aimAt = tgt ? tgt : aiming && s.suppressPt ? s.suppressPt : null;
  if (aimAt) {
    s.look = turnToward(s.look, angleTo(s.x, s.y, aimAt.x, aimAt.y) + gauss() * 0.02, dt * 8);
    s.coneHalf = 0.22;
    return;
  }
  let center;
  if (s.faceAngle != null) center = s.faceAngle;
  else if (s.moving) center = angleTo(s.x, s.y, s.path[0].x, s.path[0].y);
  else if (threat) center = angleTo(s.x, s.y, threat.x, threat.y);
  else center = s.facing;
  const amp = (1 - 0.45 * s.alert) * (s.moving ? 0.6 : 1.05) + 0.35 * s.agit;
  const rate = 0.7 + 1.6 * s.alert + 3.5 * s.agit;
  s.scanPhase += rate * dt * (1 + (s.agit > 0.3 ? gauss() * 0.6 * s.agit : 0));
  if (s.agit > 0.4 && chance(dt * s.agit * 1.5)) s.scanJerk = gauss() * 0.7 * s.agit;
  s.scanJerk *= Math.max(0, 1 - dt * 2);
  s.look = turnToward(s.look, center + Math.sin(s.scanPhase) * amp + s.scanJerk, dt * (2.5 + 5 * s.agit));
}

// ---------------------------------------------------------------- direct fire
function pickTarget(s) {
  const known = G.known[s.side];
  // How far he will engage: his weapon's reach, or his launcher's if it carries farther
  // (an M79 grenadier whose own arm is a pistol).
  const reach = Math.max(s.weapon.range, s.launcher && s.lRounds > 0 ? s.launcher.range : 0) * 1.2;
  if (s.priorityId) {
    const e = G.byId.get(s.priorityId), k = known.get(s.priorityId);
    if (!e || !e.active) s.priorityId = null;
    else if (k && k.visible) {
      const exp = exposure(s, e);
      if (exp > 0 && dist(s.x, s.y, e.x, e.y) <= reach) return { e, exp };
    }
  }
  const cands = [];
  for (const k of known.values()) {
    if (!k.visible) continue;
    const e = G.byId.get(k.id);
    if (!e || !e.active) continue;
    const d = dist(s.x, s.y, e.x, e.y);
    if (d > reach) continue;
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
    // Caught reloading, a man still fights whoever reaches him.
    if (s.active && !s.routing && s.postureBusy <= 0) updateMelee(s, dt);
    return;
  }
  if (!s.active || s.routing || s.postureBusy > 0) return;
  if (updateMelee(s, dt)) return;

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
      // Out of reach of his own arm, the launcher is all he has.
      const beyond = d > s.weapon.range * 1.2;
      if (beyond || tgt.exp < 0.6 || clustered || chance(0.25)) { launchAt(s, e.x, e.y); s.fireCD = 2; return; }
    }
    if (d > s.weapon.range * 1.2) { s.fireCD = 1; return; }
    if (s.frags > 0 && s.fragCD <= 0 && d >= 8 && d <= s.grenade.range && (tgt.exp < 0.6 || s.assault) && fragSafe(s, e.x, e.y) && chance(0.6)) {
      throwFrag(s, e.x, e.y);
      s.fireCD = 1.5;
      return;
    }
    fireBurst(s, e, tgt.exp);
    return;
  }
  s.targetId = null;

  // An enemy last seen within throwing range, gone behind cover: a grenade over it.
  if (s.frags > 0 && s.fragCD <= 0 && !s.moving && s.fireControl === 'free' && !Plan.planning) {
    for (const k of G.known[s.side].values()) {
      if (k.visible || G.time - k.t > 20) continue;
      const e = G.byId.get(k.id), d = dist(s.x, s.y, k.x, k.y);
      if (!e || !e.active || d < 8 || d > s.grenade.range || !fragSafe(s, k.x, k.y) || !chance(0.5)) continue;
      throwFrag(s, k.x, k.y);
      s.fireCD = 1.5;
      return;
    }
  }

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
  // Close in, the weapon's best; halved at its r50 and falling with the square of the range.
  let p = W.acc / (1 + (d / W.r50) * (d / W.r50));
  if (d > W.range) p *= 0.4;
  p *= s.skill || 1;
  p *= POSTURE[e.posture].size;
  p *= 1 - 0.35 * Plan.digIn(e); // dug-in defenders are harder to hit
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

// Fire discipline: the rapid rate at an exposed enemy inside 300 m, in the assault or when
// the team has just been fired on; otherwise the sustained rate, about a third as fast.
// A man low on ammunition slows down again to make it last.
function fireDelay(s, d, exposed) {
  const rapid = s.assault || (exposed && d < 300) || G.time - s.team.lastFiredUpon < 6;
  let k = rapid ? 1 : 2.6;
  if (s.ammoFrac < 0.3) k *= 1.6;
  return s.weapon.cycle * k;
}

function fireBurst(s, e, exp) {
  const W = s.weapon, n = Math.min(W.rounds, s.inMag), d = dist(s.x, s.y, e.x, e.y);
  s.inMag -= n; s.shots += n; s.lastFired = G.time;
  wstat(s, s.weapon).shots += n;
  s.facing = angleTo(s.x, s.y, e.x, e.y);
  muzzle(s);
  const p = hitChance(s, e, exp, d);
  let hit = false;
  for (let i = 0; i < n; i++) {
    const pi = i === 0 ? p : p * 0.55;
    const h = e.alive && e.health !== 'serious' && chance(Math.min(0.9, pi));
    if (h) { applyHit(e, s, false, null, s.weapon); s.hits++; hit = true; }
    const miss = h ? 0 : 1 + d * 0.02;
    addTracer(s, e.x + gauss() * miss, e.y + gauss() * miss, i * 0.07);
  }
  addSupp(e, W.supp * n * (exp < 0.5 ? 0.75 : 1) * (hit ? 1.5 : 1));
  for (const o of G.soldiers) {
    if (o !== e && o.side === e.side && o.active && dist(o.x, o.y, e.x, e.y) < 5) addSupp(o, W.supp * n * 0.4);
  }
  noteFiredUpon(e.team, s);
  s.fireCD = fireDelay(s, d, exp >= 0.6) * randRange(0.8, 1.3) * (s.pinned ? 2.5 : 1) * (s.moving ? 1.6 : 1);
  stoppage(s);
  if (s.inMag <= 0) startReload(s);
}

// Black powder leaves a cloud of white smoke at the muzzle.
function muzzle(s) {
  if (s.weapon.smoke) G.effects.push({ type: 'smoke', x: s.x + Math.cos(s.facing) * 2, y: s.y + Math.sin(s.facing) * 2, t: 0, life: 9 });
}

// A weapon prone to stoppages (the Chauchat above all) sometimes has to be cleared.
function stoppage(s) {
  if (!s.weapon.jam || !chance(s.weapon.jam)) return;
  s.fireCD = Math.max(s.fireCD, randRange(5, 10));
  if (s.side === 'blue' && G.time - (s.jamLogT || -99) > 30) { s.jamLogT = G.time; G.log(s.team.short + ': ' + s.label + '\'s ' + s.weapon.name + ' has jammed.', 'warn'); }
}

// Fire at a place rather than a man: suppresses anyone near it, seen or not.
function fireArea(s, x, y, rate) {
  const W = s.weapon, d = dist(s.x, s.y, x, y);
  if (d > W.range * 1.2 || G.map.los(s.x, s.y, POSTURE[s.posture].eye, x, y, 0.6) <= 0) { s.fireCD = 1; return; }
  const n = Math.min(W.rounds, s.inMag);
  s.inMag -= n; s.shots += n; s.lastFired = G.time;
  wstat(s, s.weapon).shots += n;
  s.facing = angleTo(s.x, s.y, x, y);
  muzzle(s);
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
      for (let i = 0; i < n; i++) if (o.alive && o.health !== 'serious' && chance(0.025 * POSTURE[o.posture].size * exp)) { applyHit(o, s, false, null, s.weapon); s.hits++; }
    }
  }
  s.fireCD = fireDelay(s, d, false) * randRange(0.9, 1.4) * (s.pinned ? 2.5 : 1) / (rate || 1);
  stoppage(s);
  if (s.inMag <= 0) startReload(s);
}

// Magazines passed between men who carry the same kind: a man nearly dry takes two from a
// teammate with plenty, or what a casualty beside him still carries.
function shareAmmo() {
  for (const s of G.soldiers) {
    if (!commandable(s) || s.reloadT > 0 || s.ammoLeft > s.weapon.mag * 1.5) continue;
    let donor = null, give = 0;
    for (const o of G.soldiers) {
      if (o === s || o.side !== s.side || o.routed || o.weapon.magType !== s.weapon.magType || o.weapon.mag !== s.weapon.mag) continue;
      const down = !o.active, d = dist(s.x, s.y, o.x, o.y);
      if (down ? d > 10 : (d > 25 || o.mags <= 3)) continue;
      const n = down ? o.mags : Math.min(2, o.mags - 3);
      if (n > give) { give = n; donor = o; }
    }
    if (!donor || give <= 0) continue;
    donor.mags -= give; s.mags += give;
    s.fireCD = Math.max(s.fireCD, 3); s.dryLogged = false;
    s.loadKg = s.computeLoad(); donor.loadKg = donor.computeLoad();
    if (s.side === 'blue' && G.time - (s.team.ammoLogT || -99) > 30) {
      s.team.ammoLogT = G.time;
      G.log(s.team.short + ': ' + s.label + ' takes ' + give + ' magazines from ' + (donor.active ? donor.label : 'a casualty') + '.', 'warn');
    }
  }
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
  t.supp = Math.min(100, t.supp + amount * t.squad.training * (t.team.shaken ? 1.3 : 1) * (1 - 0.3 * Plan.digIn(t)));
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
  const kind = L.flat ? 'rpg' : '40mm';
  if (kind === 'rpg') ({ x: tx, y: ty } = flatImpact(s.x, s.y, tx, ty));
  G.projectiles.push({ x0: s.x, y0: s.y, x1: tx, y1: ty, t: 0, flight: dist(s.x, s.y, tx, ty) / L.vel + 0.05, fuse: 0,
    spec: L, side: s.side, shooter: s, kind });
  s.lRounds--; wstat(s, L).shots++; s.launchCD = L.cycle * randRange(1, 1.5); s.lastFired = G.time;
  s.facing = angleTo(s.x, s.y, x, y);
  G.effects.push({ type: 'flash', x: s.x, y: s.y, t: 0, life: 0.2 });
  return true;
}

// No friend within the grenade's casualty radius of where it should land.
function fragSafe(s, x, y) {
  const r = s.grenade.casualty * 0.8;
  return !G.soldiers.some(o => o.side === s.side && o.active && dist(o.x, o.y, x, y) < r);
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
    spec: R, side: s.side, shooter: s, kind: 'frag', dud: R.dud && chance(R.dud) });
  s.frags--; wstat(s, R).shots++; s.fragCD = 8; s.lastFired = G.time;
  s.loadKg = s.computeLoad();
  if (s.side === 'blue') G.log(s.team.short + ': Frag out!', 'fire');
}

function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.t += dt;
    if (p.t >= p.flight + p.fuse) {
      if (!p.dud) explode(p.x1, p.y1, p.spec, p.side, p.shooter);
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
      if (chance(p)) { applyHit(o, shooter, true, null, spec); if (shooter && o.side !== shooter.side) shooter.hits++; }
    }
    if (d < spec.casualty * 1.6 && o.active) {
      addSupp(o, 70 * (1 - d / (spec.casualty * 1.6)));
      if (o.side !== side) noteFiredUpon(o.team, shooter);
    }
  }
}

// ---------------------------------------------------------------- wounds and morale
// How badly a hit wounds goes with what made it (dmg, against 5.56 mm = 1): a .22 rimfire
// round mostly wounds lightly, a musket ball or a full-power rifle round seldom does.
function applyHit(t, shooter, blast, dmg, src) {
  if (!t.alive || t.health === 'serious') return;
  // Tally what each weapon did to the enemy (not to friends).
  const tally = src && shooter && shooter.side !== t.side ? wstat(shooter, src) : null;
  if (tally) tally.hits++;
  // And what each man did: his own tally of the enemy hit, killed and wounded.
  const mine = tally ? (shooter.score = shooter.score || { kia: 0, serious: 0, light: 0 }) : null;
  const m = blast ? 1.1 : dmg != null ? dmg : shooter && shooter.weapon ? shooter.weapon.dmg || 1 : 1;
  const r = rand();
  let res;
  if (t.health === 'light') {
    const k = clamp(0.4 * m, 0.1, 0.7), sv = clamp(0.6 * Math.sqrt(m), 0.2, 0.9);
    res = r < k ? 'kia' : r < k + sv ? 'serious' : 'light';
    if (res === 'light') { t.supp = Math.min(100, t.supp + 30); t.lastHitAt = G.time; return; }
    if (tally) { tally[res]++; mine[res]++; }
  } else {
    const k = clamp(0.25 * Math.pow(m, 1.3), 0.03, 0.6), sv = clamp(0.37 * Math.pow(m, 0.7), 0.1, 0.55);
    res = r < k ? 'kia' : r < k + sv ? 'serious' : 'light';
    if (tally) { tally[res]++; mine[res]++; }
  }
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
    G.log((leader ? t.title + ' ' + t.name : t.label) + ' is ' + what + '.', 'loss');
    if (t.billet === 'TL' && team.leader) G.log(team.short + ': ' + team.leader.label + ' takes command of the team.', 'info');
    if (t.billet === 'SL') {
      const next = sq.teams.map(tm => tm.members.find(s => s.billet === 'TL' && s.active)).find(Boolean);
      if (next) G.log(next.label + ' assumes command.', 'info');
    }
  } else if (G.known.blue.get(t.id)?.visible) {
    G.log('Enemy ' + t.title.toLowerCase() + ' hit.', 'kill');
  }
}

// ---------------------------------------------------------------- hand to hand
// A man with an enemy within arm's reach fights him: a loaded weapon is fired point-blank,
// otherwise it is the bayonet, the club, the hatchet or the rifle butt.
function updateMelee(s, dt) {
  s.meleeCD = (s.meleeCD || 0) - dt;
  if (s.meleeCD > 0 || !s.active || s.routing) return false;
  let foe = null, fd = 2.6, near = Infinity;
  for (const o of G.soldiers) {
    if (o.side === s.side || !o.active) continue;
    const dx = Math.abs(o.x - s.x), dy = Math.abs(o.y - s.y), m = Math.max(dx, dy);
    if (m < near) near = m;
    if (dx > fd || dy > fd) continue;
    const d = Math.hypot(dx, dy);
    if (d < fd) { fd = d; foe = o; }
  }
  // No one within reach: look again when the nearest enemy could have closed the distance.
  if (!foe) { s.meleeCD = Math.max(0.4, (near - 3) / 8); return false; }
  s.meleeCD = randRange(0.9, 1.5);
  s.facing = angleTo(s.x, s.y, foe.x, foe.y);
  s.lastFired = G.time; s.path = [];
  noteFiredUpon(foe.team, s);
  addSupp(foe, 15);
  if (s.inMag > 0 && s.reloadT <= 0 && !s.weapon.quiet && s.weapon.range > 60 && chance(0.5)) {
    s.inMag--; s.shots++; muzzle(s); wstat(s, s.weapon).shots++;
    if (chance(0.6 * (s.skill || 1))) { applyHit(foe, s, false, null, s.weapon); s.hits++; }
    if (s.inMag <= 0) startReload(s);
    return true;
  }
  const M = MELEE[s.meleeKey] || MELEE.butt, F = MELEE[foe.meleeKey] || MELEE.butt;
  // The better armed and the less shaken man has the edge.
  const p = 0.32 * M.skill / Math.sqrt(F.skill) * (1 - s.supp / 200) * (foe.supp > 50 ? 1.3 : 1) * (s.skill || 1);
  wstat(s, M).shots++;
  if (chance(clamp(p, 0.05, 0.7))) {
    applyHit(foe, s, false, M.dmg, M); s.hits++;
    if (s.side === 'blue' && G.time - (s.team.meleeLogT || -99) > 20) { s.team.meleeLogT = G.time; G.log(s.team.short + ': Hand to hand!', 'contact'); }
  }
  return true;
}

// ---------------------------------------------------------------- tallies by weapon
// What each side's weapons fired and did: rounds (or grenades, rockets, blows), hits, and
// the enemy killed, seriously wounded and lightly wounded. A man hit again counts again.
function weaponClass(W) {
  if (MELEE[Object.keys(MELEE).find(k => MELEE[k] === W)]) return 'Hand to hand';
  if (Object.values(GRENADES).includes(W)) return 'Hand grenades';
  if (Object.values(LAUNCHERS).includes(W)) return W.flat ? 'Rockets' : 'Grenade launchers';
  if (W.magType === 'arrow') return 'Bows';
  if (W.smoke && W.mag === 1) return W.range < 50 ? 'Pistols, shotguns' : 'Muskets, black-powder rifles';
  if (W.rounds >= 5) return 'Machine guns';
  if (W.rounds >= 3) return W.range > 150 ? 'Automatic rifles' : 'Submachine guns';
  if (W.range <= 60) return 'Pistols, shotguns';
  if (W.acc >= 0.6) return 'Sniper and marksman rifles';
  return 'Rifles, carbines';
}
function wstat(s, W) {
  const side = (G.wstats = G.wstats || { blue: new Map(), red: new Map() })[s.side];
  let e = side.get(W.name);
  if (!e) { e = { name: W.name, cls: weaponClass(W), shots: 0, hits: 0, kia: 0, serious: 0, light: 0 }; side.set(W.name, e); }
  return e;
}

'use strict';
// Soldiers, fire teams and squads, and the builders for each side.

let NEXT_ID = 1;
const ORDINAL = ['1st', '2nd', '3rd', '4th'];
function ordinal(n) { const t = n % 100, u = n % 10; return n + (t > 10 && t < 14 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'); }

class Soldier {
  constructor(side, billet, team, cfg) {
    this.id = NEXT_ID++;
    this.side = side;
    this.billet = billet;
    this.team = team;
    this.squad = team.squad;
    this.title = cfg.title;
    this.rank = cfg.rank || '';
    this.name = cfg.name;
    this.x = 0; this.y = 0;
    this.facing = side === 'blue' ? -Math.PI / 2 : Math.PI / 2;
    this.faceAngle = null;
    this.posture = 'kneel'; this.homePosture = 'kneel'; this.postureBusy = 0;
    this.postureCheckT = 0; this.postureAdj = null;
    this.moveMode = 'walk'; this.path = [];
    this.health = 'ok'; this.supp = 0; this.fatigue = 0;
    this.weaponKey = cfg.weapon; this.weapon = WEAPONS[cfg.weapon];
    this.inMag = this.weapon.mag;
    this.mags = cfg.mags != null ? cfg.mags : this.weapon.mags - 1;
    this.launcherKey = cfg.launcher || null;
    this.launcher = cfg.launcher ? LAUNCHERS[cfg.launcher] : null;
    this.lRounds = this.launcher ? (cfg.lRounds != null ? cfg.lRounds : this.launcher.rounds) : 0;
    this.grenadeKey = cfg.grenade || (side === 'blue' ? 'M67' : 'RGD5');
    this.grenade = GRENADES[this.grenadeKey];
    this.frags = cfg.frags != null ? cfg.frags : 2;
    this.meleeKey = cfg.melee || 'butt';
    this.skill = cfg.skill || team.squad.skill || 1; // marksmanship
    this.fireControl = 'free';
    this.targetId = null; this.priorityId = null; this.suppressPt = null; this.launchQueue = null;
    this.fireCD = randRange(0.3, 1.5); this.reloadT = 0; this.launchCD = randRange(2, 5); this.fragCD = 0;
    this.lastFired = -99; this.lastHitAt = -99;
    this.look = this.facing; this.scanPhase = randRange(0, Math.PI * 2); this.scanJerk = 0;
    this.coneHalf = 0.5; this.alert = 0; this.agit = 0;
    this.assault = false; this.routing = false; this.routed = false;
    this.shots = 0; this.hits = 0; this.dryLogged = false;
    this.ammoStart = this.ammoLeft; this.fragsStart = this.frags; this.lStart = this.lRounds;
    this.loadKg = this.computeLoad();
  }
  get alive() { return this.health !== 'kia'; }
  get active() { return (this.health === 'ok' || this.health === 'light') && !this.routed; }
  get pinned() { return this.supp >= 85; }
  get suppressed() { return this.supp >= 50; }
  get moving() { return this.path.length > 0; }
  get label() { return (this.rank ? this.rank + ' ' : '') + this.name; }

  computeLoad() {
    let kg = 22; // helmet, plate carrier, water, kit
    kg += this.weapon.kg + (this.mags + 1) * (MAG_KG[this.weapon.mag] || 0.5);
    if (this.launcher) kg += 1.4 + this.lRounds * this.launcher.kg;
    kg += this.frags * this.grenade.kg;
    return kg;
  }
  get loadFactor() { return clamp(1 - (this.loadKg - 30) / 70, 0.72, 1.05); }

  get statusText() {
    if (this.health === 'kia') return 'KIA';
    if (this.health === 'serious') return 'Casualty';
    if (this.routed) return 'Withdrawn';
    if (this.routing) return 'Falling back';
    if (this.pinned) return 'Pinned';
    if (this.suppressed) return 'Suppressed';
    if (this.health === 'light') return 'Wounded';
    if (this.reloadT > 0) return 'Reloading';
    if (this.moving) return MOVE[this.moveMode].label === 'Walk' ? 'Moving' : MOVE[this.moveMode].label + 'ing';
    if (this.lastFired > G.time - 2) return 'Firing';
    return 'Ready';
  }
  // Rounds left: the magazine in the weapon and the spares.
  get ammoLeft() { return this.inMag + this.mags * this.weapon.mag; }
  get ammoFrac() { return this.ammoStart ? clamp(this.ammoLeft / this.ammoStart, 0, 1) : 0; }
  get ammoText() {
    if (this.ammoLeft === 0) return 'Out';
    return this.ammoLeft + ' rds';
  }
}

class Team {
  constructor(side, squad, num, name) {
    this.side = side; this.squad = squad; this.num = num; this.name = name;
    this.members = [];
    this.formation = 'wedge';
    this.spacing = 1; // interval between men, as a share of the standard (about 7 m)
    this.morale = squad.morale;
    this.lastFiredUpon = -99;
    this.threats = new Map(); // enemy id -> time it last fired at this team
    this.task = null;         // AI task
  }
  get leader() { return this.members.find(s => s.active) || null; }
  get active() { return this.members.filter(s => s.active); }
  get short() { return this.num ? ordinal(this.num) + ' ' + (this.squad.teamWord || 'FT') : this.squad.hqShort || 'SL'; }
  get broken() { return this.morale < 12; }
  get shaken() { return this.morale < 28; }
}

class Squad {
  constructor(side, name, morale) {
    this.side = side; this.name = name; this.morale = morale;
    this.teams = []; this.hq = null; this.leader = null;
    this.formation = 'wedge';
    this.spacing = 1; // interval between teams, as a share of the standard
    this.training = 1;
    this.skill = 1;
    this.teamWord = 'FT'; this.teamName = 'Fire Team';
  }
  get all() { return [this.hq, ...this.teams].flatMap(t => t.members); }
  get active() { return this.all.filter(s => s.active); }
}

function defaultLoadout() {
  const lo = {};
  for (const k of Object.keys(USMC_BILLETS)) {
    const b = USMC_BILLETS[k];
    lo[k] = { weapon: b.weapon, mags: WEAPONS[b.weapon].mags - 1, frags: 2, launcher: b.launcher || null,
      lRounds: b.launcher ? LAUNCHERS[b.launcher].rounds : 0 };
  }
  return lo;
}

// Re-equip a squad that is already on the map (loadout changes while planning).
function applyLoadout(sq, lo) {
  for (const s of sq.all) {
    const l = lo[s.billet];
    if (!l) continue;
    s.weaponKey = l.weapon; s.weapon = WEAPONS[l.weapon];
    s.inMag = s.weapon.mag; s.mags = l.mags; s.frags = l.frags;
    s.launcherKey = l.launcher || null; s.launcher = l.launcher ? LAUNCHERS[l.launcher] : null;
    s.lRounds = s.launcher ? l.lRounds : 0;
    s.ammoStart = s.ammoLeft; s.fragsStart = s.frags; s.lStart = s.lRounds; s.dryLogged = false;
    s.loadKg = s.computeLoad();
  }
}

function buildUSMCSquad(loadout) {
  const sq = new Squad('blue', '1st Squad', 82);
  sq.training = 0.85; sq.kind = 'usmc';
  const names = shuffle(SURNAMES.slice());
  const make = (key, team) => {
    const b = USMC_BILLETS[key], lo = loadout[key];
    const s = new Soldier('blue', key, team, { title: b.title, rank: b.rank, name: names.pop(), weapon: lo.weapon,
      mags: lo.mags, frags: lo.frags, launcher: lo.launcher, lRounds: lo.lRounds, melee: 'bayonet' });
    team.members.push(s);
    return s;
  };
  sq.hq = new Team('blue', sq, 0, 'Squad Leader');
  sq.leader = make('SL', sq.hq);
  for (let k = 1; k <= 3; k++) {
    const t = new Team('blue', sq, k, ORDINAL[k - 1] + ' Fire Team');
    for (const key of TEAM_ORDER) make(key, t);
    sq.teams.push(t);
  }
  return sq;
}

// Random opposing force: a leader and two or three groups of three to five men.
function buildOpforSquad() {
  const sq = new Squad('red', 'Enemy squad', randRange(55, 80));
  const make = (key, team) => {
    const b = OPFOR_BILLETS[key];
    const weapon = b.alt && chance(0.35) ? b.alt : b.weapon;
    const s = new Soldier('red', key, team, { title: b.title, name: b.title, weapon, launcher: b.launcher,
      frags: randInt(1, 2) });
    team.members.push(s);
    return s;
  };
  sq.hq = new Team('red', sq, 0, 'Enemy leader');
  sq.leader = make('SL', sq.hq);
  const n = randInt(2, 3);
  for (let k = 1; k <= n; k++) {
    const t = new Team('red', sq, k, 'Enemy group ' + k);
    make('TL', t);
    const size = randInt(2, 3);
    for (let i = 0; i < size; i++) make(pick(OPFOR_POOL), t);
    sq.teams.push(t);
  }
  return sq;
}

// Lay a squad out in its formation around (x, y), facing heading.
function placeSquad(sq, map, x, y, heading) {
  const n = sq.teams.length;
  const put = (s, px, py) => {
    const c = map.nearestPassable(Math.floor(clamp(px, 2, MAP_W - 2) / CELL), Math.floor(clamp(py, 2, MAP_H - 2) / CELL));
    s.x = (c.cx + 0.5) * CELL; s.y = (c.cy + 0.5) * CELL;
    s.facing = heading; s.look = heading;
  };
  sq.teams.forEach((t, k) => {
    const q = scaled(squadSlot(sq.formation, k, n), sq.spacing), a = rotateOffset(q.x, q.y, heading);
    t.members.forEach((s, i) => {
      const o = scaled(teamSlot(t.formation, i), t.spacing), w = rotateOffset(o.x, o.y, heading);
      put(s, x + a.x + w.x, y + a.y + w.y);
    });
  });
  const so = scaled(squadLeaderSlot(sq.formation), sq.spacing), w = rotateOffset(so.x, so.y, heading);
  put(sq.leader, x + w.x, y + w.y);
  // Anyone else at the command post (a deputy, a sniper, a radio operator) beside the leader.
  sq.hq.members.filter(s => s !== sq.leader).forEach((s, i) => {
    const o = rotateOffset(so.x + (i % 2 ? -4 : 4) * Math.ceil((i + 1) / 2), so.y - 3, heading);
    put(s, x + o.x, y + o.y);
  });
}

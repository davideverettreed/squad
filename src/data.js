'use strict';
// Static game data: map scale, terrain, postures, weapons, billets, formations.
// Weapon figures are game abstractions tuned for play, loosely scaled from
// published effective ranges and rates of fire; they are not ballistic tables.

const CELL = 4;                    // meters per terrain cell
const MAP_W = 3000, MAP_H = 3000;  // meters: nine 1 km grid squares
const GW = MAP_W / CELL, GH = MAP_H / CELL;

const TER = {
  OPEN: 0, GRASS: 1, WOODS: 2, ROAD: 3, BUILDING: 4, WALL: 5, PLOWED: 6,
  ORCHARD: 7, VINEYARD: 8, STREAM: 9, POND: 10, PAVED: 11, SWAMP: 12, RIVER: 13, FORD: 14,
  OCEAN: 15, BEACH: 16, CHAPARRAL: 17, BRUSH: 18, DESERT: 19, ROCK: 20, SNOW: 21, ICE: 22, WASH: 23,
};

// losH: height above ground the feature blocks sight to.
// density: share of sight blocked per meter of the feature crossed (vegetation).
// cover: share of rounds stopped for a man inside or behind it.
const TERRAIN = [
  { name: 'Open field',   speed: 1.0,  losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Tall grass',   speed: 0.8,  losH: 0.9, density: 0.1,   cover: 0,   conceal: 0.5 },
  { name: 'Woods',        speed: 0.6,  losH: 12,  density: 0.14,  cover: 0.3, conceal: 0.6 },
  { name: 'Dirt road',    speed: 1.15, losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Building',     speed: 0,    losH: 6.5, solid: true,    cover: 1,   conceal: 1 },
  { name: 'Stone wall',   speed: 0.3,  losH: 1.0, solid: true,    cover: 0.9, conceal: 0.3 },
  { name: 'Plowed field', speed: 0.85, losH: 0,   density: 0,     cover: 0,   conceal: 0.1 },
  { name: 'Orchard',      speed: 0.9,  losH: 4,   density: 0.035, cover: 0.1, conceal: 0.3 },
  { name: 'Vineyard',     speed: 0.7,  losH: 1.6, density: 0.07,  cover: 0.05, conceal: 0.4 },
  { name: 'Stream',       speed: 0.35, losH: 0,   density: 0,     cover: 0,   conceal: 0.2 },
  { name: 'Pond',         speed: 0,    losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Paved road',   speed: 1.2,  losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Swamp',        speed: 0.3,  losH: 1.6, density: 0.05,  cover: 0,   conceal: 0.5 },
  { name: 'River',        speed: 0,    losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Ford',         speed: 0.25, losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Ocean',        speed: 0,    losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Beach sand',   speed: 0.7,  losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Chaparral',    speed: 0.45, losH: 2.2, density: 0.09,  cover: 0.05, conceal: 0.55 },
  { name: 'Mesquite brush', speed: 0.65, losH: 2.8, density: 0.06, cover: 0.05, conceal: 0.5 },
  { name: 'Desert scrub', speed: 0.95, losH: 1.0, density: 0.008, cover: 0,   conceal: 0.1 },
  { name: 'Rock outcrop', speed: 0.4,  losH: 1.6, density: 0.25,  cover: 0.6, conceal: 0.45 },
  { name: 'Deep snow',    speed: 0.55, losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Frozen pond',  speed: 0.5,  losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Dry wash',     speed: 0.85, losH: 0,   density: 0,     cover: 0,   conceal: 0.25 },
];

// eye: sight height. center: center of mass. size: relative target size.
const POSTURE = {
  stand: { label: 'Standing', short: 'STD', eye: 1.7,  center: 1.1,  size: 1.0,  acc: 0.85 },
  kneel: { label: 'Kneeling', short: 'KNL', eye: 1.2,  center: 0.75, size: 0.6,  acc: 1.0 },
  prone: { label: 'Prone',    short: 'PRN', eye: 0.35, center: 0.2,  size: 0.3,  acc: 1.2 },
};
// Seconds to change posture.
const POSTURE_TIME = {
  stand: { kneel: 0.5, prone: 1.2 },
  kneel: { stand: 0.5, prone: 0.8 },
  prone: { stand: 1.4, kneel: 0.9 },
};

// speed in m/s; fatigue gained per second.
const MOVE = {
  walk:  { label: 'Walk',  speed: 1.5, posture: 'stand', fatigue: 0.4 },
  rush:  { label: 'Rush',  speed: 3.8, posture: 'stand', fatigue: 7 },
  crawl: { label: 'Crawl', speed: 0.45, posture: 'prone', fatigue: 2.5 },
};

// rounds: rounds per trigger pull. cycle: seconds between pulls at a steady rate.
// acc: chance per round to hit a standing, exposed man at 100 m or less.
const WEAPONS = {
  M27:    { name: 'M27 IAR (rifle)', rounds: 1, cycle: 1.7, acc: 0.42, range: 600, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.6 },
  M27IAR: { name: 'M27 IAR (auto)',  rounds: 3, cycle: 1.3, acc: 0.30, range: 600, supp: 8,  mag: 30,  mags: 21, reload: 3, kg: 3.6 },
  M16A4:  { name: 'M16A4',           rounds: 1, cycle: 1.8, acc: 0.40, range: 550, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.4 },
  M4:     { name: 'M4 carbine',      rounds: 1, cycle: 1.7, acc: 0.37, range: 500, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.0 },
  M249:   { name: 'M249 SAW',        rounds: 6, cycle: 1.6, acc: 0.18, range: 800, supp: 11, mag: 200, mags: 3,  reload: 7, kg: 7.5 },
  AK74:   { name: 'AK-74M',          rounds: 1, cycle: 1.9, acc: 0.34, range: 500, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.4 },
  AKM:    { name: 'AKM',             rounds: 1, cycle: 1.9, acc: 0.30, range: 400, supp: 7,  mag: 30,  mags: 6,  reload: 3, kg: 3.6 },
  AKS74U: { name: 'AKS-74U',         rounds: 1, cycle: 1.8, acc: 0.28, range: 300, supp: 6,  mag: 30,  mags: 5,  reload: 3, kg: 2.7 },
  RPK74:  { name: 'RPK-74',          rounds: 4, cycle: 1.6, acc: 0.24, range: 600, supp: 9,  mag: 45,  mags: 9,  reload: 4, kg: 5.0 },
  PKM:    { name: 'PKM',             rounds: 6, cycle: 1.6, acc: 0.19, range: 1000, supp: 13, mag: 100, mags: 4,  reload: 8, kg: 7.5 },
  SVD:    { name: 'SVD',             rounds: 1, cycle: 3.0, acc: 0.70, range: 800, supp: 7,  mag: 10,  mags: 8,  reload: 3, kg: 4.3 },
};
// Magazine weight (kg) for the loadout weight figure.
const MAG_KG = { 30: 0.5, 200: 3.2, 45: 0.8, 100: 3.0, 10: 0.3 };

// scatter: miss distance per meter of range. lethal/casualty: radii in meters.
const LAUNCHERS = {
  M203: { name: 'M203 40mm', range: 350, min: 31, cycle: 6, scatter: 0.035, lethal: 5, casualty: 12, rounds: 12, vel: 76,  kg: 0.23 },
  M320: { name: 'M320 40mm', range: 350, min: 31, cycle: 6, scatter: 0.03,  lethal: 5, casualty: 12, rounds: 12, vel: 76,  kg: 0.23 },
  GP25: { name: 'GP-25 40mm', range: 400, min: 40, cycle: 7, scatter: 0.04, lethal: 5, casualty: 11, rounds: 10, vel: 76,  kg: 0.25 },
  RPG7: { name: 'RPG-7 (OG-7V)', range: 300, min: 25, cycle: 12, scatter: 0.03, lethal: 6, casualty: 14, rounds: 3, vel: 120, kg: 2.0 },
};
const GRENADES = {
  M67:  { name: 'M67 frag', range: 32, lethal: 5, casualty: 15, fuse: 1.6, kg: 0.4 },
  RGD5: { name: 'RGD-5 frag', range: 35, lethal: 4, casualty: 13, fuse: 1.6, kg: 0.31 },
};

// The 13-man Marine rifle squad: squad leader and three four-man fire teams.
const USMC_BILLETS = {
  SL: { title: 'Squad Leader',       rank: 'Sgt',  weapons: ['M4', 'M16A4', 'M27'],  weapon: 'M4' },
  TL: { title: 'Fire Team Leader',   rank: 'Cpl',  weapons: ['M4', 'M16A4', 'M27'],  weapon: 'M4' },
  AR: { title: 'Automatic Rifleman', rank: 'LCpl', weapons: ['M27IAR', 'M249'],      weapon: 'M27IAR' },
  G:  { title: 'Grenadier',          rank: 'LCpl', weapons: ['M16A4', 'M4'],         weapon: 'M16A4', launchers: ['M203', 'M320'], launcher: 'M203' },
  R:  { title: 'Rifleman',           rank: 'PFC',  weapons: ['M27', 'M16A4', 'M4'],  weapon: 'M27' },
};
const TEAM_ORDER = ['TL', 'AR', 'G', 'R'];

// Opposing force billets. Organization is randomized for now; specific
// foreign squad organizations come later.
const OPFOR_BILLETS = {
  SL:  { title: 'Squad Leader',       weapon: 'AK74' },
  TL:  { title: 'Team Leader',        weapon: 'AK74' },
  R:   { title: 'Rifleman',           weapon: 'AK74', alt: 'AKM' },
  AR:  { title: 'Automatic Rifleman', weapon: 'RPK74' },
  MG:  { title: 'Machine Gunner',     weapon: 'PKM' },
  G:   { title: 'Grenadier',          weapon: 'AK74', launcher: 'GP25' },
  RPG: { title: 'Antitank Grenadier', weapon: 'AKS74U', launcher: 'RPG7' },
  MM:  { title: 'Marksman',           weapon: 'SVD' },
};
const OPFOR_POOL = ['R', 'R', 'R', 'R', 'AR', 'MG', 'G', 'RPG', 'MM'];

const SURNAMES = ['Hayes', 'Ortiz', 'Brennan', 'Kowalski', 'Whitfield', 'Duarte', 'McAllister', 'Pruitt',
  'Okafor', 'Lindqvist', 'Calloway', 'Reyes', 'Thibodeaux', 'Hargrove', 'Nakamura', 'Sutton', 'Boone',
  'Castillo', 'Delaney', 'Ferris', 'Gaines', 'Holloway', 'Ingram', 'Jett', 'Keller', 'Lowery', 'Mercer',
  'Novak', 'Overstreet', 'Pittman', 'Quarles', 'Rourke', 'Stroud', 'Tolliver', 'Vance', 'Wilder', 'Yates'];

// Team formations: offsets in meters for member slot i (x = right, y = ahead),
// before the interval multiplier. Slot 0 is the team leader.
const FORMATIONS = {
  wedge:  { label: 'Wedge' },
  column: { label: 'Column' },
  line:   { label: 'Line' },
  echL:   { label: 'Echelon L' },
  echR:   { label: 'Echelon R' },
};
const FORMATION_KEYS = Object.keys(FORMATIONS);

function teamSlot(form, i) {
  const side = i % 2 === 1 ? -1 : 1, rank = Math.ceil(i / 2);
  switch (form) {
    case 'column': return { x: 0, y: -6 * i };
    case 'line':   return { x: side * 7 * rank, y: 0 };
    case 'echL':   return { x: -6 * i, y: -6 * i };
    case 'echR':   return { x: 6 * i, y: -6 * i };
    default:       return { x: side * 7 * rank, y: -7 * rank };
  }
}

// Squad formations: anchor for team k of n, and the squad leader's position.
function squadSlot(form, k, n) {
  switch (form) {
    case 'column': return { x: 0, y: -30 * k };
    case 'line':   return { x: (k - (n - 1) / 2) * 32, y: 0 };
    case 'echL':   return { x: -24 * k, y: -24 * k };
    case 'echR':   return { x: 24 * k, y: -24 * k };
    default:
      if (k === 0) return { x: 0, y: 0 };
      return { x: (k % 2 === 1 ? -1 : 1) * 30 * Math.ceil(k / 2), y: -24 * Math.ceil(k / 2) };
  }
}
function squadLeaderSlot(form) {
  switch (form) {
    case 'column': return { x: 4, y: -15 };
    case 'line':   return { x: 0, y: -14 };
    case 'echL':   return { x: -8, y: -20 };
    case 'echR':   return { x: 8, y: -20 };
    default:       return { x: 0, y: -16 };
  }
}

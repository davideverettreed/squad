'use strict';
// Static game data: map scale, terrain, postures, weapons, billets, formations.
// Weapon figures are game abstractions tuned for play, loosely scaled from
// published effective ranges and rates of fire; they are not ballistic tables.

const CELL = 4;                    // meters per terrain cell
// The map's size goes with the echelon: a squad fights on a 2 x 2 km sheet, a platoon on
// 4 x 4 km, larger units on larger sheets. The sides start beyond spotting range (800 m).
// Set before each map is made.
const ECHELONS = {
  squad:   { label: 'Squad',   size: 2000, sep: [1000, 1400], margin: 200, attackTime: 40 },
  platoon: { label: 'Platoon', size: 4000, sep: [2000, 3000], margin: 300, attackTime: 60 },
};
let MAP_W = 2000, MAP_H = 2000;    // meters
let GW = MAP_W / CELL, GH = MAP_H / CELL;
// Scale of the sheet against the 3 km sheet that the map styles were first drawn for.
let MAP_K = MAP_W / 3000;
function setMapSize(m) {
  MAP_W = MAP_H = m; GW = GH = m / CELL; MAP_K = m / 3000;
}

const TER = {
  OPEN: 0, GRASS: 1, WOODS: 2, ROAD: 3, BUILDING: 4, WALL: 5, PLOWED: 6,
  ORCHARD: 7, VINEYARD: 8, STREAM: 9, POND: 10, PAVED: 11, SWAMP: 12, RIVER: 13, FORD: 14,
  OCEAN: 15, BEACH: 16, CHAPARRAL: 17, BRUSH: 18, DESERT: 19, ROCK: 20, SNOW: 21, ICE: 22, WASH: 23,
  PADDY: 24, DIKE: 25,
};

// losH: height above ground the feature blocks sight to.
// density: share of sight blocked per meter of the feature crossed (vegetation). Woods
// block sight after about 50 m, an orchard after about 80 m.
// cover: share of rounds stopped for a man inside or behind it.
const TERRAIN = [
  { name: 'Open field',   speed: 1.0,  losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Tall grass',   speed: 0.8,  losH: 0.9, density: 0.1,   cover: 0,   conceal: 0.5 },
  { name: 'Woods',        speed: 0.6,  losH: 12,  density: 0.02,  cover: 0.3, conceal: 0.6 },
  { name: 'Dirt road',    speed: 1.15, losH: 0,   density: 0,     cover: 0,   conceal: 0 },
  { name: 'Building',     speed: 0,    losH: 6.5, solid: true,    cover: 1,   conceal: 1 },
  { name: 'Stone wall',   speed: 0.3,  losH: 1.0, solid: true,    cover: 0.9, conceal: 0.3 },
  { name: 'Plowed field', speed: 0.85, losH: 0,   density: 0,     cover: 0,   conceal: 0.1 },
  { name: 'Orchard',      speed: 0.9,  losH: 4,   density: 0.012, cover: 0.1, conceal: 0.3 },
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
  { name: 'Rice paddy',   speed: 0.4,  losH: 0.6, density: 0.03,  cover: 0,   conceal: 0.3 },
  { name: 'Paddy dike',   speed: 0.9,  losH: 0.8, solid: true,    cover: 0.8, conceal: 0.3 },
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

// rounds: rounds per trigger pull. cycle: seconds between pulls at the rapid rate (a
// rifle about 35 rounds a minute, the SAW about 220); the sustained rate is about a third
// of that (see fireDelay). acc: chance per round to hit a standing, exposed man close in.
// r50: the range in meters at which that chance has fallen by half (it keeps falling with
// the square of the range beyond). range: the longest range a man will engage at. dmg:
// how badly a hit wounds, against 5.56 mm = 1 (a .22 rimfire about a third, a full-power
// rifle round 1.2, a .75 musket ball 1.4). mags: magazines (or belts) carried, the one in
// the weapon included: the Marine basic load is 7 x 30 = 210 rounds for a rifleman, 21
// magazines (630) for the IAR gunner, 600 linked rounds for the SAW. A muzzle-loader has
// a "magazine" of one: mags is the cartridges or charges carried. magType: which men can
// share magazines. smoke: black powder, whose cloud gives the firer away. quiet: hardly
// heard (a bow, a suppressed rifle). jam: chance per burst of a stoppage.
const WEAPONS = {
  // Marines today.
  M27:    { name: 'M27 IAR (rifle)', rounds: 1, cycle: 1.7, acc: 0.42, r50: 260, range: 600, dmg: 1, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.6 , magType: 'stanag' },
  M27IAR: { name: 'M27 IAR (auto)',  rounds: 3, cycle: 1.3, acc: 0.30, r50: 240, range: 600, dmg: 1, supp: 8,  mag: 30,  mags: 21, reload: 3, kg: 3.6 , magType: 'stanag' },
  M16A4:  { name: 'M16A4',           rounds: 1, cycle: 1.8, acc: 0.40, r50: 230, range: 550, dmg: 1, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.4 , magType: 'stanag' },
  M4:     { name: 'M4 carbine',      rounds: 1, cycle: 1.7, acc: 0.37, r50: 200, range: 500, dmg: 0.95, supp: 6, mag: 30, mags: 7, reload: 3, kg: 3.0 , magType: 'stanag' },
  M249:   { name: 'M249 SAW',        rounds: 6, cycle: 1.6, acc: 0.18, r50: 220, range: 800, dmg: 1, supp: 11, mag: 200, mags: 3,  reload: 7, kg: 7.5 , magType: 'belt556' },
  // Soviet and Russian.
  AK74:   { name: 'AK-74',           rounds: 1, cycle: 1.9, acc: 0.34, r50: 190, range: 500, dmg: 1, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.4 , magType: 'ak545' },
  AKM:    { name: 'AKM',             rounds: 1, cycle: 1.9, acc: 0.30, r50: 160, range: 400, dmg: 1.05, supp: 7, mag: 30, mags: 6, reload: 3, kg: 3.6 , magType: 'ak762' },
  AKMPBS: { name: 'AKMS with PBS-1 silencer', rounds: 1, cycle: 2.0, acc: 0.30, r50: 140, range: 350, dmg: 1, supp: 4, mag: 30, mags: 6, reload: 3, kg: 4.0, magType: 'ak762', quiet: true },
  AKS74U: { name: 'AKS-74U',         rounds: 1, cycle: 1.8, acc: 0.28, r50: 120, range: 300, dmg: 0.9, supp: 6, mag: 30, mags: 5, reload: 3, kg: 2.7 , magType: 'ak545' },
  RPK:    { name: 'RPK',             rounds: 4, cycle: 1.6, acc: 0.23, r50: 180, range: 600, dmg: 1.05, supp: 9, mag: 40, mags: 8, reload: 4, kg: 5.0 , magType: 'rpk762' },
  RPK74:  { name: 'RPK-74',          rounds: 4, cycle: 1.6, acc: 0.24, r50: 200, range: 600, dmg: 1, supp: 9,  mag: 45,  mags: 9,  reload: 4, kg: 5.0 , magType: 'rpk545' },
  PKM:    { name: 'PKM',             rounds: 6, cycle: 1.6, acc: 0.19, r50: 260, range: 1000, dmg: 1.2, supp: 13, mag: 100, mags: 4, reload: 8, kg: 7.5 , magType: 'belt762' },
  SVD:    { name: 'SVD',             rounds: 1, cycle: 3.0, acc: 0.70, r50: 450, range: 800, dmg: 1.2, supp: 7, mag: 10,  mags: 8,  reload: 3, kg: 4.3 , magType: 'svd' },
  AK12:   { name: 'AK-12',           rounds: 1, cycle: 1.8, acc: 0.38, r50: 220, range: 550, dmg: 1, supp: 6,  mag: 30,  mags: 8,  reload: 3, kg: 3.5 , magType: 'ak545' },
  RPK16:  { name: 'RPK-16',          rounds: 4, cycle: 1.6, acc: 0.24, r50: 220, range: 700, dmg: 1, supp: 9,  mag: 95,  mags: 3,  reload: 5, kg: 5.5 , magType: 'rpk16' },
  PKP:    { name: 'PKP Pecheneg',    rounds: 6, cycle: 1.6, acc: 0.20, r50: 280, range: 1000, dmg: 1.2, supp: 13, mag: 100, mags: 5, reload: 8, kg: 8.2 , magType: 'belt762' },
  SVDM:   { name: 'SVDM',            rounds: 1, cycle: 3.0, acc: 0.70, r50: 480, range: 900, dmg: 1.2, supp: 7, mag: 10,  mags: 8,  reload: 3, kg: 5.3 , magType: 'svd' },
  // Chinese.
  QBZ191: { name: 'QBZ-191',         rounds: 1, cycle: 1.8, acc: 0.41, r50: 240, range: 600, dmg: 1, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.3 , magType: 'dbp58' },
  QJS161: { name: 'QJS-161',         rounds: 5, cycle: 1.6, acc: 0.22, r50: 230, range: 800, dmg: 1, supp: 10, mag: 75,  mags: 5,  reload: 5, kg: 6.0 , magType: 'drum58' },
  QBU191: { name: 'QBU-191',         rounds: 1, cycle: 2.2, acc: 0.62, r50: 380, range: 800, dmg: 1, supp: 6,  mag: 30,  mags: 6,  reload: 3, kg: 4.0 , magType: 'dbp58' },
  // Vietnam, both sides.
  AK47:   { name: 'AK-47 (Type 56)', rounds: 1, cycle: 1.9, acc: 0.30, r50: 150, range: 400, dmg: 1.05, supp: 7, mag: 30, mags: 5, reload: 3, kg: 4.3 , magType: 'ak762' },
  SKS:    { name: 'SKS (Type 56 carbine)', rounds: 1, cycle: 2.0, acc: 0.38, r50: 190, range: 400, dmg: 1.05, supp: 6, mag: 10, mags: 9, reload: 4, kg: 3.9, magType: 'clip762' },
  RPD:    { name: 'RPD',             rounds: 4, cycle: 1.6, acc: 0.22, r50: 180, range: 700, dmg: 1.05, supp: 10, mag: 100, mags: 3, reload: 6, kg: 7.4 , magType: 'rpd' },
  M16A1:  { name: 'M16A1 (20-rd)',   rounds: 1, cycle: 1.8, acc: 0.38, r50: 210, range: 460, dmg: 1, supp: 6,  mag: 20,  mags: 14, reload: 3, kg: 3.2 , magType: 'stanag20', jam: 0.006 },
  M16A1AR:{ name: 'M16A1 (auto, bipod)', rounds: 3, cycle: 1.4, acc: 0.26, r50: 180, range: 460, dmg: 1, supp: 8, mag: 20, mags: 20, reload: 3, kg: 3.6, magType: 'stanag20', jam: 0.01 },
  M16A130:{ name: 'M16A1',           rounds: 1, cycle: 1.8, acc: 0.38, r50: 210, range: 460, dmg: 1, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.2 , magType: 'stanag' },
  M16A1AR30:{ name: 'M16A1 (auto, bipod)', rounds: 3, cycle: 1.4, acc: 0.26, r50: 180, range: 460, dmg: 1, supp: 8, mag: 30, mags: 14, reload: 3, kg: 3.6, magType: 'stanag' },
  M16A2:  { name: 'M16A2',           rounds: 1, cycle: 1.8, acc: 0.41, r50: 240, range: 550, dmg: 1, supp: 6,  mag: 30,  mags: 7,  reload: 3, kg: 3.6 , magType: 'stanag' },
  // The world wars and after.
  GEW98:  { name: 'Gewehr 98',       rounds: 1, cycle: 2.6, acc: 0.46, r50: 270, range: 600, dmg: 1.2, supp: 7, mag: 5,  mags: 24, reload: 4, kg: 4.1 , magType: 'mauser' },
  MG0815: { name: 'MG 08/15',        rounds: 6, cycle: 1.6, acc: 0.19, r50: 300, range: 1000, dmg: 1.2, supp: 13, mag: 100, mags: 5, reload: 8, kg: 18 , magType: 'belt792' },
  P08:    { name: 'Luger P08 pistol', rounds: 1, cycle: 1.2, acc: 0.25, r50: 22, range: 50, dmg: 0.6, supp: 2, mag: 8,  mags: 3,  reload: 3, kg: 0.9 , magType: 'p08' },
  M1903:  { name: 'M1903 Springfield', rounds: 1, cycle: 2.5, acc: 0.46, r50: 270, range: 600, dmg: 1.2, supp: 7, mag: 5, mags: 20, reload: 4, kg: 3.9 , magType: 'clip3006' },
  CHAUCHAT:{ name: 'Chauchat automatic rifle', rounds: 3, cycle: 1.8, acc: 0.18, r50: 170, range: 600, dmg: 1.2, supp: 9, mag: 20, mags: 12, reload: 5, kg: 9.1, magType: 'chauchat', jam: 0.05 },
  M1911:  { name: 'M1911 pistol',    rounds: 1, cycle: 1.2, acc: 0.25, r50: 22, range: 50, dmg: 0.7, supp: 2, mag: 7,  mags: 3,  reload: 3, kg: 1.1 , magType: 'acp45' },
  MAS4956:{ name: 'MAS 49/56',       rounds: 1, cycle: 2.0, acc: 0.43, r50: 250, range: 500, dmg: 1.15, supp: 6, mag: 10, mags: 9, reload: 3, kg: 4.0 , magType: 'mas75' },
  MAT49:  { name: 'MAT 49',          rounds: 3, cycle: 1.2, acc: 0.22, r50: 45, range: 150, dmg: 0.6, supp: 5, mag: 32, mags: 5, reload: 3, kg: 3.5 , magType: 'mat9' },
  AA52:   { name: 'AA-52',           rounds: 6, cycle: 1.6, acc: 0.19, r50: 260, range: 900, dmg: 1.15, supp: 12, mag: 50, mags: 8, reload: 6, kg: 9.9 , magType: 'belt75' },
  FM2429: { name: 'FM 24/29',        rounds: 4, cycle: 1.6, acc: 0.24, r50: 240, range: 700, dmg: 1.15, supp: 9, mag: 25, mags: 11, reload: 4, kg: 9.0, magType: 'fm75' },
  MAS36:  { name: 'MAS-36',          rounds: 1, cycle: 2.6, acc: 0.45, r50: 250, range: 550, dmg: 1.15, supp: 7, mag: 5,  mags: 11, reload: 4, kg: 3.7 , magType: 'clip75' },
  ENFIELD:{ name: 'Lee-Enfield .303', rounds: 1, cycle: 2.0, acc: 0.46, r50: 260, range: 600, dmg: 1.2, supp: 7, mag: 10, mags: 6, reload: 5, kg: 4.1 , magType: 'clip303' },
  BREN:   { name: 'Bren gun',        rounds: 4, cycle: 1.6, acc: 0.26, r50: 260, range: 700, dmg: 1.2, supp: 9, mag: 30, mags: 9, reload: 4, kg: 10 , magType: 'bren' },
  GARAND: { name: 'M1 Garand',       rounds: 1, cycle: 2.0, acc: 0.43, r50: 250, range: 550, dmg: 1.2, supp: 7, mag: 8,  mags: 8,  reload: 2.5, kg: 4.3, magType: 'garand' },
  CARBINE:{ name: 'M1 carbine',      rounds: 1, cycle: 1.9, acc: 0.34, r50: 120, range: 250, dmg: 0.75, supp: 5, mag: 15, mags: 4, reload: 3, kg: 2.5, magType: 'carbine' },
  UZI:    { name: 'Uzi',             rounds: 3, cycle: 1.3, acc: 0.20, r50: 40, range: 120, dmg: 0.6, supp: 5, mag: 25, mags: 3, reload: 3, kg: 3.5 , magType: 'uzi' },
  SHOTGUN:{ name: 'Pump shotgun, 12-gauge buckshot', rounds: 1, cycle: 1.6, acc: 0.55, r50: 22, range: 50, dmg: 1.1, supp: 5, mag: 6, mags: 2, reload: 6, kg: 3.4, magType: 'shells' , noun: 'pump shotgun' },
  REVOLVER:{ name: '.38 revolver',   rounds: 1, cycle: 1.2, acc: 0.28, r50: 18, range: 50, dmg: 0.5, supp: 2, mag: 6, mags: 2, reload: 6, kg: 0.9 , magType: 'rev38' , noun: '.38 revolver' },
  RUGER1022:{ name: 'Ruger 10/22 (.22 LR)', rounds: 1, cycle: 1.8, acc: 0.32, r50: 70, range: 150, dmg: 0.35, supp: 2, mag: 10, mags: 3, reload: 3, kg: 2.3, magType: 'r22' , noun: '.22 rifle' },
  // Black powder: one shot, then a long reload. The charges carried are counted as magazines.
  BESS:   { name: 'Short Land Pattern musket (Brown Bess)', rounds: 1, cycle: 1, acc: 0.30, r50: 55, range: 140, dmg: 1.4, supp: 8, mag: 1, mags: 39, reload: 15, kg: 4.4, magType: 'ball75', smoke: true },
  CHARLEVILLE:{ name: 'Charleville 1766 musket', rounds: 1, cycle: 1, acc: 0.30, r50: 55, range: 140, dmg: 1.35, supp: 8, mag: 1, mags: 39, reload: 15, kg: 4.5, magType: 'ball69', smoke: true },
  LONGRIFLE:{ name: 'Pennsylvania rifle', rounds: 1, cycle: 1, acc: 0.45, r50: 140, range: 250, dmg: 1.3, supp: 7, mag: 1, mags: 29, reload: 40, kg: 4.5, magType: 'ball50', smoke: true },
  FIRELOCK:{ name: 'English firelock musket', rounds: 1, cycle: 1, acc: 0.28, r50: 55, range: 130, dmg: 1.4, supp: 8, mag: 1, mags: 23, reload: 22, kg: 5.0, magType: 'charge', smoke: true , noun: 'firelock' },
  MATCHLOCK:{ name: 'Matchlock musket', rounds: 1, cycle: 1, acc: 0.24, r50: 50, range: 120, dmg: 1.4, supp: 8, mag: 1, mags: 19, reload: 30, kg: 5.5, magType: 'charge', smoke: true , noun: 'matchlock' },
  FUSIL:  { name: 'Flintlock trade gun', rounds: 1, cycle: 1, acc: 0.32, r50: 65, range: 140, dmg: 1.3, supp: 8, mag: 1, mags: 19, reload: 20, kg: 3.6, magType: 'charge', smoke: true , noun: 'trade gun' },
  BOW:    { name: 'Bow and arrows',  rounds: 1, cycle: 1, acc: 0.30, r50: 35, range: 90, dmg: 0.6, supp: 2, mag: 1, mags: 23, reload: 3, kg: 1.2, magType: 'arrow', quiet: true , noun: 'bow' },
};
// Magazine weight (kg) for the loadout weight figure.
const MAG_KG = { 30: 0.5, 200: 3.2, 45: 0.8, 100: 3.0, 10: 0.3 };

// scatter: miss distance per meter of range. lethal/casualty: radii in meters. flat: a
// rocket fired straight at the target, which bursts on the first wall or building.
const LAUNCHERS = {
  M203: { name: 'M203 40mm', range: 350, min: 31, cycle: 6, scatter: 0.035, lethal: 5, casualty: 12, rounds: 18, vel: 76,  kg: 0.23 },
  M320: { name: 'M320 40mm', range: 350, min: 31, cycle: 6, scatter: 0.03,  lethal: 5, casualty: 12, rounds: 18, vel: 76,  kg: 0.23 },
  M79:  { name: 'M79 40mm', range: 350, min: 31, cycle: 5, scatter: 0.035, lethal: 5, casualty: 12, rounds: 24, vel: 76,  kg: 0.23 },
  GP25: { name: 'GP-25 40mm', range: 400, min: 40, cycle: 7, scatter: 0.04, lethal: 5, casualty: 11, rounds: 10, vel: 76,  kg: 0.25 },
  GP34: { name: 'GP-34 40mm', range: 400, min: 40, cycle: 7, scatter: 0.04, lethal: 5, casualty: 11, rounds: 10, vel: 76,  kg: 0.25 },
  QLG10:{ name: 'QLG-10 35mm', range: 350, min: 30, cycle: 6, scatter: 0.035, lethal: 4, casualty: 10, rounds: 12, vel: 75, kg: 0.2 },
  VB:   { name: 'VB rifle grenade', range: 180, min: 30, cycle: 10, scatter: 0.06, lethal: 4, casualty: 10, rounds: 8, vel: 50, kg: 0.5 },
  RIFGR:{ name: 'Rifle grenade (22 mm)', range: 200, min: 30, cycle: 10, scatter: 0.05, lethal: 5, casualty: 12, rounds: 4, vel: 55, kg: 0.5 },
  RPG7: { name: 'RPG-7 (OG-7V)', range: 300, min: 25, cycle: 12, scatter: 0.03, lethal: 6, casualty: 14, rounds: 3, vel: 120, kg: 2.0, flat: true },
  RPG7PG:{ name: 'RPG-7 (PG-7V)', range: 300, min: 25, cycle: 12, scatter: 0.03, lethal: 4, casualty: 10, rounds: 3, vel: 120, kg: 2.2, flat: true },
  RPG16:{ name: 'RPG-16 (PG-16)', range: 300, min: 25, cycle: 12, scatter: 0.025, lethal: 4, casualty: 10, rounds: 3, vel: 130, kg: 2.0, flat: true },
  B40:  { name: 'B40 (RPG-2)', range: 150, min: 20, cycle: 14, scatter: 0.045, lethal: 4, casualty: 10, rounds: 3, vel: 84, kg: 1.8, flat: true },
  B41:  { name: 'B41 (RPG-7)', range: 300, min: 25, cycle: 12, scatter: 0.03, lethal: 4, casualty: 10, rounds: 3, vel: 120, kg: 2.2, flat: true },
  PF89: { name: 'PF-89 80mm', range: 250, min: 25, cycle: 8, scatter: 0.025, lethal: 4, casualty: 10, rounds: 2, vel: 140, kg: 3.7, flat: true },
};
// Hand grenades. fuse: seconds from landing to burst. dud: share that fail to go off.
const GRENADES = {
  M67:   { name: 'M67 frag', range: 32, lethal: 5, casualty: 15, fuse: 1.6, kg: 0.4 },
  RGD5:  { name: 'RGD-5 frag', range: 35, lethal: 4, casualty: 13, fuse: 1.6, kg: 0.31 },
  F1:    { name: 'F-1 frag', range: 35, lethal: 5, casualty: 18, fuse: 1.8, kg: 0.6 },
  STICK: { name: 'Stielhandgranate', range: 35, lethal: 3, casualty: 9, fuse: 2.5, kg: 0.6 },
  F1FR:  { name: 'F1 grenade (French)', range: 30, lethal: 4, casualty: 12, fuse: 2.2, kg: 0.6 },
  CHICOM:{ name: 'Type 67 stick grenade', range: 30, lethal: 3, casualty: 8, fuse: 2.2, kg: 0.6, dud: 0.15 },
  DF37:  { name: 'DF 37 frag', range: 30, lethal: 4, casualty: 12, fuse: 2, kg: 0.6 },
  MILLS: { name: 'Mills bomb', range: 30, lethal: 4, casualty: 14, fuse: 2, kg: 0.77 },
  T82:   { name: 'Type 82-2 frag', range: 35, lethal: 4, casualty: 12, fuse: 1.6, kg: 0.26 },
};
// Hand-to-hand: chance to strike home in a second's fighting, and how badly.
const MELEE = {
  butt:    { name: 'Rifle butt and fists', skill: 0.7, dmg: 0.6 },
  bayonet: { name: 'Bayonet', skill: 1.0, dmg: 1.2 },
  club:    { name: 'War club', skill: 1.15, dmg: 1.3 },
  hatchet: { name: 'Hatchet', skill: 1.1, dmg: 1.2 },
  sword:   { name: 'Sword', skill: 1.0, dmg: 1.1 },
  halberd: { name: 'Halberd', skill: 1.0, dmg: 1.2 },
  machete: { name: 'Machete', skill: 0.9, dmg: 1.0 },
  knife:   { name: 'Knife', skill: 0.8, dmg: 0.9 },
  spade:   { name: 'Entrenching spade', skill: 1.0, dmg: 1.1 },
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
  CR:  { title: 'Aircrewman',         weapon: 'AKS74U' },
  CO:  { title: 'Commander',          weapon: 'AKS74U' },
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

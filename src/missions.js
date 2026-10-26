'use strict';
// Missions: what the enemy is, where it is and what it is doing, what 1st Squad must do,
// and how the mission is won or lost. Each mission picks a site on the sheet that suits
// it (a farm, a village, a lake shore, a road, a hilltop, a bridge), sets the enemy there
// in its activity, and writes its part of the order.

// What kind of enemy, and how it is equipped and led.
const OPFOR_KINDS = {
  regular:   { unit: 'Regular infantry, uniformed and well equipped.', men: 'regular soldiers', pool: OPFOR_POOL, morale: [62, 82], training: 1, frags: [1, 2] },
  irregular: { unit: 'Irregular fighters in mixed civilian and military clothing.', men: 'irregular fighters', pool: ['R', 'R', 'R', 'R', 'R', 'AR', 'RPG', 'G'], morale: [38, 62], training: 1.25, frags: [0, 1], akm: 0.7 },
  recon:     { unit: 'Reconnaissance troops: light kit, good fieldcraft.', men: 'reconnaissance troops', pool: ['R', 'R', 'MM', 'AR'], morale: [70, 86], training: 0.9, frags: [2, 2] },
  crew:      { unit: 'Helicopter aircrew with their personal weapons, and some infantry.', men: 'aircrew and guards', pool: ['CR', 'CR', 'CR', 'R'], morale: [45, 65], training: 1.15, frags: [0, 1] },
};

// Build the enemy force: a leader and groups of three to five men, n men in all.
function buildOpfor(n, kindKey, extra) {
  const K = OPFOR_KINDS[kindKey], name = n <= 5 ? 'Enemy team' : n <= 9 ? 'Enemy section' : n <= 13 ? 'Enemy squad' : 'Enemy reinforced squad';
  const sq = new Squad('red', name, randRange(K.morale[0], K.morale[1]));
  sq.training = K.training; sq.kind = kindKey;
  const make = (key, team) => {
    const b = OPFOR_BILLETS[key];
    let weapon = b.alt && chance(K.akm || 0.35) ? b.alt : b.weapon;
    const s = new Soldier('red', key, team, { title: b.title, name: b.title, weapon, launcher: b.launcher, frags: randInt(K.frags[0], K.frags[1]) });
    team.members.push(s);
    return s;
  };
  sq.hq = new Team('red', sq, 0, 'Enemy leader');
  sq.leader = make(extra && extra.leader ? extra.leader : 'SL', sq.hq);
  const rest = n - 1, groups = Math.max(1, Math.round(rest / 4));
  let left = rest;
  for (let k = 1; k <= groups; k++) {
    const t = new Team('red', sq, k, 'Enemy group ' + k);
    const size = k === groups ? left : Math.max(2, Math.round(rest / groups));
    left -= size;
    for (let i = 0; i < size; i++) make(i === 0 && size > 2 ? 'TL' : pick(K.pool), t);
    if (t.members.length) sq.teams.push(t);
  }
  return sq;
}

// ---------------------------------------------------------------- sites on the sheet
const Sites = {
  inside(x, y, m) { return x >= m && y >= m && x <= MAP_W - m && y <= MAP_H - m; },
  farm(m) { return shuffle(m.places.filter(p => p.kind === 'farm')).map(p => ({ x: p.x - 10, y: p.y + 6, name: p.name, kind: 'farm' })); },
  village(m) { return shuffle(m.places.filter(p => p.kind === 'village')).map(p => ({ x: p.x, y: p.y, name: p.name.toUpperCase(), kind: 'village' })); },
  peak(m) { return m.peaks.slice(0, 6).map(p => ({ x: p.x, y: p.y, name: 'Hill ' + Math.round(m.elevBase + p.e), kind: 'hill' })); },
  // Ponds big enough to walk around, each with a ring of points along its shore.
  pond(m) {
    const seen = new Uint8Array(GW * GH), out = [];
    for (let i = 0; i < GW * GH; i += 3) {
      if (seen[i] || (m.ter[i] !== TER.POND && m.ter[i] !== TER.ICE)) continue;
      const q = [i], cells = []; seen[i] = 1;
      while (q.length) {
        const c = q.pop(); cells.push(c);
        const x = c % GW, y = Math.floor(c / GW);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (y + dy) * GW + x + dx;
          if (m.inGrid(x + dx, y + dy) && !seen[j] && m.ter[j] === m.ter[i]) { seen[j] = 1; q.push(j); }
        }
      }
      if (cells.length < 300) continue;
      let sx = 0, sy = 0; for (const c of cells) { sx += c % GW; sy += Math.floor(c / GW); }
      const cx = (sx / cells.length + 0.5) * CELL, cy = (sy / cells.length + 0.5) * CELL, ring = [];
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        let r = 10;
        while (r < 400 && (m.terAt(cx + Math.cos(a) * r, cy + Math.sin(a) * r) === TER.POND || m.terAt(cx + Math.cos(a) * r, cy + Math.sin(a) * r) === TER.ICE)) r += 4;
        const px = clamp(cx + Math.cos(a) * (r + 18), 30, MAP_W - 30), py = clamp(cy + Math.sin(a) * (r + 18), 30, MAP_H - 30);
        const n = m.nearestPassable(Math.floor(px / CELL), Math.floor(py / CELL));
        ring.push({ x: (n.cx + 0.5) * CELL, y: (n.cy + 0.5) * CELL });
      }
      out.push({ x: cx, y: cy, name: 'the pond', kind: 'pond', ring, ha: cells.length * CELL * CELL / 10000 });
    }
    return shuffle(out);
  },
  // A stretch of road 500 to 800 m long, with its two ends and the road between.
  road(m) {
    const out = [];
    for (const r of shuffle(m.roads.slice())) {
      const pts = r.pts;
      if (pts.length < 3) continue;
      let len = 0; const cum = [0];
      for (let i = 1; i < pts.length; i++) { len += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y); cum.push(len); }
      if (len < 500) continue;
      const want = Math.min(len, randRange(500, 800)), start = randRange(0, len - want);
      const seg = pts.filter((p, i) => cum[i] >= start && cum[i] <= start + want);
      if (seg.length < 2) continue;
      const mid = seg[Math.floor(seg.length / 2)];
      out.push({ x: mid.x, y: mid.y, name: r.kind === 'paved' ? 'the paved road' : 'the track', kind: 'road', a: seg[0], b: seg[seg.length - 1], path: seg });
    }
    return out;
  },
  crossing(m) {
    if (!m.river) return [];
    return shuffle([...m.river.bridges.map(b => ({ x: b.x, y: b.y, name: 'the bridge over the ' + m.river.name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), kind: 'bridge' })),
      ...m.river.fords.map(f => ({ x: f.x, y: f.y, name: 'the ford on the ' + m.river.name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), kind: 'ford' }))]);
  },
  woods(m) {
    const out = [];
    for (let k = 0; k < 400 && out.length < 6; k++) {
      const x = randRange(200, MAP_W - 200), y = randRange(200, MAP_H - 200);
      let n = 0; for (let a = 0; a < 8; a++) if (m.terAt(x + Math.cos(a) * 30, y + Math.sin(a) * 30) === TER.WOODS) n++;
      if (m.terAt(x, y) === TER.WOODS && n >= 6) out.push({ x, y, name: 'the woods', kind: 'woods' });
    }
    return out;
  },
  open(m) {
    const out = [];
    for (let k = 0; k < 40; k++) {
      const x = randRange(250, MAP_W - 250), y = randRange(250, MAP_H - 250);
      if (TERRAIN[m.terAt(x, y)].speed > 0) out.push({ x, y, name: 'open ground', kind: 'open' });
    }
    return out;
  },
};

// ---------------------------------------------------------------- the missions
// size: men in the enemy force. kind: OPFOR_KINDS key. site: the kinds of place, in order
// of preference. setup: places the enemy and gives it its activity. draft: the kind of
// plan the Draft button lays out. Texts take the site's name and grid.
const MISSIONS = {
  village: {
    label: 'Village strongpoint', size: [8, 13], kind: 'regular', site: ['village', 'farm'], draft: 'attack', digIn: true,
    activity: (s) => 'Holding the buildings of ' + s.name + ' and preparing positions, oriented toward you.',
    task: (s, gr) => 'attacks to destroy OPFOR in ' + s.name + ' (grid ' + gr + ') in order to secure the village for the company',
    likely: 'Defend', setup: (ctx) => holdAt(ctx, ctx.site, ctx.blue),
  },
  meeting: {
    label: 'Meeting engagement', size: [6, 12], kind: 'regular', site: ['open'], draft: 'defense', mode: 'meeting',
    activity: (s, dir) => 'Moving ' + dir + ' on foot toward your position in a loose wedge.',
    task: (s, gr) => 'moves to contact to find, fix and destroy OPFOR advancing from vicinity grid ' + gr + ' in order to protect the company\'s flank',
    likely: 'Attack', setup: (ctx) => { place(ctx, ctx.site); ctx.ai = { mode: 'advance', objective: ctx.blue }; },
  },
  farmRest: {
    label: 'Enemy resting at a farm', size: [6, 12], kind: 'irregular', site: ['farm', 'village'], draft: 'attack',
    activity: (s) => 'Resting at ' + s.name + ': weapons grounded, a fire lit, one or two sentries out. Not expecting contact.',
    task: (s, gr) => 'attacks to destroy OPFOR resting at ' + s.name + ' (grid ' + gr + ') before it moves on',
    likely: 'Defend', setup: (ctx) => restAt(ctx, ctx.site, 2),
  },
  lakePatrol: {
    label: 'Patrol around a lake', size: [5, 9], kind: 'regular', site: ['pond', 'woods'], draft: 'attack',
    activity: (s) => 'Patrolling the shore of ' + s.name + ' on foot, clockwise, a full circuit every half hour or so.',
    task: (s, gr) => 'destroys the OPFOR patrol around ' + s.name + ' (grid ' + gr + ') in order to clear the lake shore for the company',
    likely: 'Attack', setup: (ctx) => patrol(ctx, ctx.site.ring || circle(ctx.site, 160, 8), 'loop'),
  },
  roadPatrol: {
    label: 'Road patrol', size: [6, 10], kind: 'regular', site: ['road'], draft: 'defense',
    activity: (s) => 'Patrolling ' + s.name + ' on foot, out and back along the same stretch of road.',
    task: (s, gr) => 'destroys the OPFOR patrol on ' + s.name + ' (grid ' + gr + ') in order to open the road',
    likely: 'Attack', setup: (ctx) => patrol(ctx, ctx.site.path || [ctx.site.a, ctx.site.b], 'shuttle'),
  },
  camp: {
    label: 'Enemy making camp', size: [8, 14], kind: 'regular', site: ['woods', 'farm', 'open'], draft: 'attack', digIn: true,
    activity: (s) => 'Making camp at ' + s.name + ': tents going up, positions being dug around it. Sentries out.',
    task: (s, gr) => 'attacks to destroy OPFOR making camp at ' + s.name + ' (grid ' + gr + ') before it is dug in',
    likely: 'Defend', setup: (ctx) => { restAt(ctx, ctx.site, 3); ctx.objects.push({ kind: 'camp', x: ctx.site.x, y: ctx.site.y, name: 'Camp' }); },
  },
  townAttack: {
    label: 'Enemy attacking a town', size: [10, 15], kind: 'irregular', site: ['village'], draft: 'attack',
    activity: (s) => 'Has entered ' + s.name + ' and is moving house to house. Some hold buildings; others roam the streets.',
    task: (s, gr) => 'attacks to destroy OPFOR in ' + s.name + ' (grid ' + gr + ') in order to free the town',
    likely: 'Defend', setup: (ctx) => {
      holdAt(ctx, ctx.site, ctx.blue);
      roam(ctx, around(ctx.site, 120, 6), false, 1);
    },
  },
  depot: {
    label: 'Enemy supply depot', size: [6, 10], kind: 'regular', site: ['farm', 'woods', 'open'], draft: 'attack', digIn: true, reach: 'cache',
    activity: (s) => 'Guarding a supply depot at ' + s.name + ': crates of ammunition and fuel under nets.',
    task: (s, gr) => 'attacks to destroy OPFOR guarding the supply depot at ' + s.name + ' (grid ' + gr + ') and destroy the depot',
    likely: 'Defend', setup: (ctx) => { ctx.objects.push({ kind: 'cache', x: ctx.site.x, y: ctx.site.y, name: 'Supply depot' }); holdAt(ctx, ctx.site, ctx.blue); },
  },
  helo: {
    label: 'Downed helicopter', size: [4, 8], kind: 'crew', site: ['open', 'woods'], draft: 'attack', evac: [26, 36],
    activity: (s) => 'An enemy helicopter is down at ' + s.name + '. Its crew and a few infantry are guarding the wreck and waiting for pickup.',
    task: (s, gr, M) => 'moves to the crash site at ' + s.name + ' (grid ' + gr + ') and destroys the crew before it is lifted out, expected H+' + Math.round(M.evacAt / 60),
    likely: 'Defend', setup: (ctx) => { ctx.objects.push({ kind: 'helo', x: ctx.site.x, y: ctx.site.y, name: 'Downed helicopter' }); holdAt(ctx, ctx.site, ctx.blue); },
  },
  reconTown: {
    label: 'Enemy recon of a town', size: [4, 6], kind: 'recon', site: ['village', 'farm'], draft: 'attack', escape: 0.5,
    activity: (s) => 'A small reconnaissance team is watching ' + s.name + ' from the ground around it, moving between hides.',
    task: (s, gr) => 'finds and destroys the OPFOR reconnaissance team around ' + s.name + ' (grid ' + gr + ') before it can report',
    likely: 'Withdraw', setup: (ctx) => roam(ctx, around(ctx.site, 220, 6), true),
  },
  ambush: {
    label: 'Enemy ambush position', size: [7, 12], kind: 'regular', site: ['road'], draft: 'attack',
    activity: (s) => 'Lying in ambush along ' + s.name + ', facing the road, waiting for traffic.',
    task: (s, gr) => 'attacks to destroy the OPFOR ambush along ' + s.name + ' (grid ' + gr + ') in order to open the road',
    likely: 'Defend', setup: (ctx) => {
      const a = ctx.site.a || ctx.site, b = ctx.site.b || ctx.site, h = angleTo(a.x, a.y, b.x, b.y);
      const side = chance(0.5) ? 1 : -1, off = { x: ctx.site.x + Math.cos(h + side * Math.PI / 2) * 35, y: ctx.site.y + Math.sin(h + side * Math.PI / 2) * 35 };
      holdAt(ctx, off, ctx.site);
    },
  },
  checkpoint: {
    label: 'Road checkpoint', size: [4, 7], kind: 'irregular', site: ['road'], draft: 'attack',
    activity: (s) => 'Manning a checkpoint on ' + s.name + ', stopping whoever comes along. Relaxed.',
    task: (s, gr) => 'attacks to destroy the OPFOR checkpoint on ' + at(s, gr),
    likely: 'Defend', setup: (ctx) => restAt(ctx, ctx.site, 2),
  },
  bridge: {
    label: 'Bridge security', size: [6, 10], kind: 'regular', site: ['crossing', 'road'], draft: 'attack', digIn: true,
    activity: (s) => 'Securing ' + s.name + ' with positions on both approaches.',
    task: (s, gr) => 'attacks to destroy OPFOR at ' + s.name + ' (grid ' + gr + ') in order to seize the crossing',
    likely: 'Defend', setup: (ctx) => holdAt(ctx, ctx.site, ctx.blue),
  },
  observationPost: {
    label: 'Observation post', size: [4, 5], kind: 'recon', site: ['peak'], draft: 'attack',
    activity: (s) => 'An observation post on ' + s.name + ', watching the ground toward you.',
    task: (s, gr) => 'attacks to destroy the OPFOR observation post on ' + s.name + ' (grid ' + gr + ') in order to blind the enemy',
    likely: 'Defend', setup: (ctx) => holdAt(ctx, ctx.site, ctx.blue),
  },
  hillStrongpoint: {
    label: 'Hilltop strongpoint', size: [12, 15], kind: 'regular', site: ['peak'], draft: 'attack', digIn: true,
    activity: (s) => 'A reinforced squad dug in on ' + s.name + ' with machine guns covering the slopes.',
    task: (s, gr) => 'attacks to destroy OPFOR on ' + s.name + ' (grid ' + gr + ') in order to seize the high ground',
    likely: 'Defend', setup: (ctx) => holdAt(ctx, ctx.site, ctx.blue),
  },
  withdrawal: {
    label: 'Enemy withdrawal', size: [8, 14], kind: 'regular', site: ['open'], draft: 'attack', escape: 0.5, mode: 'chase',
    activity: (s, dir) => 'Withdrawing away from you on foot, toward the far edge of the sheet. Some wounded.',
    task: (s, gr) => 'pursues and destroys OPFOR withdrawing from vicinity grid ' + gr + ' before it gets off the sheet',
    likely: 'Withdraw', setup: (ctx) => { place(ctx, ctx.site); exitAway(ctx); ctx.wounded = 0.15; },
  },
  crossingFront: {
    label: 'Patrol crossing your front', size: [6, 10], kind: 'regular', site: ['open'], draft: 'defense', escape: 0.6,
    activity: (s, dir) => 'A patrol moving across your front from one side of the sheet to the other.',
    task: (s, gr) => 'intercepts and destroys the OPFOR patrol crossing vicinity grid ' + gr + ' before it leaves the sheet',
    likely: 'Attack', setup: (ctx) => { place(ctx, ctx.site); exitAcross(ctx); },
  },
  commandPost: {
    label: 'Command post raid', size: [6, 10], kind: 'regular', site: ['farm', 'village'], draft: 'attack', hvt: true,
    activity: (s) => 'A command post at ' + s.name + ': a commander, his radio operator and a guard force.',
    task: (s, gr) => 'raids the OPFOR command post at ' + s.name + ' (grid ' + gr + ') to kill or capture the commander',
    likely: 'Defend', setup: (ctx) => holdAt(ctx, ctx.site, ctx.blue), leader: 'CO',
  },
  snipers: {
    label: 'Sniper team', size: [4, 4], kind: 'recon', site: ['woods', 'peak'], draft: 'attack',
    activity: (s) => 'A sniper team in ' + s.name + ', covering the open ground toward you.',
    task: (s, gr) => 'destroys the OPFOR sniper team in ' + at(s, gr),
    likely: 'Defend', setup: (ctx) => holdAt(ctx, ctx.site, ctx.blue), billets: ['MM', 'MM', 'R'],
  },
  treeLine: {
    label: 'Tree line defense', size: [8, 12], kind: 'regular', site: ['woods'], draft: 'attack', digIn: true,
    activity: (s) => 'Dug in along the edge of ' + s.name + ', facing the open ground.',
    task: (s, gr) => 'attacks to destroy OPFOR in ' + s.name + ' (grid ' + gr + ') in order to clear the tree line',
    likely: 'Defend', setup: (ctx) => holdAt(ctx, ctx.site, ctx.blue),
  },
  truck: {
    label: 'Stalled truck', size: [4, 7], kind: 'irregular', site: ['road'], draft: 'attack', evac: [20, 30],
    activity: (s) => 'A broken-down truck on ' + s.name + ' with its crew and guards working to get it running.',
    task: (s, gr, M) => 'destroys OPFOR at the truck on ' + s.name + ' (grid ' + gr + ') before it is repaired and gone, expected H+' + Math.round(M.evacAt / 60),
    likely: 'Defend', setup: (ctx) => { ctx.objects.push({ kind: 'truck', x: ctx.site.x, y: ctx.site.y, name: 'Truck' }); restAt(ctx, ctx.site, 2); },
  },
  waterPoint: {
    label: 'Water point', size: [5, 8], kind: 'irregular', site: ['pond', 'crossing'], draft: 'attack', leaveAt: [22, 32], escape: 0.5,
    activity: (s) => 'Filling water cans at ' + s.name + ', resting in the shade. Will move on when done.',
    task: (s, gr, M) => 'destroys OPFOR at ' + s.name + ' (grid ' + gr + ') before it moves on, expected about H+' + Math.round(M.leaveAt / 60),
    likely: 'Defend', setup: (ctx) => restAt(ctx, ctx.site.ring ? ctx.site.ring[0] : ctx.site, 1),
  },
  foragers: {
    label: 'Foraging party', size: [4, 6], kind: 'irregular', site: ['village', 'farm'], draft: 'attack', escape: 0.5,
    activity: (s) => 'A foraging party going through ' + s.name + ' for food and fuel.',
    task: (s, gr) => 'destroys the OPFOR foraging party in ' + at(s, gr),
    likely: 'Withdraw', setup: (ctx) => roam(ctx, around(ctx.site, 90, 6), true),
  },
  relay: {
    label: 'Radio relay site', size: [4, 6], kind: 'regular', site: ['peak'], draft: 'attack', reach: 'relay',
    activity: (s) => 'A radio relay on ' + s.name + ': an antenna mast and a small guard.',
    task: (s, gr) => 'attacks to destroy OPFOR on ' + s.name + ' (grid ' + gr + ') and destroy the radio relay',
    likely: 'Defend', setup: (ctx) => { ctx.objects.push({ kind: 'relay', x: ctx.site.x, y: ctx.site.y, name: 'Radio relay' }); holdAt(ctx, ctx.site, ctx.blue); },
  },
  stragglers: {
    label: 'Stragglers at a farm', size: [6, 10], kind: 'irregular', site: ['farm', 'village'], draft: 'attack', morale: [28, 42],
    activity: (s) => 'Stragglers from a beaten unit gathering at ' + s.name + '. Tired, some wounded, poorly led.',
    task: (s, gr) => 'attacks to destroy OPFOR gathering at ' + s.name + ' (grid ' + gr + ') before it can reorganize',
    likely: 'Withdraw', setup: (ctx) => { restAt(ctx, ctx.site, 1); ctx.wounded = 0.2; },
  },
  column: {
    label: 'Foot column on the road', size: [10, 15], kind: 'regular', site: ['road'], draft: 'defense', escape: 0.5,
    activity: (s) => 'A column on foot moving along ' + s.name + ' toward the edge of the sheet.',
    task: (s, gr) => 'ambushes and destroys the OPFOR column on ' + s.name + ' (grid ' + gr + ') before it gets through',
    likely: 'Attack', setup: (ctx) => { const a = ctx.site.a, b = ctx.site.b; place(ctx, a); exitVia(ctx, [b]); },
  },
  attack: {
    label: 'Hasty attack', size: [6, 12], kind: 'regular', site: ['village', 'farm', 'peak', 'woods', 'open'], draft: 'attack', digIn: true,
    activity: (s) => 'Defending ' + (s.kind === 'village' ? 'the buildings of ' : 'around ') + s.name + ', oriented toward you. Observed preparing positions.',
    task: (s, gr) => 'attacks to destroy OPFOR vicinity grid ' + gr + ' in order to secure ' + s.name,
    likely: 'Defend', setup: (ctx) => holdAt(ctx, ctx.site, ctx.blue),
  },
};
const MISSION_KEYS = Object.keys(MISSIONS);
// A site in an order: its name and grid, or just the grid in open country.
function at(s, gr) { return s.kind === 'open' ? 'vicinity grid ' + gr : s.name + ' (grid ' + gr + ')'; }

// ---------------------------------------------------------------- setting the enemy up
function place(ctx, p) { placeSquad(ctx.red, G.map, p.x, p.y, angleTo(p.x, p.y, ctx.blue.x, ctx.blue.y)); }
function holdAt(ctx, p, threat) {
  placeSquad(ctx.red, G.map, p.x, p.y, angleTo(p.x, p.y, threat.x, threat.y));
  setupDefense(ctx.red, threat);
  ctx.ai = { mode: 'defend', objective: ctx.blue };
}
// At rest: the men sit about in a loose ring, relaxed and slow to notice anything; a few
// sentries stand watch facing outward.
function restAt(ctx, p, sentries) {
  const sq = ctx.red, all = sq.all;
  all.forEach((s, i) => {
    const a = i / all.length * Math.PI * 2, r = randRange(6, 14);
    const c = G.map.nearestPassable(Math.floor((p.x + Math.cos(a) * r) / CELL), Math.floor((p.y + Math.sin(a) * r) / CELL));
    s.x = (c.cx + 0.5) * CELL; s.y = (c.cy + 0.5) * CELL;
    s.facing = s.look = a; s.relaxed = true; s.homePosture = s.posture = 'prone';
  });
  for (const s of shuffle(all.slice()).slice(0, sentries)) {
    const a = randRange(0, Math.PI * 2);
    s.x = clamp(p.x + Math.cos(a) * 35, 5, MAP_W - 5); s.y = clamp(p.y + Math.sin(a) * 35, 5, MAP_H - 5);
    const c = G.map.nearestPassable(Math.floor(s.x / CELL), Math.floor(s.y / CELL));
    s.x = (c.cx + 0.5) * CELL; s.y = (c.cy + 0.5) * CELL;
    s.relaxed = false; s.homePosture = s.posture = 'kneel'; s.facing = s.look = s.faceAngle = a;
  }
  ctx.ai = { mode: 'defend', objective: ctx.blue };
}
// Walking a route: round and round (loop) or out and back (shuttle).
function patrol(ctx, pts, kind) {
  pts = pts.filter(Boolean);
  place(ctx, pts[0]);
  ctx.ai = { mode: 'patrol', objective: ctx.blue, routine: { kind, pts, i: 1, dir: 1, pause: 0 } };
}
// Moving between points with pauses: men going house to house, or a recon team between hides.
function roam(ctx, pts, breakOff, teamsOnly) {
  if (!teamsOnly) place(ctx, pts[0]);
  ctx.ai = Object.assign(ctx.ai || { mode: 'defend', objective: ctx.blue }, { routine: { kind: 'roam', pts, i: 1, pause: 0, teams: teamsOnly ? ctx.red.teams.slice(-teamsOnly) : null } });
  if (breakOff) ctx.ai.breakOff = true;
}
// Leaving the sheet: straight away from the squad, across its front, or along a road.
function edgePoint(from, ang) {
  let x = from.x, y = from.y;
  for (let r = 0; r < MAP_W * 2; r += 20) { x = from.x + Math.cos(ang) * r; y = from.y + Math.sin(ang) * r; if (x < 15 || y < 15 || x > MAP_W - 15 || y > MAP_H - 15) break; }
  return { x: clamp(x, 10, MAP_W - 10), y: clamp(y, 10, MAP_H - 10) };
}
function exitVia(ctx, pts) {
  const last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : ctx.site;
  const out = edgePoint(last, angleTo(prev.x, prev.y, last.x, last.y));
  ctx.ai = { mode: 'patrol', objective: ctx.blue, routine: { kind: 'exit', pts: [...pts, out], i: 0, pause: 0 }, escape: out };
}
function exitAway(ctx) { exitVia(ctx, [edgePoint(ctx.site, angleTo(ctx.blue.x, ctx.blue.y, ctx.site.x, ctx.site.y))]); }
function exitAcross(ctx) { const a = angleTo(ctx.blue.x, ctx.blue.y, ctx.site.x, ctx.site.y) + (chance(0.5) ? 1 : -1) * Math.PI / 2; exitVia(ctx, [edgePoint(ctx.site, a)]); }
function circle(p, r, n) { const out = []; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; out.push({ x: clamp(p.x + Math.cos(a) * r, 30, MAP_W - 30), y: clamp(p.y + Math.sin(a) * r, 30, MAP_H - 30) }); } return out; }
function around(p, r, n) { return shuffle(circle(p, r, n)).map(q => { const c = G.map.nearestPassable(Math.floor(q.x / CELL), Math.floor(q.y / CELL)); return { x: (c.cx + 0.5) * CELL, y: (c.cy + 0.5) * CELL }; }); }

// ---------------------------------------------------------------- choosing and building a mission
// Pick a mission (or take the one asked for), a site for it on this sheet and a start for
// the squad 1.0 to 1.4 km from it, then build and place the enemy.
function setupMission(key, blue) {
  const m = G.map, ech = G.echelon, M0 = ech.margin;
  const keys = key && MISSIONS[key] ? [key] : shuffle(MISSION_KEYS.slice());
  for (const k of [...keys, 'attack']) {
    const D = MISSIONS[k];
    let sites = [];
    for (const s of D.site) sites = sites.concat((Sites[s](m) || []).filter(p => Sites.inside(p.x, p.y, M0)));
    if (!sites.length) continue;
    const site = sites[0];
    // The squad's start: on passable ground at the echelon's distance from the site.
    let start = null;
    for (let t = 0; t < 600 && !start; t++) {
      const a = randRange(0, Math.PI * 2), d = randRange(ech.sep[0], ech.sep[1]);
      const x = site.x + Math.cos(a) * d, y = site.y + Math.sin(a) * d;
      if (Sites.inside(x, y, M0) && TERRAIN[m.terAt(x, y)].speed > 0) start = { x, y };
    }
    if (!start) continue;
    const n = randInt(D.size[0], D.size[1]);
    const red = buildOpfor(n, D.kind, { leader: D.leader });
    if (D.morale) red.morale = randRange(D.morale[0], D.morale[1]);
    if (D.billets) red.teams.forEach((t, i) => t.members.forEach((s, j) => {
      const b = D.billets[(i * 4 + j) % D.billets.length], B = OPFOR_BILLETS[b];
      s.billet = b; s.title = B.title; s.name = B.title; s.weaponKey = B.weapon; s.weapon = WEAPONS[B.weapon]; s.inMag = s.weapon.mag; s.mags = s.weapon.mags - 1; s.ammoStart = s.ammoLeft;
    }));
    placeSquad(blue, m, start.x, start.y, angleTo(start.x, start.y, site.x, site.y));
    const ctx = { key: k, D, site, blue: start, red, objects: [], ai: null, wounded: 0 };
    D.setup(ctx);
    // Some of a beaten force are already hurt.
    for (const s of red.all) if (ctx.wounded && chance(ctx.wounded)) s.health = 'light';
    const M = { key: k, def: D, label: D.label, site, objects: ctx.objects, mode: D.mode || 'attack', digIn: !!D.digIn, reach: D.reach || null,
      escape: D.escape || 0, hvt: D.hvt ? red.leader : null, kind: D.kind };
    if (D.evac) M.evacAt = randInt(D.evac[0], D.evac[1]) * 60;
    if (D.leaveAt) M.leaveAt = randInt(D.leaveAt[0], D.leaveAt[1]) * 60;
    return { M, red, start, site, ai: ctx.ai };
  }
  return null;
}

// What the intelligence says about the enemy's size. Reports differ in quality, and the
// order says how far to trust each: some are right, some are wrong, some do not say.
function intelSize(n, kindKey) {
  const K = OPFOR_KINDS[kindKey], men = K.men, r = rand();
  if (r < 0.4) {
    const lo = Math.max(3, n - randInt(0, 2)), hi = Math.max(lo + 1, n + randInt(0, 2));
    return { text: 'OPFOR of ' + lo + '-' + hi + ' ' + men + '.', note: 'Confirmed by two sources. Considered reliable.', right: true };
  }
  if (r < 0.65) {
    // A wrong count: off by several men, either way, from a single source.
    const off = (chance(0.6) ? -1 : 1) * randInt(3, 5), c = Math.max(3, n + off);
    return { text: 'OPFOR of ' + Math.max(3, c - 1) + '-' + (c + 1) + ' ' + men + '.', note: 'A single report, not confirmed. Treat with caution.', right: false };
  }
  if (r < 0.85) {
    const floor = n <= 5 ? 'fire team' : n <= 9 ? 'section' : 'squad';
    return { text: 'OPFOR at least ' + floor + '-sized.', note: 'Only part of the force was seen. It may be larger.', right: true, vague: true };
  }
  return { text: 'OPFOR of unknown size.', note: 'Contact was brief; no count was made.', right: null };
}

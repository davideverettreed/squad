'use strict';
// Terrain grid, procedural generation, line of sight, pathfinding and cover search.

class GameMap {
  constructor(seed) {
    this.ter = new Uint8Array(GW * GH);
    this.elev = new Float32Array(GW * GH);
    this.buildings = [];
    this.trees = [];
    setSeed(seed);
    this.generate();
  }

  idx(cx, cy) { return cy * GW + cx; }
  inGrid(cx, cy) { return cx >= 0 && cy >= 0 && cx < GW && cy < GH; }
  cellOf(x, y) { return { cx: clamp(Math.floor(x / CELL), 0, GW - 1), cy: clamp(Math.floor(y / CELL), 0, GH - 1) }; }
  terAt(x, y) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (!this.inGrid(cx, cy)) return TER.OPEN;
    return this.ter[cy * GW + cx];
  }
  passableCell(cx, cy) { return this.inGrid(cx, cy) && this.ter[cy * GW + cx] !== TER.BUILDING; }

  // Ground elevation in meters, interpolated between cell centers.
  elevAt(x, y) {
    const fx = clamp(x / CELL - 0.5, 0, GW - 1.001), fy = clamp(y / CELL - 0.5, 0, GH - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const e = this.elev, i = y0 * GW + x0;
    const a = e[i], b = e[i + 1], c = e[i + GW], d = e[i + GW + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  // ---------------------------------------------------------------- generation
  generate() {
    this.genElevation();
    this.genFields();
    this.genWoods();
    this.genRoad();
    this.genHamlet();
    this.genTrees();
  }

  genElevation() {
    const octave = (nx, ny, amp) => {
      const grid = [];
      for (let j = 0; j <= ny; j++) { grid.push([]); for (let i = 0; i <= nx; i++) grid[j].push(rand()); }
      return (u, v) => {
        const fx = u * nx, fy = v * ny, i = Math.min(nx - 1, Math.floor(fx)), j = Math.min(ny - 1, Math.floor(fy));
        const tx = smooth(fx - i), ty = smooth(fy - j);
        const top = lerp(grid[j][i], grid[j][i + 1], tx), bot = lerp(grid[j + 1][i], grid[j + 1][i + 1], tx);
        return lerp(top, bot, ty) * amp;
      };
    };
    const o1 = octave(4, 3, 7), o2 = octave(9, 7, 2.2), o3 = octave(18, 14, 0.6);
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      const u = (cx + 0.5) / GW, v = (cy + 0.5) / GH;
      this.elev[cy * GW + cx] = o1(u, v) + o2(u, v) + o3(u, v);
    }
  }

  // Farm fields as Voronoi patches, bounded by tree lines, stone walls or nothing.
  genFields() {
    const kinds = [TER.OPEN, TER.OPEN, TER.PLOWED, TER.GRASS, TER.GRASS];
    const seeds = [];
    const n = randInt(9, 13);
    for (let i = 0; i < n; i++) seeds.push({ x: randRange(0, MAP_W), y: randRange(0, MAP_H), k: pick(kinds) });
    const owner = new Int16Array(GW * GH);
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = (seeds[i].x - x) ** 2 + (seeds[i].y - y) ** 2; if (d < bd) { bd = d; best = i; } }
      owner[cy * GW + cx] = best;
      this.ter[cy * GW + cx] = seeds[best].k;
    }
    const edgeKind = new Map();
    const edgeFor = (a, b) => {
      const key = Math.min(a, b) * 100 + Math.max(a, b);
      if (!edgeKind.has(key)) {
        const r = rand();
        edgeKind.set(key, { kind: r < 0.4 ? TER.WOODS : r < 0.68 ? TER.WALL : -1, phase: randInt(0, 20) });
      }
      return edgeKind.get(key);
    };
    for (let cy = 0; cy < GH - 1; cy++) for (let cx = 0; cx < GW - 1; cx++) {
      const a = owner[cy * GW + cx];
      const b = owner[cy * GW + cx + 1] !== a ? owner[cy * GW + cx + 1] : owner[(cy + 1) * GW + cx] !== a ? owner[(cy + 1) * GW + cx] : -1;
      if (b < 0) continue;
      const e = edgeFor(a, b);
      if (e.kind < 0) continue;
      // Gaps let men pass walls and hedgerows without climbing.
      if (e.kind === TER.WALL && (cx + cy + e.phase) % 16 < 2) continue;
      if (e.kind === TER.WOODS && (cx * 3 + cy + e.phase) % 23 < 2) continue;
      this.ter[cy * GW + cx] = e.kind;
    }
  }

  genWoods() {
    const n = randInt(2, 3);
    for (let k = 0; k < n; k++) {
      const wx = randRange(20, MAP_W - 20), wy = randRange(30, MAP_H - 40), r = randRange(12, 24);
      const lobes = [0, 1, 2, 3].map(() => ({ a: randRange(0, Math.PI * 2), s: randRange(0.15, 0.35) }));
      for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
        const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
        const a = Math.atan2(y - wy, x - wx);
        let rr = r;
        for (const l of lobes) rr += r * l.s * Math.cos(a * 2 - l.a);
        if (dist(x, y, wx, wy) < rr) this.ter[cy * GW + cx] = TER.WOODS;
      }
    }
  }

  genRoad() {
    let y = randRange(65, 115);
    this.roadY = [];
    for (let cx = 0; cx < GW; cx++) {
      y = clamp(y + gauss() * 0.5, 50, 130);
      this.roadY.push(y);
      const cy = Math.floor(y / CELL);
      for (let d = 0; d < 2; d++) if (this.inGrid(cx, cy + d)) this.ter[(cy + d) * GW + cx] = TER.ROAD;
    }
  }

  genHamlet() {
    const center = randRange(50, MAP_W - 50);
    const want = randInt(3, 6);
    const roofs = ['#8a4b3a', '#6f6a63', '#7d5a44', '#5c5f66'];
    for (let tries = 0; tries < 80 && this.buildings.length < want; tries++) {
      const w = randInt(4, 7), h = randInt(3, 5);
      const cx0 = Math.floor((center + randRange(-40, 40)) / CELL);
      const roadCy = Math.floor(this.roadY[clamp(cx0, 0, GW - 1)] / CELL);
      const north = chance(0.5);
      const off = randInt(2, 4);
      const cy0 = north ? roadCy - off - h : roadCy + 2 + off;
      if (!this.footprintFree(cx0 - 1, cy0 - 1, w + 2, h + 2)) continue;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.ter[(cy0 + j) * GW + cx0 + i] = TER.BUILDING;
      const b = { cx: cx0, cy: cy0, w, h, x0: cx0 * CELL, y0: cy0 * CELL, x1: (cx0 + w) * CELL, y1: (cy0 + h) * CELL,
        height: randRange(4.5, 7), roof: pick(roofs) };
      this.buildings.push(b);
      if (chance(0.4)) this.yardWall(b, north);
    }
  }

  footprintFree(cx, cy, w, h) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!this.inGrid(cx + i, cy + j)) return false;
      const t = this.ter[(cy + j) * GW + cx + i];
      if (t === TER.BUILDING || t === TER.ROAD) return false;
    }
    return true;
  }

  yardWall(b, north) {
    const m = 3, x0 = b.cx - m, y0 = b.cy - m, x1 = b.cx + b.w + m - 1, y1 = b.cy + b.h + m - 1;
    const gateX = b.cx + Math.floor(b.w / 2);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!this.inGrid(cx, cy)) continue;
      const edge = cx === x0 || cx === x1 || cy === y0 || cy === y1;
      if (!edge) continue;
      const roadSide = north ? cy === y1 : cy === y0;
      if (roadSide && Math.abs(cx - gateX) <= 1) continue;
      const i = cy * GW + cx;
      if (this.ter[i] !== TER.ROAD && this.ter[i] !== TER.BUILDING) this.ter[i] = TER.WALL;
    }
  }

  genTrees() {
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      if (this.ter[cy * GW + cx] !== TER.WOODS || !chance(0.8)) continue;
      this.trees.push({ x: (cx + randRange(0.1, 0.9)) * CELL, y: (cy + randRange(0.1, 0.9)) * CELL,
        r: randRange(1.6, 2.9), h: randRange(6, 10), tone: randRange(-1, 1) });
    }
  }

  // ---------------------------------------------------------------- line of sight
  // Returns how much of the line is unobstructed, 0 (blocked) to 1 (clear).
  // za and zb are heights above the ground at each end.
  los(ax, ay, za, bx, by, zb) {
    const d = dist(ax, ay, bx, by);
    if (d < 0.75) return 1;
    const ga = this.elevAt(ax, ay) + za, gb = this.elevAt(bx, by) + zb;
    const n = Math.ceil(d / 0.8);
    let dens = 0, last = -1;
    for (let i = 1; i < n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const h = ga + (gb - ga) * t;
      const ground = this.elevAt(x, y);
      if (ground > h) return 0;
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      if (!this.inGrid(cx, cy)) continue;
      const ci = cy * GW + cx;
      if (ci === last) continue;
      last = ci;
      const T = TERRAIN[this.ter[ci]];
      if (h >= ground + T.losH) continue;
      const fromA = t * d, fromB = d - fromA;
      if (T.solid) return 0;
      if (T.density) {
        // A man at the edge of cover can see out of it; his own cell counts less.
        const w = fromA < 1.5 ? 0.25 : fromB < 1.5 ? 0.5 : 1;
        dens += T.density * w;
        if (dens >= 1) return 0;
      }
    }
    return 1 - dens;
  }

  // ---------------------------------------------------------------- pathfinding
  nearestPassable(cx, cy) {
    if (this.passableCell(cx, cy) && this.ter[cy * GW + cx] !== TER.WALL) return { cx, cy };
    for (let r = 1; r < 12; r++) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = cx + i, y = cy + j;
        if (this.passableCell(x, y) && this.ter[y * GW + x] !== TER.WALL) return { cx: x, cy: y };
      }
    }
    return { cx, cy };
  }

  straightWalkable(ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by), n = Math.ceil(d / 0.7);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const k = this.terAt(x, y);
      if (k === TER.BUILDING || k === TER.WALL) return false;
      // Keep clear of building corners so men do not clip through them.
      if (this.terAt(x + 0.6, y) === TER.BUILDING || this.terAt(x - 0.6, y) === TER.BUILDING ||
          this.terAt(x, y + 0.6) === TER.BUILDING || this.terAt(x, y - 0.6) === TER.BUILDING) return false;
    }
    return true;
  }

  // A* over the grid; cost is travel time. Returns waypoints in meters, or null.
  findPath(sx, sy, tx, ty) {
    tx = clamp(tx, 1, MAP_W - 1); ty = clamp(ty, 1, MAP_H - 1);
    const s = this.cellOf(sx, sy), t0 = this.cellOf(tx, ty);
    const t = this.nearestPassable(t0.cx, t0.cy);
    const exact = t.cx === t0.cx && t.cy === t0.cy;
    const goal = exact ? { x: tx, y: ty } : { x: (t.cx + 0.5) * CELL, y: (t.cy + 0.5) * CELL };
    if (s.cx === t.cx && s.cy === t.cy) return [goal];
    if (this.straightWalkable(sx, sy, goal.x, goal.y) && dist(sx, sy, goal.x, goal.y) < 40) return [goal];

    const N = GW * GH, start = s.cy * GW + s.cx, end = t.cy * GW + t.cx;
    const g = this._g || (this._g = new Float32Array(N));
    const came = this._came || (this._came = new Int32Array(N));
    const closed = this._closed || (this._closed = new Uint8Array(N));
    g.fill(Infinity); came.fill(-1); closed.fill(0);
    const heap = new MinHeap();
    const h = (i) => {
      const dx = Math.abs((i % GW) - t.cx), dy = Math.abs(Math.floor(i / GW) - t.cy);
      return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * CELL / 1.15;
    };
    g[start] = 0;
    heap.push(start, h(start));
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === end) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % GW, cy = Math.floor(cur / GW);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.passableCell(nx, ny)) continue;
        if (dx && dy && (!this.passableCell(cx + dx, cy) || !this.passableCell(cx, cy + dy))) continue;
        const ni = ny * GW + nx;
        if (closed[ni]) continue;
        const sp = TERRAIN[this.ter[ni]].speed;
        const cost = g[cur] + (dx && dy ? 1.414 : 1) * CELL / sp;
        if (cost < g[ni]) { g[ni] = cost; came[ni] = cur; heap.push(ni, cost + h(ni)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = end; i !== -1; i = came[i]) cells.push({ x: (i % GW + 0.5) * CELL, y: (Math.floor(i / GW) + 0.5) * CELL });
    cells.reverse();
    cells[cells.length - 1] = goal;
    // String-pull: skip waypoints wherever a straight walk is clear.
    const out = [];
    let ax = sx, ay = sy, i = 0;
    while (i < cells.length - 1) {
      let j = Math.min(cells.length - 1, i + 30);
      while (j > i + 1 && !this.straightWalkable(ax, ay, cells[j].x, cells[j].y)) j--;
      out.push(cells[j]);
      ax = cells[j].x; ay = cells[j].y; i = j;
    }
    if (!out.length) out.push(goal);
    return out;
  }

  // ---------------------------------------------------------------- cover
  // Best nearby spot that puts something between a man and the threat.
  findCover(x, y, tx, ty, radius, reserved) {
    let best = { x, y, posture: 'prone', score: -Infinity };
    const c = this.cellOf(x, y), r = Math.ceil(radius / CELL);
    const dThreat = dist(x, y, tx, ty);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const cx = c.cx + i, cy = c.cy + j;
      if (!this.passableCell(cx, cy)) continue;
      const k = this.ter[cy * GW + cx];
      if (k === TER.WALL) continue;
      const px = (cx + 0.5) * CELL, py = (cy + 0.5) * CELL;
      const d = dist(x, y, px, py);
      if (d > radius) continue;
      const a = angleTo(px, py, tx, ty), ca = Math.cos(a), sa = Math.sin(a);
      const k1 = this.terAt(px + ca * 1.8, py + sa * 1.8), k2 = this.terAt(px + ca * 3.4, py + sa * 3.4);
      let score = 0, posture = 'prone';
      if (k1 === TER.WALL || k2 === TER.WALL) { score += 6; posture = 'kneel'; }
      else if (k1 === TER.BUILDING || k2 === TER.BUILDING) { score += 3.5; posture = 'kneel'; }
      if (k === TER.WOODS) { score += 2.5; if (posture === 'prone' && score < 3) posture = 'prone'; }
      else if (k === TER.GRASS) score += 1.2;
      // Defilade: ground rising toward the threat.
      if (this.elevAt(px + ca * 5, py + sa * 5) - this.elevAt(px, py) > 0.45) score += 1.5;
      score -= d * 0.12;
      score -= Math.max(0, dThreat - dist(px, py, tx, ty)) * 0.04;
      if (reserved) for (const p of reserved) if (dist(p.x, p.y, px, py) < 3.5) score -= 4;
      // Cover is worth less if the man cannot fire from it.
      if (score > best.score && this.los(px, py, POSTURE[posture].eye, tx, ty, 1.0) <= 0) score -= 4;
      if (score > best.score) best = { x: px, y: py, posture, score };
    }
    return best;
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    k.push(key); p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [k[par], k[i]] = [k[i], k[par]]; [p[par], p[i]] = [p[i], p[par]];
      i = par;
    }
  }
  pop() {
    const k = this.k, p = this.p, top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}

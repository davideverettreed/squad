'use strict';
// Terrain grid for the sheet (2 x 2 km for a squad, 4 x 4 km for a platoon): procedural generation (relief, streams and ponds,
// fields, woods, roads, villages, farms), line of sight, pathfinding and cover search.


class GameMap {
  constructor(seed, region) {
    this.ter = new Uint8Array(GW * GH);
    this.elev = new Float32Array(GW * GH);
    this.buildings = [];
    this.roads = [];     // { kind: 'paved' | 'track', pts }
    this.streams = [];   // { pts, width }
    this.places = [];    // { name, x, y }
    setSeed(seed);
    // The region is drawn from the seed when not chosen, so a map number always gives the same sheet.
    const pickR = pick(REGION_KEYS.filter(k => !REGIONS[k].era));
    this.region = REGIONS[region] ? region : pickR;
    this.R = REGIONS[this.region];
    this.ci = this.R.ci; this.index = this.R.index;
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
  passableCell(cx, cy) { return this.inGrid(cx, cy) && TERRAIN[this.ter[cy * GW + cx]].speed > 0; }

  // Ground elevation in meters above the sheet's lowest ground, between cell centers.
  elevAt(x, y) {
    const fx = clamp(x / CELL - 0.5, 0, GW - 1.001), fy = clamp(y / CELL - 0.5, 0, GH - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const e = this.elev, i = y0 * GW + x0;
    const a = e[i], b = e[i + 1], c = e[i + GW], d = e[i + GW + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  // Relief shading for the printed map: slopes lit from the northwest at 45 degrees, measured
  // over 24 m so the small stream cuts do not streak it, heights doubled so gentle ground reads.
  shadeAt(x, y) {
    if (!this.shade) {
      const s = this.shade = new Float32Array(GW * GH), e = this.elev, k = 3, L = 0.7071;
      for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
        const x0 = Math.max(0, cx - k), x1 = Math.min(GW - 1, cx + k), y0 = Math.max(0, cy - k), y1 = Math.min(GH - 1, cy + k);
        const nx = -(e[cy * GW + x1] - e[cy * GW + x0]) / ((x1 - x0) * CELL) * 2;
        const ny = -(e[y1 * GW + cx] - e[y0 * GW + cx]) / ((y1 - y0) * CELL) * 2;
        s[cy * GW + cx] = clamp(1 + ((-0.5 * nx - 0.5 * ny + L) / Math.hypot(nx, ny, 1) - L) * 0.9, 0.72, 1.1);
      }
    }
    const fx = clamp(x / CELL - 0.5, 0, GW - 1.001), fy = clamp(y / CELL - 0.5, 0, GH - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * GW + x0, s = this.shade;
    return (s[i] * (1 - tx) + s[i + 1] * tx) * (1 - ty) + (s[i + GW] * (1 - tx) + s[i + GW + 1] * tx) * ty;
  }

  // ---------------------------------------------------------------- generation
  generate() {
    this.genElevation();
    if (this.inland) this.genCoast();
    this.genHydrology();
    this.genSwamps();
    this.genFields();
    this.genWoods();
    this.genRock();
    this.genRoads();
    this.genFords();
    this.genVillages();
    this.genFarms();
    // Height above sea level of the lowest ground, on an index contour.
    const step = this.ci * this.index;
    this.elevBase = Math.round(randInt(this.R.base[0], this.R.base[1]) * 10 / step) * step;
    this.gmAngle = randRange(-6, 6);     // grid-magnetic angle for the declination diagram
    this.findPeaks();
  }

  // Value noise with nx by ny cells across a 3 km sheet; a smaller sheet takes its share
  // of the cells, so hills, woods and fields keep their size on the ground.
  noise(nx, ny) {
    nx *= MAP_K; ny *= MAP_K;
    const cw = Math.ceil(nx) + 1, ch = Math.ceil(ny) + 1;
    const grid = new Float32Array(cw * ch);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    return (u, v) => {
      const fx = u * nx, fy = v * ny, i = Math.min(cw - 2, Math.floor(fx)), j = Math.min(ch - 2, Math.floor(fy));
      const tx = smooth(fx - i), ty = smooth(fy - j), w = cw;
      const top = lerp(grid[j * w + i], grid[j * w + i + 1], tx), bot = lerp(grid[(j + 1) * w + i], grid[(j + 1) * w + i + 1], tx);
      return lerp(top, bot, ty);
    };
  }

  // Relief by region: rolling hills, flat brush country, or ridged mountains with steep
  // spurs and broad desert flats below them. On the coast the land rises from the sea.
  genElevation() {
    // A smaller sheet takes in less of the country's relief.
    const R = this.R, relief = randRange(R.relief[0], R.relief[1]) * (0.45 + 0.55 * MAP_K);
    // In high country the small folds stay small: the fine octaves are damped so the flats stay flat.
    const damp = Math.min(1, 150 / relief);
    const oct = [[3, 0.55], [7, 0.26], [15, 0.12 * damp], [38, 0.05 * damp], [90, 0.015 * damp]].map(([n, a]) => ({ f: this.noise(n, n), a }));
    const coastX = R.coast ? this.noise(1, 6) : null, range = R.ridged ? this.noise(2, 2) : null;
    // A small sheet sees only part of a range, so it is laid across a mountain front:
    // high ground rising toward one side, the valley or basin floor on the other.
    const fa = randRange(0, Math.PI * 2), fx = Math.cos(fa), fy = Math.sin(fa);
    const front = (u, v) => clamp(0.5 + ((u - 0.5) * fx + (v - 0.5) * fy) * 1.3, 0, 1);
    if (R.coast) this.coastAt = (v) => MAP_W * (0.07 + coastX(0.5, v) * 0.09);
    // How far inland a point is: from the west coast, or from the shore of an island in
    // the middle of the sheet (negative at sea).
    if (R.island) {
      const rr = this.noise(5, 5), r0 = MAP_W * randRange(0.27, 0.32);
      this.inland = (x, y) => {
        const a = Math.atan2(y - MAP_H / 2, x - MAP_W / 2), u = 0.5 + Math.cos(a) * 0.4, v = 0.5 + Math.sin(a) * 0.4;
        return r0 * (0.75 + rr(u, v) * 0.5) - dist(x, y, MAP_W / 2, MAP_H / 2);
      };
    } else if (R.coast) this.inland = (x, y) => x - this.coastAt(y / MAP_H);
    let lo = Infinity, hi = -Infinity;
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      const u = (cx + 0.5) / GW, v = (cy + 0.5) / GH;
      let e = 0;
      oct.forEach((o, k) => {
        let n = o.f(u, v);
        // Ridged noise for mountains: sharp crests, then raised to a power so the low ground spreads flat.
        if (R.ridged && k < 3) n = 1 - Math.abs(2 * n - 1);
        e += n * o.a;
      });
      this.elev[cy * GW + cx] = e;
      if (e < lo) lo = e; if (e > hi) hi = e;
    }
    for (let i = 0; i < this.elev.length; i++) {
      let t = (this.elev[i] - lo) / (hi - lo);
      if (R.ridged) {
        // Mountain ranges over part of the sheet, broad valley or basin floor over the rest.
        const u = (i % GW + 0.5) / GW, v = (Math.floor(i / GW) + 0.5) / GH;
        const rv = MAP_K < 1 ? front(u, v) * 0.75 + range(u, v) * 0.35 - 0.05 : range(u, v);
        t = Math.pow(t, 1.8) * (R.floor + (1 - R.floor) * smooth(clamp((rv - 0.3) / 0.4, 0, 1)));
      }
      if (this.inland) {
        const d = this.inland((i % GW + 0.5) * CELL, (Math.floor(i / GW) + 0.5) * CELL);
        t *= 0.12 + 0.88 * smooth(clamp(d / (MAP_W * (R.island ? 0.25 : 0.5)), 0, 1));
      }
      this.elev[i] = t * relief;
    }
  }

  // The sea along the west edge, with a sand beach between it and the coastal bluffs.
  genCoast() {
    const nb = this.noise(4, 30);
    for (let cy = 0; cy < GH; cy++) {
      const v = (cy + 0.5) / GH;
      for (let cx = 0; cx < GW; cx++) {
        const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL, i = cy * GW + cx, d = this.inland(x, y);
        const beach = (this.R.island ? 15 : 25) + nb(this.R.island ? x / MAP_W : 0.5, v) * (this.R.island ? 25 : 45);
        if (d < 0) { this.ter[i] = TER.OCEAN; this.elev[i] = 0; }
        else {
          this.elev[i] += 1.5;
          if (d < beach) { this.ter[i] = TER.BEACH; this.elev[i] = Math.min(this.elev[i], 1.5 + d * 0.05); }
        }
      }
    }
  }

  // Water runs downhill: each cell drains to its lowest neighbor. Cells draining a large
  // enough area become streams; streams that end in a hollow fill it as a pond.
  genHydrology() {
    const N = GW * GH, e = this.elev;
    // Priority flood from the map edge: fill each hollow up to its spill level, so water
    // drained over the filled surface always finds its way off the sheet.
    const fill = new Float32Array(N), seen = new Uint8Array(N), heap = new MinHeap();
    for (let cx = 0; cx < GW; cx++) for (const cy of [0, GH - 1]) { const i = cy * GW + cx; if (!seen[i]) { seen[i] = 1; fill[i] = e[i]; heap.push(i, e[i]); } }
    for (let cy = 1; cy < GH - 1; cy++) for (const cx of [0, GW - 1]) { const i = cy * GW + cx; seen[i] = 1; fill[i] = e[i]; heap.push(i, e[i]); }
    const order = new Int32Array(N);
    let on = 0;
    while (heap.size) {
      const c = heap.pop();
      order[on++] = c;
      const x = c % GW, y = Math.floor(c / GW);
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        if (!j && !k) continue;
        const nx = x + k, ny = y + j;
        if (!this.inGrid(nx, ny)) continue;
        const n = ny * GW + nx;
        if (seen[n]) continue;
        seen[n] = 1;
        fill[n] = Math.max(e[n], fill[c] + 0.0005);
        heap.push(n, fill[n]);
      }
    }
    // Each cell drains to its lowest neighbor on the filled surface; flow accumulates
    // from the top of the flood order down.
    const down = new Int32Array(N).fill(-1);
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      const i = cy * GW + cx;
      if (cx === 0 || cy === 0 || cx === GW - 1 || cy === GH - 1) continue;
      let best = fill[i], bi = -1;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        if (!j && !k) continue;
        const n = (cy + j) * GW + cx + k;
        if (fill[n] < best) { best = fill[n]; bi = n; }
      }
      down[i] = bi;
    }
    const acc = new Float32Array(N).fill(1);
    for (let n = N - 1; n >= 0; n--) { const i = order[n]; if (down[i] >= 0) acc[down[i]] += acc[i]; }

    // Ponds: the deeper parts of small filled hollows.
    const pondSeen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (pondSeen[i] || fill[i] - e[i] < 1.2 || this.ter[i] === TER.OCEAN) continue;
      const region = [i], q = [i];
      pondSeen[i] = 1;
      while (q.length) {
        const c = q.pop(), x = c % GW, y = Math.floor(c / GW);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!this.inGrid(x + dx, y + dy)) continue;
          const n = (y + dy) * GW + x + dx;
          if (!pondSeen[n] && fill[n] - e[n] >= 0.6) { pondSeen[n] = 1; region.push(n); q.push(n); }
        }
      }
      // Desert hollows are dry; in the mountains in winter the ponds are frozen.
      if (region.length >= 40 && region.length <= 2500 && this.R.ponds !== 'dry') for (const c of region) this.ter[c] = this.R.ponds === 'ice' ? TER.ICE : TER.POND;
    }

    const T = Math.round(7000 * Math.max(0.4, MAP_K)); // cells of catchment before water runs as a stream
    const isStream = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (acc[i] >= T) isStream[i] = 1;

    // Trace streams into polylines, from each source downhill to a junction or the edge.
    const feeds = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (isStream[i] && down[i] >= 0) feeds[down[i]] = 1;
    const traced = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!isStream[i] || feeds[i]) continue;
      const pts = [];
      let c = i, width = 1.5, flow = 0;
      while (c >= 0) {
        pts.push({ x: (c % GW + 0.5) * CELL, y: (Math.floor(c / GW) + 0.5) * CELL });
        width = Math.max(width, 1.5 + 3 * clamp(Math.log(acc[c] / T) / Math.log(30), 0, 1));
        flow = Math.max(flow, acc[c]);
        if (traced[c] || this.ter[c] === TER.OCEAN) break;
        traced[c] = 1;
        c = down[c];
      }
      if (pts.length > 3) this.streams.push({ pts: simplifyLine(pts, 3), width, flow, len: pts.length * CELL, dry: !!this.R.dryStreams });
    }
    // Streams cut small gullies: a meter or so below the banks.
    const cut = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k0 = this.ter[i];
      if (!traced[i] || k0 === TER.POND || k0 === TER.ICE || k0 === TER.OCEAN || k0 === TER.BEACH) continue;
      // Dry country: the watercourses are sandy washes that run only after rain.
      this.ter[i] = this.R.dryStreams ? TER.WASH : TER.STREAM;
      const cx = i % GW, cy = Math.floor(i / GW);
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        if (!this.inGrid(cx + k, cy + j)) continue;
        const n = (cy + j) * GW + cx + k;
        cut[n] = Math.max(cut[n], j || k ? 0.5 : 1.3);
      }
    }
    for (let i = 0; i < N; i++) this.elev[i] -= cut[i];
    // On most sheets the biggest watercourse, if long enough, is a river.
    const main = this.streams.filter(s => s.len > MAP_W * 0.3).sort((a, b) => b.flow - a.flow)[0];
    // riverChance is the share of 3 km sheets in the region with a river; a smaller sheet
    // takes in less country, so it is less likely to hold one.
    if (main && chance(1 - Math.pow(1 - this.R.riverChance, MAP_K))) this.makeRiver(main);
  }

  // A river (12-18 m wide, or as the region has them) down the main valley: impassable on foot except at bridges and fords.
  makeRiver(st) {
    const rw = this.R.riverWidth || [12, 18], width = randRange(rw[0], rw[1]), half = width / 2;
    this.streams = this.streams.filter(s => s !== st);
    for (let k = 1; k < st.pts.length; k++) {
      const a = st.pts[k - 1], b = st.pts[k];
      const x0 = Math.floor((Math.min(a.x, b.x) - half) / CELL) - 1, x1 = Math.ceil((Math.max(a.x, b.x) + half) / CELL) + 1;
      const y0 = Math.floor((Math.min(a.y, b.y) - half) / CELL) - 1, y1 = Math.ceil((Math.max(a.y, b.y) + half) / CELL) + 1;
      const L2 = Math.max(1e-6, (b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        if (!this.inGrid(cx, cy)) continue;
        const px = (cx + 0.5) * CELL, py = (cy + 0.5) * CELL;
        const t = clamp(((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) / L2, 0, 1);
        const d = dist(px, py, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        const i = cy * GW + cx;
        if (d <= half && this.ter[i] !== TER.RIVER) { this.ter[i] = TER.RIVER; this.elev[i] -= 1.5; }
      }
    }
    this.river = { pts: st.pts, width, name: pick(this.R.rivers), bridges: [], fords: [] };
  }

  // Marsh in the flat low ground beside water: passable, very slow, reeds give concealment.
  genSwamps() {
    const S = this.R.swamp;
    if (!S) return;
    const N = GW * GH, water = (k) => k === TER.STREAM || k === TER.POND || k === TER.RIVER;
    const d = new Uint8Array(N).fill(255), q = [];
    for (let i = 0; i < N; i++) if (water(this.ter[i])) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % GW, y = Math.floor(c / GW);
      if (d[c] >= S.reach) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * GW + nx;
        if (this.inGrid(nx, ny) && d[j] === 255) { d[j] = d[c] + 1; q.push(j); }
      }
    }
    const sample = [];
    for (let i = 0; i < N; i += 97) sample.push(this.elev[i]);
    sample.sort((a, b) => a - b);
    const low = sample[Math.floor(sample.length * S.low)];
    const n1 = this.noise(16, 16);
    for (let cy = 1; cy < GH - 1; cy++) for (let cx = 1; cx < GW - 1; cx++) {
      const i = cy * GW + cx;
      if (d[i] === 0 || d[i] > S.reach || this.elev[i] > low) continue;
      const slope = Math.hypot(this.elev[i + 1] - this.elev[i - 1], this.elev[i + GW] - this.elev[i - GW]) / (2 * CELL);
      if (slope < (S.slope || 0.04) && n1((cx + 0.5) / GW, (cy + 0.5) / GH) > S.noise) this.ter[i] = TER.SWAMP;
    }
  }

  // One or two fords across the river, away from the bridges.
  genFords() {
    const r = this.river;
    if (!r) return;
    const want = randInt(1, 2), pts = r.pts;
    for (const f of shuffle([0.25, 0.45, 0.65, 0.8])) {
      if (r.fords.length >= want) break;
      const p = pts[Math.floor(f * (pts.length - 1))];
      if (p.x < 60 || p.y < 60 || p.x > MAP_W - 60 || p.y > MAP_H - 60) continue;
      const gap = Math.max(200, 350 * MAP_K);
      if (r.bridges.some(b => dist(b.x, b.y, p.x, p.y) < gap) || r.fords.some(b => dist(b.x, b.y, p.x, p.y) < gap)) continue;
      const c = this.cellOf(p.x, p.y), rr = Math.ceil((r.width / 2 + 6) / CELL);
      for (let j = -rr; j <= rr; j++) for (let i = -rr; i <= rr; i++) {
        const x = c.cx + i, y = c.cy + j;
        if (this.inGrid(x, y) && this.ter[y * GW + x] === TER.RIVER && Math.hypot(i, j) * CELL <= 10) this.ter[y * GW + x] = TER.FORD;
      }
      r.fords.push({ x: p.x, y: p.y });
    }
  }

  isWet(i) {
    const k = this.ter[i];
    return k === TER.STREAM || k === TER.POND || k === TER.SWAMP || k === TER.RIVER || k === TER.FORD ||
      k === TER.OCEAN || k === TER.BEACH || k === TER.ICE || k === TER.WASH;
  }

  // Farm fields as Voronoi patches on a jittered lattice, bounded by hedgerows, stone walls or nothing.
  genFields() {
    const R = this.R;
    if (!R.fields) {
      // Open country with no fields: the region's ground cover, with patches of something else.
      const pats = (R.desertPatches || []).map(([k, f]) => ({ k, f, n: this.noise(14, 14) }));
      for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
        const i = cy * GW + cx;
        if (this.isWet(i)) continue;
        this.ter[i] = R.base0;
        for (const p of pats) if (p.n((cx + 0.5) / GW, (cy + 0.5) / GH) > 1 - p.f * 2.2) this.ter[i] = p.k;
      }
      return;
    }
    const S = R.fieldSize || 200, nx = Math.ceil(MAP_W / S) + 1, ny = Math.ceil(MAP_H / S) + 1;
    const kinds = R.fields;
    const total = kinds.reduce((n, k) => n + k[1], 0);
    const pickKind = () => { let r = rand() * total; for (const [k, w] of kinds) { if ((r -= w) <= 0) return k; } return TER.OPEN; };
    const seeds = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) seeds.push({ x: (i + randRange(0.1, 0.9)) * S, y: (j + randRange(0.1, 0.9)) * S, k: pickKind() });
    const owner = new Int32Array(GW * GH);
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL, li = Math.floor(x / S), lj = Math.floor(y / S);
      let best = 0, bd = Infinity;
      for (let j = lj - 1; j <= lj + 1; j++) for (let i = li - 1; i <= li + 1; i++) {
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const s = seeds[j * nx + i], d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < bd) { bd = d; best = j * nx + i; }
      }
      const c = cy * GW + cx;
      owner[c] = best;
      if (!this.isWet(c)) this.ter[c] = seeds[best].k;
    }
    const edgeKind = new Map();
    const edgeFor = (a, b) => {
      const key = Math.min(a, b) * 100000 + Math.max(a, b);
      if (!edgeKind.has(key)) { const r = rand(); edgeKind.set(key, { kind: r < R.hedges ? (R.hedgeKind != null ? R.hedgeKind : TER.WOODS) : r < R.hedges + R.walls ? TER.WALL : -1, phase: randInt(0, 30) }); }
      return edgeKind.get(key);
    };
    for (let cy = 0; cy < GH - 1; cy++) for (let cx = 0; cx < GW - 1; cx++) {
      const c = cy * GW + cx, a = owner[c];
      const b = owner[c + 1] !== a ? owner[c + 1] : owner[c + GW] !== a ? owner[c + GW] : -1;
      if (b < 0 || this.isWet(c)) continue;
      const e = edgeFor(a, b);
      if (e.kind < 0) continue;
      // Gaps let men pass walls and hedgerows without climbing.
      if (e.kind === TER.WALL && (cx + cy + e.phase) % 22 < 2) continue;
      if (e.kind === TER.WOODS && (cx * 3 + cy + e.phase) % 31 < 2) continue;
      this.ter[c] = e.kind;
    }
  }

  // Woods: large stands, more of them on steep ground and high ground.
  genWoods() {
    const n1 = this.noise(6, 6), n2 = this.noise(17, 17);
    let maxE = 0;
    for (const v of this.elev) if (v > maxE) maxE = v;
    for (let cy = 1; cy < GH - 1; cy++) for (let cx = 1; cx < GW - 1; cx++) {
      const c = cy * GW + cx;
      if (this.isWet(c)) continue;
      const u = (cx + 0.5) / GW, v = (cy + 0.5) / GH;
      const slope = Math.hypot(this.elev[c + 1] - this.elev[c - 1], this.elev[c + GW] - this.elev[c - GW]) / (2 * CELL);
      const f = n1(u, v) * 0.7 + n2(u, v) * 0.3 + Math.min(0.18, slope * 1.5) + this.elev[c] / maxE * 0.08;
      if (f > this.R.woods && !(this.R.treeline && this.elev[c] / maxE > this.R.treeline)) this.ter[c] = TER.WOODS;
      // Jungle on the hills above the paddy land.
      else if (this.R.highWoods && this.elev[c] / maxE > this.R.highWoods + (n2(u, v) - 0.5) * 0.1) this.ter[c] = TER.WOODS;
    }
    // Trees along the watercourses: live oak and pecan, gum and cypress, cottonwood.
    const rip = this.R.riparian;
    if (rip) {
      const N = GW * GH, d = new Uint8Array(N).fill(255), q = [];
      for (let i = 0; i < N; i++) { const k = this.ter[i]; if (k === TER.STREAM || k === TER.WASH || k === TER.RIVER) { d[i] = 0; q.push(i); } }
      for (let h = 0; h < q.length; h++) {
        const c = q[h], x = c % GW, y = Math.floor(c / GW);
        if (d[c] >= rip) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, j = ny * GW + nx;
          if (this.inGrid(nx, ny) && d[j] === 255) { d[j] = d[c] + 1; q.push(j); }
        }
      }
      for (let i = 0; i < N; i++) if (d[i] > 0 && d[i] <= rip && !this.isWet(i) && n2((i % GW + 0.5) / GW, (Math.floor(i / GW) + 0.5) / GH) > 0.42) this.ter[i] = TER.WOODS;
    }
    // In snow country the open ground lies under deep snow.
    if (this.R.snow) for (let i = 0; i < GW * GH; i++) { const k = this.ter[i]; if (k === TER.OPEN || k === TER.GRASS || k === TER.PLOWED) this.ter[i] = TER.SNOW; }
  }

  // Rock outcrops and talus on the steep slopes and crests of mountain country.
  genRock() {
    const lim = this.R.rock;
    if (!lim) return;
    const n = this.noise(24, 24);
    let maxE = 0;
    for (const v of this.elev) if (v > maxE) maxE = v;
    for (let cy = 1; cy < GH - 1; cy++) for (let cx = 1; cx < GW - 1; cx++) {
      const c = cy * GW + cx;
      if (this.isWet(c)) continue;
      const slope = Math.hypot(this.elev[c + 1] - this.elev[c - 1], this.elev[c + GW] - this.elev[c - GW]) / (2 * CELL);
      const nv = n((cx + 0.5) / GW, (cy + 0.5) / GH);
      if ((slope > lim && nv > 0.3) || (this.elev[c] / maxE > 0.9 && nv > 0.45)) this.ter[c] = TER.ROCK;
    }
  }

  // Least-cost route for a road: avoids steep ground, woods and water.
  routeRoad(sx, sy, tx, ty) {
    const N = GW * GH, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = new MinHeap(), start = sy * GW + sx, end = ty * GW + tx;
    const h = (i) => Math.hypot(i % GW - tx, Math.floor(i / GW) - ty) * 1.2;
    g[start] = 0; heap.push(start, h(start));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === end) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % GW, cy = Math.floor(cur / GW);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.inGrid(nx, ny)) continue;
        const ni = ny * GW + nx, k = this.ter[ni];
        if (closed[ni] || k === TER.POND || k === TER.BUILDING || k === TER.OCEAN || k === TER.ICE) continue;
        const grade = Math.abs(this.elev[ni] - this.elev[cur]) / CELL;
        let cost = (dx && dy ? 1.414 : 1) * (1 + grade * grade * 400);
        if (k === TER.WOODS) cost *= 2;
        if (k === TER.STREAM) cost += 12;
        if (k === TER.RIVER) cost += 60;
        if (k === TER.SWAMP) cost *= 3;
        if (k === TER.ROCK) cost *= 4;
        if (k === TER.CHAPARRAL || k === TER.BEACH) cost *= 1.6;
        if (k === TER.WASH) cost += 4;
        if (k === TER.ROAD || k === TER.PAVED) cost *= 0.4;
        const ng = g[cur] + cost;
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; heap.push(ni, ng + h(ni)); }
      }
    }
    if (came[end] < 0) return null;
    const cells = [];
    for (let i = end; i !== -1; i = came[i]) cells.push(i);
    return cells.reverse();
  }

  layRoad(cells, kind) {
    // Before the motor age there are no hard-surfaced roads: cart tracks only.
    if (this.R.paved === false) kind = 'track';
    const t = kind === 'paved' ? TER.PAVED : TER.ROAD;
    // Where the road crosses the river, a bridge: one per run of river cells.
    let run = [];
    const endRun = () => {
      if (!run.length) return;
      const a = run[0], b = run[run.length - 1];
      const ax = (a % GW + 0.5) * CELL, ay = (Math.floor(a / GW) + 0.5) * CELL, bx = (b % GW + 0.5) * CELL, by = (Math.floor(b / GW) + 0.5) * CELL;
      const ia = cells.indexOf(a), pa = cells[Math.max(0, ia - 1)], pb = cells[Math.min(cells.length - 1, cells.indexOf(b) + 1)];
      const ang = Math.atan2(Math.floor(pb / GW) - Math.floor(pa / GW), pb % GW - pa % GW);
      if (this.river) this.river.bridges.push({ x: (ax + bx) / 2, y: (ay + by) / 2, a: ang, len: dist(ax, ay, bx, by) + CELL, kind });
      run = [];
    };
    for (const c of cells) { if (this.ter[c] === TER.RIVER) run.push(c); else endRun(); }
    endRun();
    for (const c of cells) if (this.ter[c] !== TER.PAVED) this.ter[c] = t;
    const pts = cells.map(c => ({ x: (c % GW + 0.5) * CELL, y: (Math.floor(c / GW) + 0.5) * CELL }));
    this.roads.push({ kind, pts: simplifyLine(pts, 2.5), cells });
  }

  edgePoint(side) {
    const r = randInt(Math.floor(GW * 0.2), Math.floor(GW * 0.8));
    return side === 'w' ? [0, r] : side === 'e' ? [GW - 1, r] : side === 'n' ? [r, 0] : [r, GH - 1];
  }

  genRoads() {
    if (this.R.island) {
      // One track across the island from shore to shore.
      const a = randRange(0, Math.PI * 2), end = (ang) => {
        for (let r = MAP_W * 0.45; r > 0; r -= 8) {
          const x = MAP_W / 2 + Math.cos(ang) * r, y = MAP_H / 2 + Math.sin(ang) * r;
          if (this.inland(x, y) > 30) return [Math.floor(x / CELL), Math.floor(y / CELL)];
        }
        return [Math.floor(GW / 2), Math.floor(GH / 2)];
      };
      const [p, q] = [end(a), end(a + Math.PI)], tr = this.routeRoad(p[0], p[1], q[0], q[1]);
      if (tr) this.layRoad(tr, 'track');
      return;
    }
    if (this.R.coast) {
      // The coast highway runs north and south a little inland; a canyon road climbs east.
      const off = (v) => Math.floor((this.coastAt(v) + MAP_W * randRange(0.09, 0.2)) / CELL);
      const hw = this.routeRoad(off(0), 0, off(1), GH - 1);
      if (hw) this.layRoad(hw, 'paved');
      const y = randInt(Math.floor(GH * 0.25), Math.floor(GH * 0.75)), x0 = off((y + 0.5) / GH);
      const tr = this.routeRoad(x0, y, GW - 1, randInt(Math.floor(GH * 0.2), Math.floor(GH * 0.8)));
      if (tr) this.layRoad(tr, 'track');
      return;
    }
    const ew = chance(0.5);
    const [a, b] = ew ? [this.edgePoint('w'), this.edgePoint('e')] : [this.edgePoint('n'), this.edgePoint('s')];
    const main = this.routeRoad(a[0], a[1], b[0], b[1]);
    if (main) this.layRoad(main, 'paved');
    const [c, d] = ew ? [this.edgePoint('n'), this.edgePoint('s')] : [this.edgePoint('w'), this.edgePoint('e')];
    const track = this.routeRoad(c[0], c[1], d[0], d[1]);
    if (track) this.layRoad(track, 'track');
  }

  footprintFree(cx, cy, w, h) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!this.inGrid(cx + i, cy + j)) return false;
      const t = this.ter[(cy + j) * GW + cx + i];
      if (t === TER.BUILDING || t === TER.ROAD || t === TER.PAVED || this.isWet((cy + j) * GW + cx + i)) return false;
    }
    return true;
  }

  placeBuilding(cx, cy, w, h) {
    if (!this.footprintFree(cx - 1, cy - 1, w + 2, h + 2)) return null;
    for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
      const c = (cy + j) * GW + cx + i;
      const inside = i >= 0 && j >= 0 && i < w && j < h;
      if (inside) this.ter[c] = TER.BUILDING;
      else if (this.ter[c] !== TER.WALL) this.ter[c] = TER.OPEN; // a cleared yard around the house
    }
    const b = { cx, cy, w, h, x0: cx * CELL, y0: cy * CELL, x1: (cx + w) * CELL, y1: (cy + h) * CELL, height: randRange(4.5, 8) };
    this.buildings.push(b);
    return b;
  }

  yardWall(b) {
    const m = 2, x0 = b.cx - m, y0 = b.cy - m, x1 = b.cx + b.w + m - 1, y1 = b.cy + b.h + m - 1;
    const gate = randInt(0, 3);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!this.inGrid(cx, cy)) continue;
      const edge = cx === x0 || cx === x1 || cy === y0 || cy === y1;
      if (!edge) continue;
      const gx = b.cx + Math.floor(b.w / 2), gy = b.cy + Math.floor(b.h / 2);
      if ((gate === 0 && cy === y0 && Math.abs(cx - gx) <= 0) || (gate === 1 && cy === y1 && Math.abs(cx - gx) <= 0) ||
          (gate === 2 && cx === x0 && Math.abs(cy - gy) <= 0) || (gate === 3 && cx === x1 && Math.abs(cy - gy) <= 0)) continue;
      const i = cy * GW + cx, k = this.ter[i];
      if (k !== TER.ROAD && k !== TER.PAVED && k !== TER.BUILDING && !this.isWet(i)) this.ter[i] = TER.WALL;
    }
  }

  // A farm's name in the region's fashion: "Ashby Farm", "Ferme de Crion", "Phu Loc (2)".
  farmName() {
    const R = this.R, w = Array.isArray(R.farmWord) ? pick(R.farmWord) : R.farmWord;
    return R.farmPrefix ? R.farmPrefix + this.placeName() : this.placeName() + ' ' + w;
  }

  placeName() {
    const R = this.R, one = () => R.whole && (!R.nameA || chance(0.35)) ? pick(R.whole) : pick(R.nameA) + pick(R.nameB);
    for (let i = 0; i < 30; i++) {
      const n = one();
      if (!this.places.some(p => p.name.startsWith(n))) return n;
    }
    return one();
  }

  // Villages strung along the roads, houses facing the road with yards and walls.
  genVillages() {
    const along = this.roads.flatMap(r => r.cells.map(c => ({ c, kind: r.kind })));
    // About one village per 1 km square on a small sheet; the region's count on a 3 km sheet.
    const want = Math.max(1, Math.round(randInt(this.R.villages[0], this.R.villages[1]) * Math.max(0.34, MAP_K)));
    const edge = Math.max(120, 250 * MAP_K), apart = Math.max(350, 800 * MAP_K);
    for (let tries = 0; tries < 60 && this.places.length < want; tries++) {
      const pick0 = along[randInt(0, along.length - 1)];
      if (!pick0) break;
      const vx = (pick0.c % GW + 0.5) * CELL, vy = (Math.floor(pick0.c / GW) + 0.5) * CELL;
      if (vx < edge || vy < edge || vx > MAP_W - edge || vy > MAP_H - edge) continue;
      if (this.places.some(p => dist(p.x, p.y, vx, vy) < apart)) continue;
      const near = along.filter(a => dist((a.c % GW + 0.5) * CELL, (Math.floor(a.c / GW) + 0.5) * CELL, vx, vy) < 160);
      let built = 0;
      for (let k = 0; k < 80 && built < randInt(9, 18); k++) {
        const a = pick(near), ax = a.c % GW, ay = Math.floor(a.c / GW);
        const w = randInt(2, 4), h = randInt(2, 3), side = chance(0.5) ? 1 : -1, off = randInt(2, 4);
        const horiz = chance(0.5);
        const cx = horiz ? ax - Math.floor(w / 2) : ax + (side > 0 ? off : -off - w);
        const cy = horiz ? ay + (side > 0 ? off : -off - h) : ay - Math.floor(h / 2);
        const b = this.placeBuilding(cx, cy, w, h);
        if (!b) continue;
        built++;
        if (chance(this.R.yardWalls[0])) this.yardWall(b);
      }
      if (built >= 5) this.places.push({ name: this.placeName(), x: vx, y: vy, kind: 'village' });
    }
  }

  // Outlying farms, each with a track to the nearest road.
  genFarms() {
    const roadCells = this.roads.flatMap(r => r.cells);
    const want = Math.max(1, Math.round(randInt(this.R.farms[0], this.R.farms[1]) * Math.max(0.3, MAP_K)));
    const gv = Math.max(220, 450 * MAP_K), gf = Math.max(180, 350 * MAP_K), m0 = Math.max(80, 150 * MAP_K);
    let made = 0;
    for (let tries = 0; tries < 80 && made < want; tries++) {
      const x = randRange(m0, MAP_W - m0), y = randRange(m0, MAP_H - m0);
      if (this.places.some(p => dist(p.x, p.y, x, y) < (p.kind === 'village' ? gv : gf))) continue;
      const c = this.cellOf(x, y);
      if (TERRAIN[this.ter[c.cy * GW + c.cx]].speed === 0 || this.ter[c.cy * GW + c.cx] === TER.WOODS) continue;
      const b = this.placeBuilding(c.cx, c.cy, randInt(3, 5), randInt(2, 3));
      if (!b) continue;
      for (let k = 0; k < randInt(0, 2); k++) this.placeBuilding(c.cx + randInt(-6, 6), c.cy + randInt(4, 7) * (chance(0.5) ? 1 : -1), randInt(2, 3), 2);
      if (chance(this.R.yardWalls[1])) this.yardWall(b);
      made++;
      this.places.push({ name: this.farmName(), x: b.x1 + 6, y: b.y0, kind: 'farm' });
      // Track to the nearest road cell.
      let best = -1, bd = Infinity;
      for (let i = 0; i < roadCells.length; i += 3) {
        const rc = roadCells[i], d = (rc % GW - c.cx) ** 2 + (Math.floor(rc / GW) - c.cy) ** 2;
        if (d < bd) { bd = d; best = rc; }
      }
      const sx = c.cx + Math.floor(b.w / 2), sy = c.cy + b.h + 1;
      if (best >= 0 && this.inGrid(sx, sy)) {
        const path = this.routeRoad(sx, sy, best % GW, Math.floor(best / GW));
        if (path && path.length > 2) this.layRoad(path, 'track');
      }
    }
  }

  // Hilltops for spot elevations and the sheet name; index contour label sites.
  findPeaks() {
    const R = Math.round(50 * Math.max(0.6, MAP_K)), peaks = [];
    for (let cy = R; cy < GH - R; cy += 5) for (let cx = R; cx < GW - R; cx += 5) {
      const e = this.elev[cy * GW + cx];
      let top = true;
      for (let j = -R; j <= R && top; j += 5) for (let i = -R; i <= R; i += 5) {
        if ((i || j) && this.elev[(cy + j) * GW + cx + i] > e) { top = false; break; }
      }
      if (top && this.ter[cy * GW + cx] !== TER.OCEAN) peaks.push({ x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL, e });
    }
    peaks.sort((a, b) => b.e - a.e);
    this.peaks = [];
    const pk = Math.max(180, 350 * MAP_K);
    for (const p of peaks) if (!this.peaks.some(q => dist(p.x, p.y, q.x, q.y) < pk)) this.peaks.push(p);
    this.peak = this.peaks.length ? Math.round(this.elevBase + this.peaks[0].e) : this.elevBase;
    this.contourLabels = [];
    for (let y = 60; y < MAP_H - 60; y += 24) for (let x = 60; x < MAP_W - 60; x += 24) {
      const step = this.ci * this.index, e = this.elevAt(x, y), lv = Math.round(e / step) * step;
      if (lv <= 0 || Math.abs(e - lv) > 0.3) continue;
      if (this.contourLabels.some(l => dist(l.x, l.y, x, y) < Math.max(200, 380 * MAP_K))) continue;
      const k = this.terAt(x, y);
      if (k === TER.BUILDING || k === TER.PAVED || k === TER.ROAD) continue;
      this.contourLabels.push({ x, y, v: lv });
    }
  }

  // ---------------------------------------------------------------- line of sight
  // Returns how much of the line is unobstructed, 0 (blocked) to 1 (clear).
  // za and zb are heights above the ground at each end.
  los(ax, ay, za, bx, by, zb) {
    const d = dist(ax, ay, bx, by);
    if (d < 0.75) return 1;
    const ga = this.elevAt(ax, ay) + za, gb = this.elevAt(bx, by) + zb;
    const n = Math.ceil(d / 1.6);
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
        const w = fromA < CELL * 0.75 ? 0.25 : fromB < CELL * 0.75 ? 0.5 : 1;
        dens += T.density * CELL * w;
        if (dens >= 1) return 0;
      }
    }
    return 1 - dens;
  }

  // ---------------------------------------------------------------- pathfinding
  nearestPassable(cx, cy) {
    cx = clamp(cx, 0, GW - 1); cy = clamp(cy, 0, GH - 1);
    if (this.passableCell(cx, cy) && this.ter[cy * GW + cx] !== TER.WALL) return { cx, cy };
    for (let r = 1; r < 16; r++) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = cx + i, y = cy + j;
        if (this.passableCell(x, y) && this.ter[y * GW + x] !== TER.WALL) return { cx: x, cy: y };
      }
    }
    return { cx, cy };
  }

  straightWalkable(ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by), n = Math.ceil(d / 1.2);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const k = this.terAt(x, y);
      if (k === TER.BUILDING || k === TER.WALL || k === TER.POND) return false;
      // Keep clear of building corners so men do not clip through them.
      if (this.terAt(x + 1, y) === TER.BUILDING || this.terAt(x - 1, y) === TER.BUILDING ||
          this.terAt(x, y + 1) === TER.BUILDING || this.terAt(x, y - 1) === TER.BUILDING) return false;
    }
    return true;
  }

  // A* over the grid; cost is travel time. Long routes use a weighted heuristic,
  // which finds a good route much faster than the strictly shortest one.
  findPath(sx, sy, tx, ty) {
    tx = clamp(tx, 1, MAP_W - 1); ty = clamp(ty, 1, MAP_H - 1);
    const s = this.cellOf(sx, sy), t0 = this.cellOf(tx, ty);
    const t = this.nearestPassable(t0.cx, t0.cy);
    const exact = t.cx === t0.cx && t.cy === t0.cy;
    const goal = exact ? { x: tx, y: ty } : { x: (t.cx + 0.5) * CELL, y: (t.cy + 0.5) * CELL };
    if (s.cx === t.cx && s.cy === t.cy) return [goal];
    const straight = dist(sx, sy, goal.x, goal.y);
    if (straight < 60 && this.straightWalkable(sx, sy, goal.x, goal.y)) return [goal];

    const N = GW * GH, start = s.cy * GW + s.cx, end = t.cy * GW + t.cx;
    const g = this._g || (this._g = new Float32Array(N));
    const came = this._came || (this._came = new Int32Array(N));
    const closed = this._closed || (this._closed = new Uint8Array(N));
    g.fill(Infinity); came.fill(-1); closed.fill(0);
    const heap = new MinHeap();
    const wgt = straight > 150 ? 1.6 : 1;
    const h = (i) => {
      const dx = Math.abs((i % GW) - t.cx), dy = Math.abs(Math.floor(i / GW) - t.cy);
      return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * CELL / 1.2 * wgt;
    };
    g[start] = 0;
    heap.push(start, h(start));
    let found = false, expanded = 0;
    while (heap.size && expanded < 600000) {
      const cur = heap.pop();
      if (cur === end) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1; expanded++;
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
      let j = Math.min(cells.length - 1, i + 25);
      while (j > i + 1 && !this.straightWalkable(ax, ay, cells[j].x, cells[j].y)) j--;
      out.push(cells[j]);
      ax = cells[j].x; ay = cells[j].y; i = j;
    }
    if (!out.length) out.push(goal);
    return out;
  }

  // A route for a man keeping station on a leader's route: the leader's waypoints
  // shifted by his formation offset, with short detours where the shifted line is blocked.
  offsetPath(sx, sy, lead, ox, oy) {
    const pts = [];
    let px = sx, py = sy;
    for (let k = 0; k < lead.length; k++) {
      const prev = k ? lead[k - 1] : null, cur = lead[k];
      const h = prev ? angleTo(prev.x, prev.y, cur.x, cur.y) : angleTo(sx - ox, sy - oy, cur.x, cur.y);
      const w = rotateOffset(ox, oy, h);
      const c = this.nearestPassable(Math.floor((cur.x + w.x) / CELL), Math.floor((cur.y + w.y) / CELL));
      const q = k === lead.length - 1 && TERRAIN[this.terAt(cur.x + w.x, cur.y + w.y)].speed > 0 && this.terAt(cur.x + w.x, cur.y + w.y) !== TER.WALL
        ? { x: cur.x + w.x, y: cur.y + w.y } : { x: (c.cx + 0.5) * CELL, y: (c.cy + 0.5) * CELL };
      if (this.straightWalkable(px, py, q.x, q.y)) pts.push(q);
      else { const d = this.findPath(px, py, q.x, q.y); if (d) pts.push(...d); else pts.push(q); }
      px = q.x; py = q.y;
    }
    return pts;
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
      const k1 = this.terAt(px + ca * CELL * 0.9, py + sa * CELL * 0.9), k2 = this.terAt(px + ca * CELL * 1.7, py + sa * CELL * 1.7);
      let score = 0, posture = 'prone';
      if (k1 === TER.WALL || k2 === TER.WALL) { score += 6; posture = 'kneel'; }
      else if (k1 === TER.BUILDING || k2 === TER.BUILDING) { score += 3.5; posture = 'kneel'; }
      if (k === TER.WOODS) score += 2.5;
      else if (k === TER.GRASS || k === TER.VINEYARD) score += 1.2;
      else if (k === TER.ORCHARD) score += 0.8;
      else if (k === TER.STREAM) score += 1.6; // the gully
      else if (k === TER.SWAMP) score += 1.0;  // reeds
      // Defilade: ground rising toward the threat.
      if (this.elevAt(px + ca * 6, py + sa * 6) - this.elevAt(px, py) > 0.45) score += 1.5;
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

// Douglas-Peucker line simplification.
function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], len = Math.max(1e-6, dist(a.x, a.y, b.x, b.y));
  let worst = 0, wi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
    if (d > worst) { worst = d; wi = i; }
  }
  if (worst <= tol) return [a, b];
  return simplifyLine(pts.slice(0, wi + 1), tol).slice(0, -1).concat(simplifyLine(pts.slice(wi), tol));
}

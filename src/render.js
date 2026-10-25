'use strict';
// Drawing: a printed military map sheet on a planning table, with game pieces and
// overlay graphics on top. The sheet is drawn at three levels of detail: the whole
// sheet with its margin, then tiles of 600 m and 200 m drawn on demand as you zoom in.

const R = {
  canvas: null, ctx: null, w: 0, h: 0, dpr: 1, cam: { x: MAP_W / 2, y: MAP_H / 2, zoom: 1 },
  sheet: null, tiles: new Map(), queue: [], minZoom: 0.1, table: null, grain: null,
};
// Collar (margin) around the map body, in meters, holding the marginal information. It
// is laid out for a 3 km sheet and scaled with the sheet, so it prints the same size.
const SHEET = { ml: 170, mr: 170, mt: 200, mb: 480 };
let SHEET_W = 0, SHEET_H = 0, SHEET_PPM = 0.55; // whole-sheet pixels per meter
function sizeSheet() {
  Object.assign(SHEET, { ml: 170 * MAP_K, mr: 170 * MAP_K, mt: 200 * MAP_K, mb: 480 * MAP_K });
  SHEET_W = MAP_W + SHEET.ml + SHEET.mr; SHEET_H = MAP_H + SHEET.mt + SHEET.mb;
  SHEET_PPM = Math.min(1.6, 0.55 / MAP_K);
}
sizeSheet();
// Grid lines every kilometer; on a one-square sheet, fainter lines every 100 m inside it.
const gridStep = () => MAP_W <= 1000 ? 100 : 1000;
const LEVELS = [null, { ppm: 1.4, size: 600, label: 11 }, { ppm: 4, size: 200, label: 12 }];
const TILE_CACHE = 28;

function initRender(canvas) {
  R.canvas = canvas;
  R.ctx = canvas.getContext('2d');
  resizeView();
  window.addEventListener('resize', resizeView);
}
// A new sheet size: margins, the zoom that fits the sheet, and the camera.
function resizeSheet() { sizeSheet(); if (R.canvas) resizeView(); }

function resizeView() {
  const c = R.canvas;
  R.dpr = Math.min(window.devicePixelRatio || 1, 2);
  R.w = c.clientWidth; R.h = c.clientHeight;
  c.width = Math.round(R.w * R.dpr); c.height = Math.round(R.h * R.dpr);
  R.minZoom = Math.min(R.w / SHEET_W, (R.h - 52 - (G.ui.panelH || 150)) / SHEET_H) * 0.95;
  clampCam();
}

// Any edge of the map can be pulled in to about a quarter of the screen from the far side,
// clear of the roster, the order panel and the orders bar. Zoomed far out, the whole
// sheet with its margins stays reachable.
function clampCam() {
  const c = R.cam;
  c.zoom = clamp(c.zoom, R.minZoom, 16);
  const px = 0.22 * R.w / c.zoom, py = 0.22 * R.h / c.zoom;
  // The sheet's collar (legend, scale) is reachable too: its outer edge can come to the center.
  c.x = clamp(c.x, Math.min(-px, -SHEET.ml, MAP_W / 2 - R.w / 2 / c.zoom), Math.max(MAP_W + px, MAP_W + SHEET.mr, MAP_W / 2 + R.w / 2 / c.zoom));
  c.y = clamp(c.y, Math.min(-py, -SHEET.mt, MAP_H / 2 - R.h / 2 / c.zoom), Math.max(MAP_H + py, MAP_H + SHEET.mb, MAP_H / 2 + R.h / 2 / c.zoom));
}

function fitCamera(focus, zoom) {
  R.cam.zoom = zoom || Math.max(R.minZoom, R.w / 1100);
  R.cam.x = focus ? focus.x : MAP_W / 2;
  R.cam.y = focus ? focus.y - 60 / R.cam.zoom : MAP_H / 2;
  clampCam();
}

function toScreen(x, y) {
  const z = R.cam.zoom;
  return { x: R.w / 2 + (x - R.cam.x) * z, y: R.h / 2 + (y - R.cam.y) * z };
}
function toWorld(sx, sy) {
  const z = R.cam.zoom;
  return { x: R.cam.x + (sx - R.w / 2) / z, y: R.cam.y + (sy - R.h / 2) / z };
}

// ---------------------------------------------------------------- map colors
// Standard colors of US military topographic maps (FM 3-25.26): black for man-made
// features and the grid, red-brown for contours and elevations, blue for water,
// green for vegetation, red for main roads. Contours every 5 m, index every 25 m.
const MAPC = {
  paper: [247, 245, 236],
  plowed: [243, 239, 226],
  grass: [226, 239, 204],
  woods: [190, 220, 164],
  woodsEdge: [132, 176, 108],
  orchard: [214, 233, 194],
  vineyard: [218, 234, 198],
  swamp: [226, 238, 236],
  beach: [246, 236, 202],
  chaparral: [212, 228, 188],
  brush: [214, 224, 184],
  desert: [247, 240, 222],
  rock: [228, 220, 206],
  snow: [241, 245, 249],
  ice: [222, 238, 248],
  wash: [242, 232, 206],
  water: [176, 220, 244],
  waterEdge: [40, 140, 205],
  contour: [168, 84, 50],
};
const MAP_INK = '#161616', BLUE_LINE = 'rgb(40,140,205)', RED_BROWN = 'rgb(168,84,50)';
const CLASS_COLORS = {
  [TER.WOODS]: MAPC.woods, [TER.GRASS]: MAPC.grass, [TER.PLOWED]: MAPC.plowed, [TER.ORCHARD]: MAPC.orchard,
  [TER.VINEYARD]: MAPC.vineyard, [TER.POND]: MAPC.water, [TER.SWAMP]: MAPC.swamp, [TER.BEACH]: MAPC.beach,
  [TER.CHAPARRAL]: MAPC.chaparral, [TER.BRUSH]: MAPC.brush, [TER.DESERT]: MAPC.desert, [TER.ROCK]: MAPC.rock,
  [TER.SNOW]: MAPC.snow, [TER.ICE]: MAPC.ice, [TER.WASH]: MAPC.wash,
};
const CLASS_COLOR = (k) => CLASS_COLORS[k] || MAPC.paper;
// Ground that draws as a tinted area; river, ford and sea water draw like a pond.
const AREA_CLASS = new Uint8Array(32);
for (const k of Object.keys(CLASS_COLORS)) AREA_CLASS[k] = +k;
AREA_CLASS[TER.RIVER] = AREA_CLASS[TER.FORD] = AREA_CLASS[TER.OCEAN] = TER.POND;

// Ground class at a point: the class with the most weight among the four nearest
// cells, which gives smooth edges to woods, fields and water at any zoom.
function groundClass(map, x, y) {
  const fx = clamp(x / CELL - 0.5, 0, GW - 1.001), fy = clamp(y / CELL - 0.5, 0, GH - 1.001);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * GW + x0;
  const cls = (k) => AREA_CLASS[k];
  const a = cls(map.ter[i]), b = cls(map.ter[i + 1]), c = cls(map.ter[i + GW]), d = cls(map.ter[i + GW + 1]);
  if (a === b && b === c && c === d) return a;
  const w = new Map();
  w.set(a, (w.get(a) || 0) + (1 - tx) * (1 - ty)); w.set(b, (w.get(b) || 0) + tx * (1 - ty));
  w.set(c, (w.get(c) || 0) + (1 - tx) * ty); w.set(d, (w.get(d) || 0) + tx * ty);
  let best = 0, bw = -1;
  for (const [k, v] of w) if (v > bw) { bw = v; best = k; }
  return best;
}

// Wall cells joined into chains, then simplified so diagonal walls draw straight.
function wallLines(map) {
  if (map._walls) return map._walls;
  const isWall = (cx, cy) => map.inGrid(cx, cy) && map.ter[cy * GW + cx] === TER.WALL;
  const nbrs = (cx, cy) => {
    const out = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && isWall(cx + i, cy + j)) out.push([cx + i, cy + j]);
    return out;
  };
  const seen = new Set(), key = (cx, cy) => cy * GW + cx, lines = [];
  const trace = (cx, cy) => {
    const pts = [[cx, cy]];
    seen.add(key(cx, cy));
    for (;;) {
      const [x, y] = pts[pts.length - 1];
      const next = nbrs(x, y).filter(([a, b]) => !seen.has(key(a, b)))
        .sort((p, q) => (Math.abs(p[0] - x) + Math.abs(p[1] - y)) - (Math.abs(q[0] - x) + Math.abs(q[1] - y)))[0];
      if (!next) break;
      seen.add(key(next[0], next[1]));
      pts.push(next);
    }
    return pts.map(([x, y]) => ({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL }));
  };
  for (const pass of [1, 0]) {
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      if (!isWall(cx, cy) || seen.has(key(cx, cy))) continue;
      if (pass && nbrs(cx, cy).length > 1) continue;
      const pts = trace(cx, cy);
      lines.push(pts.length > 1 ? simplifyLine(pts, 4.4) : [{ x: pts[0].x - 1.2, y: pts[0].y }, { x: pts[0].x + 1.2, y: pts[0].y }]);
    }
  }
  map._walls = lines;
  return lines;
}

// ---------------------------------------------------------------- drawing a piece of the map
// Draws the map body for the region (x0, y0, w, h meters) into ctx at ppm pixels per meter.
// level 0 is the whole sheet; 1 and 2 are the closer tiles and carry more detail.
function drawMapRegion(ctx, map, x0, y0, w, h, ppm, level) {
  const W = Math.ceil(w * ppm), H = Math.ceil(h * ppm);
  const img = ctx.createImageData(W, H), px = img.data;
  const elev = new Float32Array((W + 2) * (H + 2)), cls = new Uint8Array(W * H);
  for (let y = 0; y < H + 2; y++) for (let x = 0; x < W + 2; x++) elev[y * (W + 2) + x] = map.elevAt(x0 + (x - 0.5) / ppm, y0 + (y - 0.5) / ppm);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cls[y * W + x] = groundClass(map, x0 + (x + 0.5) / ppm, y0 + (y + 0.5) / ppm);
  const ci = map.ci, ii = map.ci * map.index;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, k = cls[i];
      let col = CLASS_COLOR(k);
      // Outline woods and water where they meet other ground.
      if (k === TER.WOODS || k === TER.POND || k === TER.ICE) {
        const edge = (x > 0 && cls[i - 1] !== k) || (x < W - 1 && cls[i + 1] !== k) || (y > 0 && cls[i - W] !== k) || (y < H - 1 && cls[i + W] !== k);
        if (edge && (k !== TER.WOODS || level > 0)) col = k === TER.WOODS ? MAPC.woodsEdge : MAPC.waterEdge;
      }
      let [r, g, b] = col;
      if (k !== TER.POND && k !== TER.ICE) {
        const e = elev[(y + 1) * (W + 2) + x + 1], er = elev[(y + 1) * (W + 2) + x + 2], ed = elev[(y + 2) * (W + 2) + x + 1];
        // Relief shading; flat ground keeps its printed color.
        const shade = map.shadeAt(x0 + (x + 0.5) / ppm, y0 + (y + 0.5) / ppm);
        r *= shade; g *= shade; b *= shade;
        const onIndex = Math.floor(e / ii) !== Math.floor(er / ii) || Math.floor(e / ii) !== Math.floor(ed / ii);
        const onLine = Math.floor(e / ci) !== Math.floor(er / ci) || Math.floor(e / ci) !== Math.floor(ed / ci);
        if (onIndex || onLine) {
          const a = onIndex ? 1 : level === 0 ? 0.45 : 0.7;
          r = r * (1 - a) + MAPC.contour[0] * a; g = g * (1 - a) + MAPC.contour[1] * a; b = b * (1 - a) + MAPC.contour[2] * a;
        }
        // Heavier index contours on close tiles.
        if (level === 2 && !onIndex) {
          const el = elev[(y + 1) * (W + 2) + x], eu = elev[y * (W + 2) + x + 1];
          if (Math.floor(e / ii) !== Math.floor(el / ii) || Math.floor(e / ii) !== Math.floor(eu / ii)) {
            r = r * 0.15 + MAPC.contour[0] * 0.85; g = g * 0.15 + MAPC.contour[1] * 0.85; b = b * 0.15 + MAPC.contour[2] * 0.85;
          }
        }
      }
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.setTransform(ppm, 0, 0, ppm, -x0 * ppm, -y0 * ppm);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pxm = 1 / ppm; // one pixel in meters
  const inBox = (x, y, m) => x > x0 - m && x < x0 + w + m && y > y0 - m && y < y0 + h + m;
  const lineIn = (pts, m) => pts.some(p => inBox(p.x, p.y, m + 200));
  const stroke = (pts) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); };

  // Vegetation symbols on close tiles: orchard trees in rows, vine rows, grass tufts.
  if (level > 0) {
    const c0 = map.cellOf(x0, y0), c1 = map.cellOf(x0 + w, y0 + h);
    const step = level === 2 ? 2 : 4;
    ctx.lineWidth = Math.max(0.25, 0.8 * pxm);
    for (let cy = c0.cy; cy <= c1.cy; cy += step) for (let cx = c0.cx; cx <= c1.cx; cx += step) {
      const k = map.ter[cy * GW + cx], x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
      if (k === TER.ORCHARD) {
        ctx.strokeStyle = '#4f8a3a';
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, 2.2 * pxm), 0, Math.PI * 2); ctx.stroke();
      } else if (k === TER.VINEYARD) {
        ctx.strokeStyle = '#4f8a3a';
        ctx.beginPath(); ctx.moveTo(x - CELL * step * 0.35, y); ctx.lineTo(x + CELL * step * 0.35, y); ctx.stroke();
      } else if (k === TER.SWAMP && (cx * 5 + cy * 3) % 3 === 0) {
        // Marsh: a short blue dash with tufts rising from it.
        ctx.strokeStyle = BLUE_LINE;
        const s = level === 2 ? 1.6 : 3.2;
        ctx.beginPath();
        ctx.moveTo(x - s * 1.4, y); ctx.lineTo(x + s * 1.4, y);
        ctx.moveTo(x, y); ctx.lineTo(x, y - s);
        ctx.moveTo(x - s * 0.7, y); ctx.lineTo(x - s * 0.9, y - s * 0.7);
        ctx.moveTo(x + s * 0.7, y); ctx.lineTo(x + s * 0.9, y - s * 0.7);
        ctx.stroke();
      } else if ((k === TER.CHAPARRAL || k === TER.BRUSH) && (cx * 3 + cy * 7) % (k === TER.CHAPARRAL ? 2 : 3) === 0) {
        // Scrub: small green dots in clumps.
        ctx.fillStyle = '#4f8a3a';
        const s = level === 2 ? 0.9 : 1.8, o = ((cx * 13 + cy * 5) % 5 - 2) * 0.6;
        ctx.beginPath(); ctx.arc(x + o, y, s, 0, Math.PI * 2); ctx.arc(x + o + s * 2.2, y + s, s * 0.8, 0, Math.PI * 2); ctx.fill();
      } else if (k === TER.DESERT && (cx * 7 + cy * 3) % 9 === 0) {
        // Sparse creosote: a single small green dot.
        ctx.fillStyle = '#6f9a52';
        ctx.beginPath(); ctx.arc(x + ((cy * 7) % 5 - 2), y, level === 2 ? 0.7 : 1.4, 0, Math.PI * 2); ctx.fill();
      } else if (k === TER.ROCK && (cx + cy * 3) % 2 === 0) {
        // Rock: small brown angular marks.
        ctx.fillStyle = '#7a5a3c';
        const s = level === 2 ? 1.1 : 2.2;
        ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.6); ctx.lineTo(x, y - s * 0.8); ctx.lineTo(x + s, y + s * 0.6); ctx.closePath(); ctx.fill();
      } else if ((k === TER.BEACH || k === TER.WASH) && (cx * 5 + cy * 11) % 3 === 0) {
        // Sand: brown stipple.
        ctx.fillStyle = '#a07a4a';
        ctx.beginPath(); ctx.arc(x + ((cx * 3) % 3 - 1), y + ((cy * 5) % 3 - 1), level === 2 ? 0.45 : 0.9, 0, Math.PI * 2); ctx.fill();
      } else if (k === TER.GRASS && level === 2 && (cx * 7 + cy * 13) % 5 === 0) {
        ctx.strokeStyle = '#6f9a52';
        const s = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - s, y - s); ctx.lineTo(x, y); ctx.lineTo(x + s, y - s);
        ctx.moveTo(x - s * 1.4, y); ctx.lineTo(x + s * 1.4, y);
        ctx.stroke();
      }
    }
  }

  // Streams: blue lines, wider downstream.
  ctx.strokeStyle = BLUE_LINE;
  for (const s of map.streams) {
    if (!lineIn(s.pts, 0)) continue;
    ctx.lineWidth = Math.max(s.width, 1.3 * pxm);
    // An intermittent stream (dry wash): blue dashes and dots.
    if (s.dry) ctx.setLineDash([14, 5, 2, 5]);
    stroke(s.pts);
    ctx.setLineDash([]);
  }
  // The sea's name, along the coast.
  if (map.R.coast && x0 < 600) {
    const fs = (level === 0 ? 34 : 22) / ppm;
    for (const yy of [800, 2200]) {
      if (!inBox(110, yy, 600)) continue;
      ctx.save(); ctx.translate(map.coastAt(yy / MAP_H) / 2, yy); ctx.rotate(-Math.PI / 2);
      ctx.font = 'italic 700 ' + fs + 'px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = BLUE_LINE;
      ctx.fillText('P A C I F I C   O C E A N', 0, 0);
      ctx.restore();
    }
  }

  // River: a smooth band over the cell fill, blue banks and water tint between them.
  if (map.river && lineIn(map.river.pts, map.river.width)) {
    const rv = map.river;
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = BLUE_LINE; ctx.lineWidth = rv.width + 2.4 * pxm; stroke(rv.pts);
    ctx.strokeStyle = 'rgb(' + MAPC.water.join(',') + ')'; ctx.lineWidth = rv.width; stroke(rv.pts);
    ctx.restore();
  }

  // Roads: the paved road red with black casing; dirt tracks a dashed black double line.
  for (const r of map.roads) {
    if (!lineIn(r.pts, 0)) continue;
    if (r.kind === 'paved') {
      ctx.strokeStyle = MAP_INK; ctx.lineWidth = Math.max(9, 4.2 * pxm); stroke(r.pts);
      ctx.strokeStyle = '#d0362a'; ctx.lineWidth = Math.max(6.4, 2.4 * pxm); stroke(r.pts);
    } else {
      ctx.strokeStyle = MAP_INK; ctx.lineWidth = Math.max(6, 3.4 * pxm);
      ctx.setLineDash([Math.max(8, 6 * pxm), Math.max(4, 3 * pxm)]); stroke(r.pts); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgb(' + MAPC.paper.join(',') + ')'; ctx.lineWidth = Math.max(4.4, 1.8 * pxm); stroke(r.pts);
    }
  }

  // River: bridges (two black lines with flared ends along the road), fords, and the name.
  const rv = map.river;
  if (rv) {
    ctx.strokeStyle = MAP_INK; ctx.lineWidth = Math.max(1.2, 1.4 * pxm);
    for (const b of rv.bridges) {
      if (!inBox(b.x, b.y, 60)) continue;
      const ca = Math.cos(b.a), sa = Math.sin(b.a), nx = -sa, ny = ca;
      const half = b.len / 2 + 3, off = (b.kind === 'paved' ? 6 : 4.5);
      for (const sgn of [-1, 1]) {
        const ox = nx * off * sgn, oy = ny * off * sgn;
        ctx.beginPath();
        ctx.moveTo(b.x - ca * half + ox + nx * 2.5 * sgn - ca * 2.5, b.y - sa * half + oy + ny * 2.5 * sgn - sa * 2.5);
        ctx.lineTo(b.x - ca * half + ox, b.y - sa * half + oy);
        ctx.lineTo(b.x + ca * half + ox, b.y + sa * half + oy);
        ctx.lineTo(b.x + ca * half + ox + nx * 2.5 * sgn + ca * 2.5, b.y + sa * half + oy + ny * 2.5 * sgn + sa * 2.5);
        ctx.stroke();
      }
    }
    const fs0 = (level === 0 ? 10 : LEVELS[level].label) / ppm;
    for (const f of rv.fords) {
      if (!inBox(f.x, f.y, 80)) continue;
      ctx.font = 'italic 700 ' + fs0 + 'px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs0 * 0.3; ctx.strokeStyle = 'rgba(247,245,236,0.95)'; ctx.strokeText('FORD', f.x + rv.width, f.y);
      ctx.fillStyle = BLUE_LINE; ctx.fillText('FORD', f.x + rv.width, f.y);
      ctx.strokeStyle = BLUE_LINE; ctx.lineWidth = Math.max(0.8, 1 * pxm); ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.arc(f.x, f.y, 10, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    // The river's name along a long straight reach.
    let best = null, bl = 0;
    for (let k = 1; k < rv.pts.length; k++) { const a = rv.pts[k - 1], b = rv.pts[k], L = dist(a.x, a.y, b.x, b.y); if (L > bl) { bl = L; best = [a, b]; } }
    if (best && inBox((best[0].x + best[1].x) / 2, (best[0].y + best[1].y) / 2, 300)) {
      let ang = Math.atan2(best[1].y - best[0].y, best[1].x - best[0].x);
      if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      const mx = (best[0].x + best[1].x) / 2, my = (best[0].y + best[1].y) / 2, fs1 = fs0 * 1.3;
      ctx.save(); ctx.translate(mx - Math.sin(ang) * (rv.width / 2 + fs1), my + Math.cos(ang) * (rv.width / 2 + fs1)); ctx.rotate(ang);
      ctx.font = 'italic 700 ' + fs1 + 'px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs1 * 0.3; ctx.strokeStyle = 'rgba(247,245,236,0.95)'; ctx.strokeText(rv.name, 0, 0);
      ctx.fillStyle = BLUE_LINE; ctx.fillText(rv.name, 0, 0);
      ctx.restore();
    }
  }

  // Stone walls: black line, ticked on close tiles.
  ctx.strokeStyle = MAP_INK;
  for (const line of wallLines(map)) {
    if (!lineIn(line, 0)) continue;
    ctx.lineWidth = Math.max(0.7, 1 * pxm);
    stroke(line);
    if (level !== 2) continue;
    ctx.lineWidth = Math.max(0.35, 0.7 * pxm);
    ctx.beginPath();
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], len = dist(a.x, a.y, b.x, b.y);
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      for (let d = 1; d < len; d += 2.4) {
        const tx = a.x + (b.x - a.x) * d / len, ty = a.y + (b.y - a.y) * d / len;
        ctx.moveTo(tx, ty); ctx.lineTo(tx + nx * 1.3, ty + ny * 1.3);
      }
    }
    ctx.stroke();
  }

  // Buildings: solid black.
  ctx.fillStyle = MAP_INK;
  for (const bd of map.buildings) {
    if (!inBox(bd.x0, bd.y0, 20)) continue;
    const m = Math.min(0.4, (bd.x1 - bd.x0) / 6);
    ctx.fillRect(bd.x0 + m, bd.y0 + m, Math.max(bd.x1 - bd.x0 - 2 * m, 1.5 * pxm), Math.max(bd.y1 - bd.y0 - 2 * m, 1.5 * pxm));
  }

  // Grid: 1 km squares; on a one-square sheet, finer 100 m lines.
  const gs = gridStep();
  ctx.strokeStyle = gs < 1000 ? 'rgba(10,10,10,0.45)' : 'rgba(10,10,10,0.85)'; ctx.lineWidth = Math.max(gs < 1000 ? 0.8 : 1.2, 0.9 * pxm);
  for (let x = gs; x < MAP_W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke(); }
  for (let n = gs; n < MAP_H; n += gs) { ctx.beginPath(); ctx.moveTo(0, MAP_H - n); ctx.lineTo(MAP_W, MAP_H - n); ctx.stroke(); }

  // Lettering: sized in screen pixels for each level, as each would be printed.
  const fs = (level === 0 ? 10 : LEVELS[level].label) * pxm;
  const halo = (text, x, y, color, size, font) => {
    ctx.font = font || '600 ' + size + 'px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.3; ctx.strokeStyle = 'rgba(247,245,236,0.95)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  };
  for (const l of map.contourLabels) if (inBox(l.x, l.y, 30)) halo(String(Math.round(map.elevBase + l.v)), l.x, l.y, RED_BROWN, fs);
  for (const p of map.peaks.slice(0, level === 0 ? 6 : 12)) {
    if (!inBox(p.x, p.y, 40)) continue;
    ctx.fillStyle = RED_BROWN;
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 * pxm, 0, Math.PI * 2); ctx.fill();
    halo(String(Math.round(map.elevBase + p.e)), p.x + fs * 1.6, p.y - fs * 0.8, RED_BROWN, fs);
  }
  for (const pl of map.places) {
    if (pl.kind === 'farm' && level === 0) continue;
    if (!inBox(pl.x, pl.y, 200)) continue;
    const size = pl.kind === 'village' ? fs * 1.45 : fs * 0.95;
    const font = (pl.kind === 'village' ? '700 ' : 'italic 600 ') + size + 'px "Saira Condensed", "Arial Narrow", sans-serif';
    halo(pl.kind === 'village' ? pl.name.toUpperCase() : pl.name, pl.x, pl.y - (pl.kind === 'village' ? 40 : 0), MAP_INK, size, font);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the printed sheet
// The whole sheet: map body at low detail inside a collar of marginal information
// (sheet name, grid values, legend, graphic scale, declination diagram).
function buildTerrain(map) {
  R.tiles.clear(); R.queue = [];
  const P = SHEET_PPM;
  const body = document.createElement('canvas');
  body.width = Math.ceil(MAP_W * P); body.height = Math.ceil(MAP_H * P);
  drawMapRegion(body.getContext('2d'), map, 0, 0, MAP_W, MAP_H, P, 0);

  const c = document.createElement('canvas');
  c.width = Math.ceil(SHEET_W * P); c.height = Math.ceil(SHEET_H * P);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(' + MAPC.paper.join(',') + ')';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(body, Math.round(SHEET.ml * P), Math.round(SHEET.mt * P));

  ctx.save();
  ctx.scale(P, P);
  ctx.translate(SHEET.ml, SHEET.mt);
  // The collar is laid out on a 3 km sheet (VW x VH) and scaled to this one.
  ctx.scale(MAP_K, MAP_K);
  const VW = MAP_W / MAP_K, VH = MAP_H / MAP_K, vk = 1 / MAP_K;
  const text = (t, x, y, size, opts) => {
    opts = opts || {};
    ctx.font = (opts.weight || 600) + ' ' + size + 'px ' + (opts.serif ? '"Saira Condensed", "Arial Narrow", sans-serif' : '"IBM Plex Mono", ui-monospace, monospace');
    ctx.fillStyle = opts.color || MAP_INK;
    ctx.textAlign = opts.align || 'left'; ctx.textBaseline = opts.base || 'alphabetic';
    ctx.fillText(t, x, y);
  };
  ctx.strokeStyle = MAP_INK; ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, VW, VH);

  // Grid values: small 100 km digit, large principal digits; full values at the corners.
  const gridLabel = (lead, v, x, y, align) => {
    const big = String(v).padStart(2, '0');
    ctx.font = '600 22px "IBM Plex Mono", monospace';
    const sw = ctx.measureText(String(lead)).width;
    ctx.font = '700 40px "IBM Plex Mono", monospace';
    const bw = ctx.measureText(big).width;
    const x0 = align === 'center' ? x - (sw + bw) / 2 : align === 'right' ? x - sw - bw : x;
    text(String(lead), x0, y - 16, 22);
    text(big, x0 + sw, y, 40, { weight: 700 });
  };
  for (let x = 0; x <= MAP_W; x += 1000) {
    const v = G.grid.e + x / 1000;
    gridLabel(G.grid.le, v, x * vk, -14, 'center');
    gridLabel(G.grid.le, v, x * vk, VH + 50, 'center');
  }
  for (let n = 0; n <= MAP_H; n += 1000) {
    const y = VH - n * vk, v = G.grid.n + n / 1000;
    gridLabel(G.grid.ln, v, -14, y + 14, 'right');
    gridLabel(G.grid.ln, v, VW + 14, y + 14, 'left');
  }
  // On a one-square sheet, the hundreds digit at each 100 m line.
  if (gridStep() < 1000) {
    for (let m = 100; m < MAP_W; m += 100) {
      const d = String(m / 100);
      text(d, m * vk, -18, 26, { align: 'center' }); text(d, m * vk, VH + 44, 26, { align: 'center' });
      text(d, -18, VH - m * vk + 9, 26, { align: 'right' }); text(d, VW + 18, VH - m * vk + 9, 26, { align: 'left' });
    }
  }
  text(G.grid.le + String(G.grid.e).padStart(2, '0') + '000mE.', 0, -64, 20, { weight: 600 });
  text(G.grid.ln + String(G.grid.n).padStart(2, '0') + '000mN.', -14, VH + 92, 20, { weight: 600, align: 'right' });
  // 100 m ticks along the neatline.
  ctx.lineWidth = 2;
  for (let m0 = 100; m0 < MAP_W; m0 += 100) {
    const m = m0 * vk;
    ctx.beginPath(); ctx.moveTo(m, 0); ctx.lineTo(m, -12); ctx.moveTo(m, VH); ctx.lineTo(m, VH + 12);
    ctx.moveTo(0, m); ctx.lineTo(-12, m); ctx.moveTo(VW, m); ctx.lineTo(VW + 12, m); ctx.stroke();
  }

  // Title block.
  text('STEX: RIFLE SQUAD', 0, -140, 34, { weight: 700 });
  text('SERIES T25 · EDITION 1 · ' + map.R.label.toUpperCase(), 0, -104, 22, { weight: 500 });
  text(('HILL ' + map.peak).toUpperCase(), VW / 2, -118, 76, { weight: 700, serif: true, align: 'center' });
  text('SHEET ' + String(G.settings ? G.settings.seed : 0).padStart(5, '0'), VW, -140, 34, { weight: 700, align: 'right' });
  text('1:25 000 · ' + MAP_W / 1000 + ' × ' + MAP_H / 1000 + ' KM', VW, -104, 22, { weight: 500, align: 'right' });

  // Legend, bottom left.
  const ly = VH + 160;
  text('LEGEND', 0, ly, 26, { weight: 700 });
  // Only what is on this sheet goes in the legend.
  const has = new Uint8Array(32);
  for (let i = 0; i < map.ter.length; i += 7) has[map.ter[i]] = 1;
  const ii = map.ci * map.index, wet = map.streams.some(s => !s.dry), dry = map.streams.some(s => s.dry);
  const rows = [
    ['woods', 'Woods, hedgerow', has[TER.WOODS]], ['grass', 'Tall grass', has[TER.GRASS]], ['orchard', 'Orchard', has[TER.ORCHARD]],
    ['vineyard', 'Vineyard', has[TER.VINEYARD]], ['chaparral', 'Chaparral', has[TER.CHAPARRAL]], ['brush', 'Mesquite brush', has[TER.BRUSH]],
    ['desert', 'Desert scrub', has[TER.DESERT]], ['rock', 'Rock outcrop, talus', has[TER.ROCK]], ['snow', 'Deep snow', has[TER.SNOW]],
    ['beach', 'Sand beach', has[TER.BEACH]],
    ['paved', 'Hard surface road', 1], ['road', 'Unimproved road', 1], ['wall', 'Stone wall', has[TER.WALL]], ['building', 'Building', 1],
    ['stream', 'Stream', wet], ['wash', 'Dry wash', dry], ['pond', map.R.ponds === 'ice' ? 'Frozen pond' : map.R.coast ? 'Pond, ocean' : 'Pond', has[TER.POND] || has[TER.ICE] || has[TER.OCEAN]],
    ['index', 'Index contour (' + ii + ' m)', 1], ['contour', 'Contour (' + map.ci + ' m)', 1],
    ['river', 'River, bridge, ford', !!map.river], ['swamp', 'Swamp, marsh', has[TER.SWAMP]],
  ].filter(r => r[2]);
  rows.forEach(([k, label], i) => {
    const col = Math.floor(i / 4), row = i % 4;
    const x = col * 560, y = ly + 50 + row * 56;
    ctx.save();
    const sw = (c) => { ctx.fillStyle = 'rgb(' + c.join(',') + ')'; ctx.fillRect(x, y - 16, 90, 32); };
    ctx.lineCap = 'round';
    if (k === 'woods') sw(MAPC.woods);
    else if (k === 'grass') sw(MAPC.grass);
    else if (k === 'chaparral' || k === 'brush' || k === 'desert') {
      sw(MAPC[k]); ctx.fillStyle = k === 'desert' ? '#6f9a52' : '#4f8a3a';
      const n = k === 'desert' ? 3 : 8;
      for (let t = 0; t < n; t++) { ctx.beginPath(); ctx.arc(x + 10 + t * (72 / Math.max(1, n - 1)), y + (t % 2 ? 6 : -6), 3, 0, Math.PI * 2); ctx.fill(); }
    }
    else if (k === 'rock') { sw(MAPC.rock); ctx.fillStyle = '#7a5a3c'; for (let t = 10; t < 90; t += 16) { ctx.beginPath(); ctx.moveTo(x + t - 5, y + 5 - (t % 3) * 3); ctx.lineTo(x + t, y - 6 - (t % 3) * 3); ctx.lineTo(x + t + 5, y + 5 - (t % 3) * 3); ctx.fill(); } }
    else if (k === 'snow') { sw(MAPC.snow); ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.strokeRect(x, y - 16, 90, 32); }
    else if (k === 'beach' || k === 'wash') {
      sw(MAPC[k]); ctx.fillStyle = '#a07a4a';
      for (let t = 0; t < 24; t++) { ctx.beginPath(); ctx.arc(x + 5 + (t * 37) % 80, y - 12 + (t * 23) % 24, 1.6, 0, Math.PI * 2); ctx.fill(); }
      if (k === 'wash') { ctx.strokeStyle = BLUE_LINE; ctx.lineWidth = 4; ctx.setLineDash([14, 5, 2, 5]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 90, y); ctx.stroke(); ctx.setLineDash([]); }
    }
    else if (k === 'orchard') { sw(MAPC.orchard); ctx.strokeStyle = '#4f8a3a'; ctx.lineWidth = 2; for (let t = 12; t < 90; t += 22) { ctx.beginPath(); ctx.arc(x + t, y, 5, 0, Math.PI * 2); ctx.stroke(); } }
    else if (k === 'vineyard') { sw(MAPC.vineyard); ctx.strokeStyle = '#4f8a3a'; ctx.lineWidth = 2; for (const dy of [-8, 0, 8]) { ctx.beginPath(); ctx.moveTo(x + 6, y + dy); ctx.lineTo(x + 84, y + dy); ctx.stroke(); } }
    else if (k === 'paved') { ctx.strokeStyle = MAP_INK; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 90, y); ctx.stroke(); ctx.strokeStyle = '#d0362a'; ctx.lineWidth = 10; ctx.stroke(); }
    else if (k === 'road') { ctx.strokeStyle = MAP_INK; ctx.lineWidth = 12; ctx.setLineDash([14, 7]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 90, y); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = 'rgb(' + MAPC.paper.join(',') + ')'; ctx.lineWidth = 7; ctx.stroke(); }
    else if (k === 'wall') { ctx.strokeStyle = MAP_INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 90, y); ctx.stroke(); ctx.lineWidth = 2; ctx.beginPath(); for (let t = 6; t < 90; t += 12) { ctx.moveTo(x + t, y); ctx.lineTo(x + t, y + 8); } ctx.stroke(); }
    else if (k === 'building') { ctx.fillStyle = MAP_INK; ctx.fillRect(x + 30, y - 14, 30, 28); }
    else if (k === 'stream') { ctx.strokeStyle = BLUE_LINE; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.bezierCurveTo(x + 30, y - 16, x + 60, y + 16, x + 90, y - 6); ctx.stroke(); }
    else if (k === 'river') {
      ctx.fillStyle = 'rgb(' + MAPC.water.join(',') + ')'; ctx.fillRect(x, y - 9, 90, 18);
      ctx.strokeStyle = BLUE_LINE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 90, y - 9); ctx.moveTo(x, y + 9); ctx.lineTo(x + 90, y + 9); ctx.stroke();
      ctx.strokeStyle = MAP_INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 36, y - 16); ctx.lineTo(x + 36, y + 16); ctx.moveTo(x + 54, y - 16); ctx.lineTo(x + 54, y + 16); ctx.stroke();
    }
    else if (k === 'swamp') {
      sw(MAPC.swamp); ctx.strokeStyle = BLUE_LINE; ctx.lineWidth = 2;
      for (const tx of [18, 45, 72]) { ctx.beginPath(); ctx.moveTo(tx - 10, y + 6); ctx.lineTo(tx + 10, y + 6); ctx.moveTo(tx, y + 6); ctx.lineTo(tx, y - 6); ctx.moveTo(tx - 5, y + 6); ctx.lineTo(tx - 7, y - 2); ctx.moveTo(tx + 5, y + 6); ctx.lineTo(tx + 7, y - 2); ctx.stroke(); }
    }
    else if (k === 'pond') { ctx.fillStyle = 'rgb(' + (map.R.ponds === 'ice' ? MAPC.ice : MAPC.water).join(',') + ')'; ctx.strokeStyle = BLUE_LINE; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x + 45, y, 40, 15, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    else if (k === 'index' || k === 'contour') { ctx.strokeStyle = RED_BROWN; ctx.lineWidth = k === 'index' ? 5 : 2.5; ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.bezierCurveTo(x + 30, y - 16, x + 60, y + 16, x + 90, y - 6); ctx.stroke(); }
    ctx.restore();
    text(label, x + 110, y + 9, 26, { weight: 500, serif: true });
  });

  // Graphic scale, bottom center.
  // A bar of real ground distance: 1000 m on a large sheet, less on a small one.
  const L = MAP_W >= 3000 ? 1000 : MAP_W >= 2000 ? 500 : 300, Lv = L * vk, sx = VW / 2 - Lv / 2, sy = VH + 120;
  text('GRAPHIC SCALE', VW / 2, sy - 22, 24, { weight: 700, align: 'center' });
  ctx.strokeStyle = MAP_INK; ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? 'rgb(' + MAPC.paper.join(',') + ')' : MAP_INK;
    ctx.fillRect(sx + i * Lv / 10, sy, Lv / 10, 14); ctx.strokeRect(sx + i * Lv / 10, sy, Lv / 10, 14);
  }
  for (let m = 0; m <= L; m += L / 5) text(String(m), sx + m * vk, sy + 44, 22, { align: 'center' });
  text('METERS', sx + Lv + 30, sy + 14, 22, { weight: 700 });
  // The declination diagram and notes sit at the bottom right.
  const nx = VW - 520;
  text('CONTOUR INTERVAL ' + map.ci + ' METERS', nx, VH + 200, 24, { weight: 700 });
  text('ELEVATIONS IN METERS ABOVE MEAN SEA LEVEL', nx, VH + 234, 19, { weight: 500 });
  text('GRID: 1000 METER SQUARES' + (gridStep() < 1000 ? ', 100 M LINES' : ''), nx, VH + 262, 19, { weight: 500 });
  text('TO GIVE A GRID REFERENCE: READ RIGHT, THEN UP', nx, VH + 290, 19, { weight: 500 });
  const dx = VW - 70, dy = VH + 440, gm = map.gmAngle;
  const ray = (deg, len) => ({ x: dx + Math.sin(deg * Math.PI / 180) * len, y: dy - Math.cos(deg * Math.PI / 180) * len });
  ctx.strokeStyle = MAP_INK; ctx.lineWidth = 3;
  const tn = ray(0, 120), gn = ray(-1.2, 120), mn = ray(gm, 108);
  for (const p of [tn, gn, mn]) { ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  ctx.fillStyle = MAP_INK;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 4 : 10; ctx.lineTo(tn.x + Math.cos(a) * rr, tn.y - 6 + Math.sin(a) * rr); }
  ctx.fill();
  text('GN', gn.x - 10, gn.y - 4, 20, { weight: 700, align: 'right' });
  ctx.beginPath(); ctx.moveTo(mn.x, mn.y); ctx.lineTo(mn.x + 9, mn.y + 20); ctx.lineTo(mn.x, mn.y + 17); ctx.fill();
  text('MN', mn.x + 12, mn.y + 6, 20, { weight: 700 });
  text(Math.abs(gm).toFixed(1) + '° G-M ANGLE ' + (gm >= 0 ? 'EAST' : 'WEST'), nx, VH + 330, 19, { weight: 500 });
  text('GRID BEARINGS USED IN REPORTS', nx, VH + 358, 19, { weight: 500 });
  ctx.restore();
  R.sheet = c;
}

// ---------------------------------------------------------------- tiles
function levelFor(zoom) { return zoom < 0.95 ? 0 : zoom < 2.8 ? 1 : 2; }

function tileFor(level, i, j) {
  const key = level + ':' + i + ':' + j;
  let t = R.tiles.get(key);
  if (t) { t.used = performance.now(); return t.canvas ? t : null; }
  R.tiles.set(key, { level, i, j, canvas: null, used: performance.now() });
  R.queue.push(key);
  return null;
}

// Draw at most a few missing tiles per frame so panning never stalls.
function drawQueuedTiles(budgetMs) {
  const start = performance.now();
  while (R.queue.length && performance.now() - start < budgetMs) {
    // Nearest to the view center first.
    R.queue.sort((a, b) => tileDist(b) - tileDist(a));
    const key = R.queue.pop(), t = R.tiles.get(key);
    if (!t || t.canvas) continue;
    const L = LEVELS[t.level], x0 = t.i * L.size, y0 = t.j * L.size;
    const w = Math.min(L.size, MAP_W - x0), h = Math.min(L.size, MAP_H - y0);
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * L.ppm); c.height = Math.ceil(h * L.ppm);
    drawMapRegion(c.getContext('2d'), G.map, x0, y0, w, h, L.ppm, t.level);
    t.canvas = c; t.w = w; t.h = h;
  }
  // Forget the least recently used tiles.
  if (R.tiles.size > TILE_CACHE) {
    const done = [...R.tiles.entries()].filter(([, t]) => t.canvas).sort((a, b) => a[1].used - b[1].used);
    for (let k = 0; k < done.length && R.tiles.size > TILE_CACHE; k++) R.tiles.delete(done[k][0]);
  }
}
function tileDist(key) {
  const [l, i, j] = key.split(':').map(Number), L = LEVELS[l];
  return Math.hypot((i + 0.5) * L.size - R.cam.x, (j + 0.5) * L.size - R.cam.y);
}

// ---------------------------------------------------------------- frame
const TEAM_TAG = ['', '1', '2', '3', '4'];
// Overlay colors follow US doctrine for graphics on a map overlay:
// blue for friendly, red for enemy, black for fire support targets.
const OVL = { blue: '#1f4fbf', red: '#c62828', black: '#161616' };

function tableTexture() {
  if (R.table) return R.table;
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a4031'; ctx.fillRect(0, 0, 160, 160);
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '0,0,0' : '255,255,230') + ',' + (Math.random() * 0.06) + ')';
    ctx.fillRect(Math.random() * 160, Math.random() * 160, 1 + Math.random() * 2, 1);
  }
  R.table = R.ctx.createPattern(c, 'repeat');
  const n = document.createElement('canvas');
  n.width = n.height = 256;
  const nctx = n.getContext('2d'), nimg = nctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 120 + Math.random() * 135;
    nimg.data[i * 4] = v; nimg.data[i * 4 + 1] = v * 0.97; nimg.data[i * 4 + 2] = v * 0.9; nimg.data[i * 4 + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  R.grain = R.ctx.createPattern(n, 'repeat');
  return R.table;
}

function render() {
  const ctx = R.ctx, z = R.cam.zoom;
  ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  ctx.fillStyle = tableTexture();
  ctx.fillRect(0, 0, R.w, R.h);
  if (R.sheet) {
    const o = toScreen(-SHEET.ml, -SHEET.mt);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 24; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 10;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(R.sheet, o.x, o.y, SHEET_W * z, SHEET_H * z);
    ctx.restore();
    drawTiles(ctx);
    drawPaper(ctx);
  }
  Fog.draw(ctx);
  drawEdgeLabels(ctx);
  drawPlan(ctx);
  drawPlanGhosts(ctx);
  drawOrdersOverlay(ctx);
  drawProjectiles(ctx);
  drawEffects(ctx);
  drawCones(ctx);
  drawUnits(ctx);
  drawGhostFormation(ctx);
  drawNudge(ctx);
  drawTapes(ctx);
  drawFloaters(ctx);
  drawScale(ctx);
}

function drawTiles(ctx) {
  const lvl = levelFor(R.cam.zoom);
  if (!lvl || !G.map) return;
  const L = LEVELS[lvl], a = toWorld(0, 0), b = toWorld(R.w, R.h);
  const i0 = Math.max(0, Math.floor(a.x / L.size)), i1 = Math.min(Math.ceil(MAP_W / L.size) - 1, Math.floor(b.x / L.size));
  const j0 = Math.max(0, Math.floor(a.y / L.size)), j1 = Math.min(Math.ceil(MAP_H / L.size) - 1, Math.floor(b.y / L.size));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const t = tileFor(lvl, i, j);
    // While a close tile is being drawn, show the coarser one if it is ready.
    if (!t && lvl === 2) {
      const k = R.tiles.get('1:' + Math.floor(i * 200 / 600) + ':' + Math.floor(j * 200 / 600));
      if (k && k.canvas) { const p = toScreen(k.i * 600, k.j * 600); ctx.drawImage(k.canvas, p.x, p.y, k.w * R.cam.zoom, k.h * R.cam.zoom); }
      continue;
    }
    if (!t) continue;
    const p = toScreen(i * L.size, j * L.size);
    ctx.drawImage(t.canvas, p.x, p.y, t.w * R.cam.zoom + 0.5, t.h * R.cam.zoom + 0.5);
  }
  drawQueuedTiles(R.queue.length > 4 ? 30 : 14);
}

// Paper grain and fold creases, fixed to the sheet.
function drawPaper(ctx) {
  const z = R.cam.zoom, o = toScreen(-SHEET.ml, -SHEET.mt), w = SHEET_W * z, h = SHEET_H * z;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.07;
  if (R.grain.setTransform) R.grain.setTransform(new DOMMatrix([1, 0, 0, 1, o.x, o.y]));
  ctx.fillStyle = R.grain;
  ctx.fillRect(Math.max(0, o.x), Math.max(0, o.y), Math.min(R.w, o.x + w) - Math.max(0, o.x), Math.min(R.h, o.y + h) - Math.max(0, o.y));
  ctx.restore();
  const crease = (pos, vertical) => {
    const g = vertical ? ctx.createLinearGradient(pos - 12, 0, pos + 12, 0) : ctx.createLinearGradient(0, pos - 12, 0, pos + 12);
    g.addColorStop(0, 'rgba(60,50,30,0)'); g.addColorStop(0.47, 'rgba(60,50,30,0.08)');
    g.addColorStop(0.5, 'rgba(255,255,250,0.3)'); g.addColorStop(0.54, 'rgba(60,50,30,0.04)'); g.addColorStop(1, 'rgba(60,50,30,0)');
    ctx.fillStyle = g;
    if (vertical) ctx.fillRect(pos - 12, Math.max(0, o.y), 24, Math.min(R.h, o.y + h) - Math.max(0, o.y));
    else ctx.fillRect(Math.max(0, o.x), pos - 12, Math.min(R.w, o.x + w) - Math.max(0, o.x), 24);
  };
  crease(o.x + w / 2, true);
  crease(o.y + h / 3, false);
  crease(o.y + h * 2 / 3, false);
}

// When the margin is scrolled off screen, repeat the grid values along the screen edge.
// On a one-square sheet the 100 m lines carry the kilometer and hundreds digits (473).
function drawEdgeLabels(ctx) {
  ctx.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(247,245,236,0.95)'; ctx.fillStyle = OVL.black;
  const top = 56, gs = gridStep();
  const label = (base, m) => gs < 1000 ? String(base * 10 + m / 100).padStart(3, '0') : String(base + m / 1000).padStart(2, '0');
  if (toScreen(0, 0).y < top) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (let x = gs; x < MAP_W; x += gs) {
      const p = toScreen(x, 0), t = label(G.grid.e, x);
      if (p.x < 4 || p.x > R.w - 30) continue;
      ctx.strokeText(t, p.x + 3, top); ctx.fillText(t, p.x + 3, top);
    }
  }
  const left = R.w > 760 && !document.body.classList.contains('roster-min') ? 306 : 4;
  if (toScreen(0, 0).x < left) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (let n = gs; n < MAP_H; n += gs) {
      const p = toScreen(0, MAP_H - n), t = label(G.grid.n, n);
      if (p.y < top + 16 || p.y > R.h - 10) continue;
      ctx.strokeText(t, left, p.y - 2); ctx.fillText(t, left, p.y - 2);
    }
  }
}

// Coordinate card: graphic scale at the current zoom and the grid reference under the cursor.
function drawScale(ctx) {
  const z = R.cam.zoom;
  const steps = [10, 25, 50, 100, 250, 500, 1000];
  const m = steps.find(s => s * z >= 70) || 1000, len = m * z;
  const hv = G.ui.hover && G.ui.hoverIsPointer ? G.ui.hover : null;
  const onMap = hv && G.map && hv.x >= 0 && hv.y >= 0 && hv.x <= MAP_W && hv.y <= MAP_H;
  const w = Math.max(len + 70, 230), h = onMap ? 46 : 30;
  const x = Math.max(14, R.w - w - 10), y = R.h - (G.ui.panelH || 0) - h - 10;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#f8f5ea';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = OVL.black; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = OVL.black;
  ctx.fillRect(x + 10, y + 16, len / 2, 4);
  ctx.strokeRect(x + 10, y + 16, len, 4);
  ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('0', x + 7, y + 14);
  ctx.textAlign = 'right';
  ctx.fillText(m + ' M', x + 10 + len + 4, y + 14);
  ctx.textAlign = 'left';
  if (onMap) {
    ctx.textBaseline = 'top';
    ctx.fillText('GR ' + gridRef(hv.x, hv.y) + '  ELEV ' + Math.round(G.map.elevBase + G.map.elevAt(hv.x, hv.y)) + ' M', x + 10, y + 26);
  }
}

// 8-digit grid reference (10 m precision) for a map point.
function gridRef(x, y) {
  const e = Math.floor((G.grid.e * 1000 + x) / 10) % 10000;
  const n = Math.floor((G.grid.n * 1000 + (MAP_H - y)) / 10) % 10000;
  return String(e).padStart(4, '0') + ' ' + String(n).padStart(4, '0');
}

// ---------------------------------------------------------------- pieces
function unitRadius() { return clamp(R.cam.zoom * 1.6, 10, 17); }

function enemyVisible(e) {
  const k = G.known.blue.get(e.id);
  return G.revealAll || (k && k.visible);
}

// What sits on the map at this zoom: each man as a round counter close in; farther out,
// a square counter for each fire team; farther still, one for each squad.
function pieceLevel() { return R.cam.zoom >= 2 ? 'man' : R.cam.zoom >= 0.7 ? 'team' : 'squad'; }

function displayPieces() {
  const level = pieceLevel(), out = [];
  if (!G.squads.blue) return out;
  const visible = (s) => s.side === 'blue' || enemyVisible(s);
  if (level === 'man') {
    for (const s of G.soldiers) if (!s.routed && visible(s)) out.push({ kind: 'man', x: s.x, y: s.y, side: s.side, soldier: s });
  } else {
    for (const sq of [G.squads.blue, G.squads.red]) {
      const groups = level === 'team' ? [sq.hq, ...sq.teams].map(t => ({ team: t, men: t.members })) : [{ squad: sq, men: sq.all }];
      for (const gr of groups) {
        const seen = gr.men.filter(s => !s.routed && visible(s));
        if (!seen.length) continue;
        const live = seen.filter(s => s.active);
        const c = centroid(live.length ? live : seen);
        out.push({ kind: level, x: c.x, y: c.y, side: sq.side, team: gr.team, squad: gr.squad || sq, men: seen, live });
      }
    }
  }
  // Last known enemy positions, grouped the same way.
  if (!G.revealAll) {
    const lost = [];
    for (const k of G.known.blue.values()) {
      const e = G.byId.get(k.id);
      if (!k.visible && e && e.active) lost.push({ k, e });
    }
    if (level === 'man') for (const { k } of lost) out.push({ kind: 'lost', x: k.x, y: k.y, side: 'red', billet: k.billet, age: G.time - k.t });
    else {
      const by = new Map();
      for (const l of lost) {
        const key = level === 'team' ? l.e.team : l.e.squad;
        if (!by.has(key)) by.set(key, []);
        by.get(key).push(l);
      }
      for (const [, list] of by) {
        const c = centroid(list.map(l => l.k));
        out.push({ kind: 'lost', x: c.x, y: c.y, side: 'red', unit: level, age: G.time - Math.max(...list.map(l => l.k.t)) });
      }
    }
  }
  return out;
}

function pieceAt(sx, sy) {
  const r = (pieceLevel() === 'man' ? unitRadius() : 18) + 5;
  let best = null, bd = Infinity;
  for (const p of displayPieces()) {
    if (p.kind === 'lost') continue;
    const q = toScreen(p.x, p.y), d = Math.hypot(q.x - sx, q.y - sy);
    const pen = d + (p.kind === 'man' && !p.soldier.alive ? 6 : 0) + (p.side === 'blue' ? 0 : 2);
    if (d < r && pen < bd) { bd = pen; best = p; }
  }
  return best;
}

const PIECE_EDGE = { blue: '#3a7d96', red: '#a14646' };

// A round counter for one man: a thick disc with the billet symbol on its face.
// Picked-up (selected) pieces are lifted off the map and throw a longer shadow.
function drawDisc(ctx, side, billet, x, py, r, lifted) {
  const th = Math.max(2, r * 0.22), lift = lifted ? 4 : 0, y = py - lift;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3 + lift * 2;
  ctx.shadowOffsetX = 1.5 + lift * 0.8; ctx.shadowOffsetY = 2 + lift * 1.2;
  ctx.fillStyle = PIECE_EDGE[side];
  ctx.beginPath(); ctx.arc(x, y + th, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = PIECE_EDGE[side];
  ctx.fillRect(x - r, y, r * 2, th);
  drawSymbol(ctx, x, y, r, billet, { side });
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(x, y, r - 2.2, Math.PI * 1.08, Math.PI * 1.55); ctx.stroke();
  return y;
}

// Unit symbol (MIL-STD-2525): friendly a rectangle, hostile a diamond, infantry an X,
// with the echelon above: a circle with a slash for a team, a dot for a squad.
function drawUnitSymbol(ctx, x, y, s, side, echelon, opts) {
  opts = opts || {};
  const fill = opts.fill != null ? opts.fill : SIDE_FILL[side], ink = opts.ink || MAP_INK;
  ctx.save();
  ctx.lineWidth = Math.max(1.4, s * 0.09);
  ctx.strokeStyle = ink; ctx.fillStyle = fill;
  if (opts.dashed) ctx.setLineDash([s * 0.22, s * 0.16]);
  let top;
  if (side === 'blue') {
    const w = s * 1.5, h = s;
    ctx.beginPath(); ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x - w / 2, y - h / 2); ctx.lineTo(x + w / 2, y + h / 2); ctx.moveTo(x + w / 2, y - h / 2); ctx.lineTo(x - w / 2, y + h / 2); ctx.stroke();
    top = y - h / 2;
  } else {
    const d = s * 0.8;
    ctx.beginPath(); ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x - d / 2, y - d / 2); ctx.lineTo(x + d / 2, y + d / 2); ctx.moveTo(x + d / 2, y - d / 2); ctx.lineTo(x - d / 2, y + d / 2); ctx.stroke();
    top = y - d;
  }
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  const ey = top - s * 0.28;
  if (echelon === 'team') {
    const rr = s * 0.16;
    ctx.lineWidth = Math.max(1.2, s * 0.07);
    ctx.beginPath(); ctx.arc(x, ey, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - rr * 1.5, ey + rr * 1.5); ctx.lineTo(x + rr * 1.5, ey - rr * 1.5); ctx.stroke();
  } else if (echelon === 'squad') {
    ctx.beginPath(); ctx.arc(x, ey, s * 0.09, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// A square cardboard counter for a fire team or squad, with its symbol and strength.
function drawCounter(ctx, p, sx, sy, s, lifted) {
  const lift = lifted ? 4 : 0, y = sy - lift, half = s * 1.25, th = Math.max(2, s * 0.14);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3 + lift * 2;
  ctx.shadowOffsetX = 1.5 + lift * 0.8; ctx.shadowOffsetY = 2 + lift * 1.2;
  ctx.fillStyle = PIECE_EDGE[p.side];
  ctx.fillRect(sx - half, y - half + th, half * 2, half * 2);
  ctx.restore();
  ctx.fillStyle = p.side === 'blue' ? '#e9f6fb' : '#fbeaea';
  ctx.fillRect(sx - half, y - half, half * 2, half * 2);
  ctx.strokeStyle = PIECE_EDGE[p.side]; ctx.lineWidth = 1.5;
  ctx.strokeRect(sx - half + 0.75, y - half + 0.75, half * 2 - 1.5, half * 2 - 1.5);
  drawUnitSymbol(ctx, sx, y - s * 0.05, s * 0.85, p.side, p.kind);
  // Designation at the top left, effective strength at the bottom.
  ctx.fillStyle = MAP_INK;
  ctx.font = '700 ' + Math.round(s * 0.42) + 'px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.fillText(p.live.length + '/' + p.men.length, sx, y + half - s * 0.14);
  if (p.kind === 'team') {
    ctx.textAlign = 'left';
    ctx.fillText(p.team.num ? String(p.team.num) : 'SL', sx - half + 3, y - half + s * 0.48);
  }
  return y;
}

// Ammunition left, as a bar under a friendly piece: green, amber below half, red below a
// quarter; an empty red frame when he is out.
function ammoColor(f) { return f > 0.5 ? '#3fae4a' : f > 0.25 ? '#e8a21e' : '#d83a2e'; }
function drawAmmoBar(ctx, x, y, w, f) {
  const h = Math.max(3, w * 0.09);
  ctx.fillStyle = 'rgba(20,20,20,0.7)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
  if (f > 0) { ctx.fillStyle = ammoColor(f); ctx.fillRect(x - w / 2, y, w * f, h); }
  else { ctx.strokeStyle = '#d83a2e'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + 0.5, y + 0.5, w - 1, h - 1); }
}

// Small square status chit stacked against a piece, as in a board wargame.
function drawChit(ctx, x, y, size, label, bg, fg) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 2; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, size * 1.7, size);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.8;
  ctx.strokeRect(x + 0.5, y + 0.5, size * 1.7 - 1, size - 1);
  ctx.fillStyle = fg;
  ctx.font = '700 ' + Math.round(size * 0.68) + 'px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + size * 0.85, y + size / 2 + 0.5);
}

function drawUnits(ctx) {
  const r = unitRadius();
  const sel = new Set(selMembers(G.ui.sel));
  const pieces = displayPieces();
  const isSel = (p) => p.kind === 'man' ? sel.has(p.soldier) : p.men ? p.men.some(s => sel.has(s)) : false;
  pieces.sort((a, b) => (a.kind === 'lost' ? -1 : 0) - (b.kind === 'lost' ? -1 : 0)
    || (a.kind === 'man' && !a.soldier.alive ? -1 : 0) - (b.kind === 'man' && !b.soldier.alive ? -1 : 0)
    || (isSel(a) ? 1 : 0) - (isSel(b) ? 1 : 0) || a.y - b.y);
  const chit = Math.max(9, r * 0.7);
  for (const p of pieces) {
    const q = toScreen(p.x, p.y);
    if (q.x < -50 || q.y < -50 || q.x > R.w + 50 || q.y > R.h + 50) continue;
    if (p.kind === 'lost') {
      ctx.save();
      ctx.globalAlpha = clamp(1 - p.age / 50, 0.3, 0.9);
      if (p.billet) drawSymbol(ctx, q.x, q.y, r, p.billet, { fill: 'rgba(255,255,255,0)', ink: OVL.red, dashed: true });
      else drawUnitSymbol(ctx, q.x, q.y, r * 1.1, 'red', p.unit, { fill: 'rgba(255,255,255,0)', ink: OVL.red, dashed: true });
      ctx.restore();
      continue;
    }
    const lifted = isSel(p) && (p.kind !== 'man' || p.soldier.active);
    if (isSel(p)) {
      // A soft halo, centered on the piece as it is drawn (lifted 4 px when picked up).
      const hy = q.y - (lifted ? 4 : 0), inner = p.kind === 'man' ? r : 22, outer = inner + 16;
      const g = ctx.createRadialGradient(q.x, hy, inner * 0.6, q.x, hy, outer);
      g.addColorStop(0, 'rgba(255,214,10,0.75)');
      g.addColorStop(0.55, 'rgba(255,214,10,0.35)');
      g.addColorStop(1, 'rgba(255,214,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(q.x, hy, outer, 0, Math.PI * 2); ctx.fill();
    }
    if (p.kind !== 'man') {
      const y = drawCounter(ctx, p, q.x, q.y, 14, lifted);
      if (p.side === 'blue' && p.live.length) {
        const tot = p.live.reduce((n, s) => n + s.ammoLeft, 0), st = p.live.reduce((n, s) => n + s.ammoStart, 0);
        drawAmmoBar(ctx, q.x, y + 14 * 1.25 + 5, 14 * 2.5, st ? tot / st : 0);
      }
      const pinned = p.live.filter(s => s.pinned).length, supp = p.live.filter(s => s.suppressed).length;
      const chits = [];
      if (p.live.length && pinned * 2 >= p.live.length) chits.push(['PIN', '#b3261e', '#fff']);
      else if (p.live.length && supp * 2 >= p.live.length) chits.push(['SUP', '#e8871e', '#1b1405']);
      if (p.live.some(s => s.moving)) chits.push(['MOV', '#f3eedc', MAP_INK]);
      chits.forEach(([label, bg, fg], i) => drawChit(ctx, q.x + r * 0.7 + i * 3, y + r * 0.8 + i * (chit * 0.62), chit, label, bg, fg));
      continue;
    }
    const s = p.soldier, down = !s.active;
    const y = drawDisc(ctx, s.side, s.billet, q.x, q.y, r, lifted);
    if (!down && s.side === 'blue') drawAmmoBar(ctx, q.x, y + r + Math.max(2, r * 0.22) + 3, r * 1.8, s.ammoFrac);
    // Operational condition (MIL-STD-2525): slash for a casualty, X for killed.
    if (down) {
      ctx.strokeStyle = OVL.black; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      const k = r + 4;
      ctx.beginPath(); ctx.moveTo(q.x - k, y + k); ctx.lineTo(q.x + k, y - k);
      if (s.health === 'kia') { ctx.moveTo(q.x - k, y - k); ctx.lineTo(q.x + k, y + k); }
      ctx.stroke();
      continue;
    }
    if (s.team.num) {
      ctx.font = '700 ' + Math.round(r * 0.9) + 'px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(247,245,236,0.95)';
      ctx.strokeText(TEAM_TAG[s.team.num], q.x + r + 3, y - r * 0.55);
      ctx.fillStyle = s.side === 'blue' ? OVL.blue : OVL.red;
      ctx.fillText(TEAM_TAG[s.team.num], q.x + r + 3, y - r * 0.55);
    }
    const chits = [[POSTURE[s.posture].short, '#f3eedc', OVL.black]];
    if (s.pinned) chits.push(['PIN', '#b3261e', '#fff']);
    else if (s.suppressed) chits.push(['SUP', '#e8871e', '#1b1405']);
    if (s.health === 'light') chits.push(['WIA', '#fff', '#b3261e']);
    if (s.side === 'blue' && s.inMag + s.mags === 0) chits.push(['AMO', '#ffd60a', OVL.black]);
    chits.forEach(([label, bg, fg], i) => drawChit(ctx, q.x + r * 0.35 + i * 3, y + r * 0.45 + i * (chit * 0.62), chit, label, bg, fg));
  }
}

// Vision cones: where each man is looking, shaded in his side's overlay color.
// The cone narrows as he grows alert and becomes a thin line while he aims.
function drawCones(ctx) {
  if (!G.ui.cones || pieceLevel() !== 'man' || !G.squads.blue) return;
  const z = R.cam.zoom, len = clamp(40 + z * 14, 60, 150);
  for (const s of G.soldiers) {
    if (!s.active || s.routed || (s.side === 'red' && !enemyVisible(s))) continue;
    const q = toScreen(s.x, s.y);
    if (q.x < -len || q.y < -len || q.x > R.w + len || q.y > R.h + len) continue;
    const rgb = s.side === 'blue' ? '31,79,191' : '198,40,40';
    const g = ctx.createRadialGradient(q.x, q.y, 6, q.x, q.y, len);
    g.addColorStop(0, 'rgba(' + rgb + ',' + (0.26 + 0.12 * s.agit) + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.arc(q.x, q.y, len, s.look - s.coneHalf, s.look + s.coneHalf);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(' + rgb + ',0.45)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(q.x + Math.cos(s.look - s.coneHalf) * 8, q.y + Math.sin(s.look - s.coneHalf) * 8);
    ctx.lineTo(q.x + Math.cos(s.look - s.coneHalf) * len * 0.75, q.y + Math.sin(s.look - s.coneHalf) * len * 0.75);
    ctx.moveTo(q.x + Math.cos(s.look + s.coneHalf) * 8, q.y + Math.sin(s.look + s.coneHalf) * 8);
    ctx.lineTo(q.x + Math.cos(s.look + s.coneHalf) * len * 0.75, q.y + Math.sin(s.look + s.coneHalf) * len * 0.75);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- the plan's control measures
// Friendly control measures in blue, as drawn on an acetate overlay (ADP 1-02 forms):
// checkpoint, objective, support-by-fire position, assault position, phase line, CCP.
// Orientation marks. Key terrain is marked as on a terrain overlay, with a circled K, and
// named on a flag; our assembly area is a blue outline (AA); the reported enemy is the
// hostile infantry symbol in a dashed frame, as suspected.
function drawTerrainMarks(ctx) {
  if (!Plan.terrain || !Plan.showTerrain) return;
  const flag = (x, y, text, color) => {
    const top = y - 46;
    ctx.strokeStyle = color; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x, top); ctx.stroke();
    ctx.font = '700 12px "Saira Condensed", "Arial Narrow", sans-serif';
    const w = ctx.measureText(text).width + 14, h = 17;
    ctx.fillStyle = 'rgba(250,248,240,0.96)';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + w, top); ctx.lineTo(x + w - 6, top + h / 2); ctx.lineTo(x + w, top + h); ctx.lineTo(x, top + h); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 5, top + h / 2 + 0.5);
  };
  for (const k of Plan.terrain) {
    // On the 3D sand table the flags stand up as poles; only the assembly area is drawn flat.
    if (View3D.drawingDrape && k.kind !== 'aa') continue;
    const p = toScreen(k.x, k.y);
    if (p.x < -80 || p.y < -80 || p.x > R.w + 200 || p.y > R.h + 80) continue;
    if (k.kind === 'aa') {
      const rr = Math.max(26, 60 * R.cam.zoom);
      ctx.strokeStyle = OVL.blue; ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) { const a = i / 30 * Math.PI * 2, w = 1 + 0.08 * Math.sin(a * 4); i ? ctx.lineTo(p.x + Math.cos(a) * rr * w, p.y + Math.sin(a) * rr * 0.75 * w) : ctx.moveTo(p.x + rr * w, p.y); }
      ctx.closePath(); ctx.stroke();
      ctx.font = '700 13px "Saira Condensed", "Arial Narrow", sans-serif'; ctx.fillStyle = OVL.blue; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('AA', p.x, p.y - rr * 0.75 - 9);
    } else if (k.kind === 'eny') {
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawUnitSymbol(ctx, p.x, p.y, 16, 'red', 'squad', { fill: 'rgba(255,128,128,0.25)', ink: OVL.red, dashed: true });
      ctx.restore();
      flag(p.x + 14, p.y, k.name, OVL.red);
    } else {
      // Circled K on the spot, with the name on a flag.
      ctx.fillStyle = 'rgba(250,248,240,0.9)'; ctx.strokeStyle = MAP_INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '700 13px "Saira Condensed", "Arial Narrow", sans-serif'; ctx.fillStyle = MAP_INK;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('K', p.x, p.y + 1);
      flag(p.x, p.y, k.name, MAP_INK);
    }
  }
}

// While planning: a dashed arrow for each planned move, and a dashed ghost counter of each
// unit where its last move ends. Tapping a ghost picks that unit to plan its next step.
function drawPlanGhosts(ctx) {
  if (!Plan.planning || !G.squads.blue) return;
  const pr = Plan.projection();
  ctx.save();
  // Heavier on the sand table, where the drawing is seen at a slant.
  const lw = View3D.drawingDrape ? Math.max(3, 1.5 * R.cam.zoom) : 2, dl = lw * 3.5;
  ctx.strokeStyle = 'rgba(31,79,191,0.75)'; ctx.fillStyle = 'rgba(31,79,191,0.75)'; ctx.lineWidth = lw; ctx.setLineDash([dl, dl * 0.7]);
  for (const lg of pr.legs) {
    const pts = [lg.from, ...(lg.via ? lg.via : [lg.to])].map(p => toScreen(p.x, p.y));
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
    const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (Math.hypot(b.x - a.x, b.y - a.y) > 14) {
      ctx.setLineDash([]);
      const ah = lw * 5.5;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - Math.cos(ang - 0.4) * ah, b.y - Math.sin(ang - 0.4) * ah);
      ctx.lineTo(b.x - Math.cos(ang + 0.4) * ah, b.y - Math.sin(ang + 0.4) * ah); ctx.closePath(); ctx.fill();
      ctx.setLineDash([dl, dl * 0.7]);
    }
  }
  ctx.setLineDash([]);
  if (!View3D.drawingDrape) for (const gh of pr.ghosts) {
    const q = toScreen(gh.x, gh.y);
    ctx.globalAlpha = 0.85;
    drawUnitSymbol(ctx, q.x, q.y, 15, 'blue', gh.unit === 'squad' ? 'squad' : 'team', { fill: 'rgba(128,224,255,0.3)', ink: OVL.blue, dashed: true });
    ctx.globalAlpha = 1;
    if (gh.unit !== 'squad') {
      ctx.font = '700 12px "Saira Condensed", "Arial Narrow", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(247,245,236,0.95)'; ctx.strokeText(gh.unit[1], q.x + 14, q.y - 8);
      ctx.fillStyle = OVL.blue; ctx.fillText(gh.unit[1], q.x + 14, q.y - 8);
    }
  }
  ctx.restore();
}
function ghostAt(sx, sy) {
  if (!Plan.planning) return null;
  let best = null, bd = 20;
  for (const gh of Plan.projection().ghosts) { const q = toScreen(gh.x, gh.y), d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; best = gh; } }
  return best;
}

function drawPlan(ctx) {
  if (!G.squads.blue || !Plan.graphics) return;
  drawTerrainMarks(ctx);
  const z = R.cam.zoom;
  const label = (t, x, y, size, align) => {
    ctx.font = '700 ' + size + 'px "Saira Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(247,245,236,0.9)'; ctx.strokeText(t, x, y);
    ctx.fillStyle = OVL.blue; ctx.fillText(t, x, y);
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const g of Plan.graphics) {
    const sel = Plan.selected === g.id && Plan.planning;
    ctx.strokeStyle = OVL.blue; ctx.fillStyle = OVL.blue; ctx.lineWidth = sel ? 3.2 : 2.2;
    if (sel) { ctx.shadowColor = 'rgba(255,214,10,0.9)'; ctx.shadowBlur = 8; }
    const p = toScreen(g.pts[0].x, g.pts[0].y);
    if (g.kind === 'cp') {
      ctx.fillStyle = 'rgba(247,245,236,0.85)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      label(g.name.replace(/^CP\s*/, ''), p.x, p.y + 1, 14);
      label('CP', p.x + 22, p.y - 12, 11);
    } else if (g.kind === 'obj' || g.kind === 'aslt') {
      const rr = Math.max(g.kind === 'obj' ? 26 : 18, g.r * z);
      ctx.beginPath();
      for (let i = 0; i <= 36; i++) {
        const a = i / 36 * Math.PI * 2, w = 1 + 0.1 * Math.sin(a * 3 + g.id) + 0.05 * Math.sin(a * 7);
        const x = p.x + Math.cos(a) * rr * w, y = p.y + Math.sin(a) * rr * 0.8 * w;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
      ctx.shadowBlur = 0;
      label(g.name, p.x, p.y, g.kind === 'obj' ? 15 : 12);
    } else if (g.kind === 'sbf') {
      // A base line facing the target, with an arrow from each end toward it.
      const ref = Plan.lines.find(l => l.task === 'sbf' && l.where === g.id && Plan.graphic(l.target));
      const tp = ref ? Plan.anchor(Plan.graphic(ref.target)) : Plan.reported;
      const a = angleTo(g.pts[0].x, g.pts[0].y, tp.x, tp.y), L = Math.max(22, 22 * z);
      const nx = -Math.sin(a), ny = Math.cos(a);
      const e1 = { x: p.x + nx * L, y: p.y + ny * L }, e2 = { x: p.x - nx * L, y: p.y - ny * L };
      ctx.beginPath(); ctx.moveTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.stroke();
      for (const e of [e1, e2]) {
        const t = { x: e.x + Math.cos(a) * L * 0.9, y: e.y + Math.sin(a) * L * 0.9 };
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        arrowHead(ctx, e, t, 8, true);
      }
      ctx.shadowBlur = 0;
      label(g.name, p.x - Math.cos(a) * 14, p.y - Math.sin(a) * 14, 12);
    } else if (g.kind === 'rte') {
      const q = g.pts.map(pt => toScreen(pt.x, pt.y));
      ctx.setLineDash([10, 5]);
      ctx.beginPath(); q.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)); ctx.stroke();
      ctx.setLineDash([]);
      for (const pt of q.slice(1, -1)) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
      arrowHead(ctx, q[q.length - 2], q[q.length - 1], 10, true);
      ctx.shadowBlur = 0;
      const m = Math.floor((q.length - 1) / 2), mx = (q[m].x + q[m + 1].x) / 2, my = (q[m].y + q[m + 1].y) / 2;
      label(g.name, mx, my - 12, 13);
    } else if (g.kind === 'fp') {
      // Fighting position: a bracket open to the rear, with the sector's left and right limits.
      const a = g.dir, L = Math.max(70, 150 * z), w = 14, nx = -Math.sin(a), ny = Math.cos(a);
      ctx.beginPath();
      ctx.moveTo(p.x + nx * w - Math.cos(a) * 8, p.y + ny * w - Math.sin(a) * 8);
      ctx.lineTo(p.x + nx * w, p.y + ny * w);
      ctx.lineTo(p.x - nx * w, p.y - ny * w);
      ctx.lineTo(p.x - nx * w - Math.cos(a) * 8, p.y - ny * w - Math.sin(a) * 8);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const d of [-g.width / 2, g.width / 2]) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a + d) * L, p.y + Math.sin(a + d) * L); }
      ctx.stroke(); ctx.setLineDash([]);
      label(g.name, p.x - Math.cos(a) * 18, p.y - Math.sin(a) * 18, 12);
    } else if (g.kind === 'trp') {
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x - 13, p.y); ctx.lineTo(p.x + 13, p.y); ctx.moveTo(p.x, p.y - 13); ctx.lineTo(p.x, p.y + 13); ctx.stroke();
      ctx.shadowBlur = 0;
      label(g.name, p.x + 16, p.y - 12, 12, 'left');
    } else if (g.kind === 'pl' || g.kind === 'loa') {
      const q = g.pts.map(pt => toScreen(pt.x, pt.y));
      ctx.beginPath(); q.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)); ctx.stroke();
      ctx.shadowBlur = 0;
      label(g.name, q[0].x, q[0].y - 12, 13);
      label(g.name, q[q.length - 1].x, q[q.length - 1].y - 12, 13);
    } else if (g.kind === 'ccp' || g.kind === 'rly' || g.kind === 'rel') {
      const t = g.kind === 'ccp' ? g.name.replace(/\s*1$/, '') : g.name;
      ctx.font = '700 12px "Saira Condensed", "Arial Narrow", sans-serif';
      const bw = Math.max(36, ctx.measureText(t).width + 12);
      ctx.fillStyle = 'rgba(247,245,236,0.9)';
      ctx.fillRect(p.x - bw / 2, p.y - 10, bw, 20); ctx.strokeRect(p.x - bw / 2, p.y - 10, bw, 20);
      ctx.shadowBlur = 0;
      label(t, p.x, p.y + 1, 12);
    }
    ctx.shadowBlur = 0;
  }
  // A route being drawn.
  if (Plan.routeDraft && Plan.routeDraft.length) {
    const q = Plan.routeDraft.map(pt => toScreen(pt.x, pt.y));
    ctx.strokeStyle = OVL.blue; ctx.fillStyle = OVL.blue; ctx.lineWidth = 2; ctx.setLineDash([10, 5]);
    ctx.beginPath(); q.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)); ctx.stroke();
    ctx.setLineDash([]);
    for (const pt of q) { ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill(); }
  }
  // First end of a line being drawn.
  if (Plan.plStart) {
    const p = toScreen(Plan.plStart.x, Plan.plStart.y);
    ctx.fillStyle = OVL.blue; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------------------------------------------------------------- overlay graphics
function arrowHead(ctx, from, to, size, filled) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x + Math.cos(a + 2.6) * size, to.y + Math.sin(a + 2.6) * size);
  ctx.lineTo(to.x, to.y);
  ctx.lineTo(to.x + Math.cos(a - 2.6) * size, to.y + Math.sin(a - 2.6) * size);
  if (filled) { ctx.closePath(); ctx.fill(); } else ctx.stroke();
}

// Target symbol: a cross in a circle with its label, in black.
function drawTarget(ctx, x, y, radius, label) {
  const p = toScreen(x, y), rr = Math.max(7, radius * R.cam.zoom);
  ctx.strokeStyle = OVL.black; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p.x - rr - 4, p.y); ctx.lineTo(p.x + rr + 4, p.y); ctx.moveTo(p.x, p.y - rr - 4); ctx.lineTo(p.x, p.y + rr + 4); ctx.stroke();
  ctx.font = '700 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(247,245,236,0.95)';
  ctx.strokeText(label, p.x + rr + 4, p.y - 3); ctx.fillStyle = OVL.black; ctx.fillText(label, p.x + rr + 4, p.y - 3);
}

// Friendly graphics drawn as on an acetate overlay, in blue grease pencil.
function drawOrdersOverlay(ctx) {
  const sel = G.ui.sel, selSet = new Set(selMembers(sel));
  const blue = G.squads.blue ? G.squads.blue.all.filter(s => s.active) : [];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Routes, with an arrowhead at the end. Assaults use the direction-of-attack arrow.
  for (const s of blue) {
    if (!s.path.length) continue;
    const pts = [toScreen(s.x, s.y), ...s.path.map(w => toScreen(w.x, w.y))];
    const strong = selSet.has(s);
    ctx.strokeStyle = OVL.blue; ctx.fillStyle = OVL.blue;
    ctx.globalAlpha = strong ? 0.95 : 0.55;
    ctx.lineWidth = s.assault ? 3 : strong ? 2.2 : 1.4;
    if (s.moveMode === 'crawl') ctx.setLineDash([2, 4]); else if (s.moveMode === 'rush') ctx.setLineDash([9, 4]);
    ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke();
    ctx.setLineDash([]);
    arrowHead(ctx, pts[pts.length - 2], pts[pts.length - 1], s.assault ? 11 : 8, s.assault);
    ctx.globalAlpha = 1;
  }
  // Objectives of bounding drills.
  for (const c of G.controllers) {
    if (c.members[0].side !== 'blue') continue;
    const p = toScreen(c.dest.x, c.dest.y), rr = Math.max(18, 16 * R.cam.zoom);
    ctx.strokeStyle = OVL.blue; ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = i / 24 * Math.PI * 2, w = 1 + 0.12 * Math.sin(a * 3 + 1);
      const x = p.x + Math.cos(a) * rr * w, y = p.y + Math.sin(a) * rr * 0.75 * w;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
    ctx.font = '700 14px "Saira Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = OVL.blue;
    ctx.fillText('OBJ', p.x, p.y);
  }
  // Suppression: support-by-fire lines from the shooters to a target.
  const targets = new Map();
  for (const s of blue) {
    if (s.suppressPt) {
      const key = Math.round(s.suppressPt.x) + ',' + Math.round(s.suppressPt.y);
      if (!targets.has(key)) targets.set(key, { pt: s.suppressPt, shooters: [] });
      targets.get(key).shooters.push(s);
    }
    if (s.launchQueue) drawTarget(ctx, s.launchQueue.x, s.launchQueue.y, 4, '40MM');
  }
  for (const t of targets.values()) {
    const b = toScreen(t.pt.x, t.pt.y);
    ctx.strokeStyle = OVL.blue; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
    for (const s of t.shooters) { const a = toScreen(s.x, s.y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    drawTarget(ctx, t.pt.x, t.pt.y, 6, 'SUPP');
  }
  // Sectors of fire for selected men told to watch a direction.
  for (const s of selSet) {
    if (!s.active || s.faceAngle == null) continue;
    const p = toScreen(s.x, s.y), L = Math.max(60, 35 * R.cam.zoom);
    ctx.strokeStyle = OVL.blue; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (const d of [-0.6, 0.6]) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(s.faceAngle + d) * L, p.y + Math.sin(s.faceAngle + d) * L); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  // The order being plotted: grease-pencil line to the cursor, with range and bearing on a tag.
  const pend = G.ui.pending, hv = G.ui.hover;
  if (!sel || !hv) return;
  const m = selMembers(sel).filter(s => s.active);
  if (!m.length) return;
  const c = centroid(m), a = toScreen(c.x, c.y), b = toScreen(hv.x, hv.y);
  if (pend === 'launcher' || pend === 'frag') {
    const gs = pend === 'launcher' ? m.filter(s => s.launcher) : m;
    for (const s of gs.slice(0, 3)) {
      const sp = toScreen(s.x, s.y), max = pend === 'launcher' ? s.launcher.range : s.grenade.range;
      ctx.strokeStyle = OVL.blue; ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, max * R.cam.zoom, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (!pend && !G.ui.hoverIsPointer) return;
  ctx.strokeStyle = OVL.blue; ctx.fillStyle = OVL.blue; ctx.globalAlpha = pend ? 0.95 : 0.45;
  ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  arrowHead(ctx, a, b, 9, pend === 'assault');
  ctx.globalAlpha = 1;
  const d = Math.round(dist(c.x, c.y, hv.x, hv.y));
  const label = (pend ? ORDER_LABEL[pend].toUpperCase() + '  ' : '') + d + ' M  ' + pad3(bearing(c.x, c.y, hv.x, hv.y)) + '°';
  ctx.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
  const tw = ctx.measureText(label).width;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 4; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#f8f5ea'; ctx.fillRect(b.x + 14, b.y - 26, tw + 14, 21);
  ctx.restore();
  ctx.strokeStyle = OVL.black; ctx.lineWidth = 1; ctx.strokeRect(b.x + 14.5, b.y - 25.5, tw + 13, 20);
  ctx.fillStyle = OVL.black; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, b.x + 21, b.y - 15);
}

function drawProjectiles(ctx) {
  for (const p of G.projectiles) {
    const f = Math.min(1, p.t / p.flight);
    const s = toScreen(lerp(p.x0, p.x1, f), lerp(p.y0, p.y1, f));
    ctx.fillStyle = '#2b2b2b'; ctx.strokeStyle = '#f8f5ea'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, p.kind === 'frag' ? 3 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (p.kind === 'rpg' && f < 1) {
      const t = toScreen(lerp(p.x0, p.x1, Math.max(0, f - 0.15)), lerp(p.y0, p.y1, Math.max(0, f - 0.15)));
      ctx.strokeStyle = 'rgba(90,90,90,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
  }
}

// Fire: thin streaks in each side's overlay color; bursts as fading rings.
function drawEffects(ctx) {
  const z = R.cam.zoom;
  for (const e of G.effects) {
    if (e.t < 0) continue;
    const f = e.t / e.life;
    if (e.type === 'tracer') {
      const h = clamp(f * 1.3, 0, 1), tl = clamp(f * 1.3 - 0.35, 0, 1);
      const a = toScreen(lerp(e.x1, e.x2, tl), lerp(e.y1, e.y2, tl)), b = toScreen(lerp(e.x1, e.x2, h), lerp(e.y1, e.y2, h));
      ctx.strokeStyle = e.side === 'blue' ? 'rgba(31,79,191,0.85)' : 'rgba(198,40,40,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (e.type === 'star') {
      // A star cluster: climbs, bursts into five stars, drifts down and fades.
      const p = toScreen(e.x, e.y), rise = Math.min(1, f * 3), h = 70 * rise - 20 * Math.max(0, f - 0.33);
      const burst = Math.max(0, f - 0.3) * 1.4;
      ctx.globalAlpha = clamp(1.3 - f, 0, 1);
      ctx.fillStyle = e.color;
      if (burst <= 0) { ctx.beginPath(); ctx.arc(p.x, p.y - h, 3, 0, Math.PI * 2); ctx.fill(); }
      else for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k - 2) * 0.5;
        ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * 22 * burst, p.y - h + Math.sin(a) * 14 * burst, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (e.type === 'flash') {
      const p = toScreen(e.x, e.y);
      ctx.fillStyle = 'rgba(232,135,30,' + (1 - f) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4 + 5 * f, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'blast') {
      const p = toScreen(e.x, e.y), rr = Math.max(4, (2 + e.r * 0.6 * Math.sqrt(f)) * z);
      ctx.fillStyle = 'rgba(232,135,30,' + (0.75 * (1 - f)) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, rr * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(22,22,22,' + (0.7 * (1 - f)) + ')'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

// The selected team or squad redrawn in the formation under the pointer: a dashed circle
// for each man's new station, a faint line from where he is now.
function drawGhostFormation(ctx) {
  const form = G.ui.ghostForm, sel = G.ui.sel;
  if (!form || !sel || sel.level === 'soldier') return;
  const slots = [];
  if (sel.level === 'team') {
    const act = sel.team.members.filter(commandable);
    act.forEach((s, i) => slots.push({ s, o: teamSlot(form, i) }));
  } else {
    const sq = sel.squad, teams = sq.teams.filter(t => t.members.some(commandable));
    teams.forEach((t, k) => {
      const q = squadSlot(form, k, teams.length);
      t.members.filter(commandable).forEach((s, i) => { const o = teamSlot(t.formation, i); slots.push({ s, o: { x: q.x + o.x, y: q.y + o.y } }); });
    });
    const sl = sq.hq.members[0];
    if (sl && commandable(sl)) slots.push({ s: sl, o: squadLeaderSlot(form) });
  }
  if (!slots.length) return;
  // Face the way the leader faces; center the ghost on the unit as it stands.
  const lead = slots[0].s, hd = lead.facing != null ? lead.facing : 0;
  const pts = slots.map(e => ({ s: e.s, w: rotateOffset(e.o.x, e.o.y, hd) }));
  const c = centroid(pts.map(e => e.s)), gx = pts.reduce((n, e) => n + e.w.x, 0) / pts.length, gy = pts.reduce((n, e) => n + e.w.y, 0) / pts.length;
  const r = Math.max(6, Math.min(14, 3 * R.cam.zoom));
  ctx.save();
  for (const e of pts) {
    const p = toScreen(c.x + e.w.x - gx, c.y + e.w.y - gy), q = toScreen(e.s.x, e.s.y);
    ctx.strokeStyle = 'rgba(31,79,191,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.fillStyle = 'rgba(31,79,191,0.32)'; ctx.strokeStyle = 'rgba(31,79,191,0.95)'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.setLineDash([]);
  // An arrow for the direction of march, and the formation's name.
  const f = toScreen(c.x, c.y), L = 40 + 30 * Math.min(2, R.cam.zoom);
  const tx = f.x + Math.cos(hd) * L, ty = f.y + Math.sin(hd) * L;
  ctx.strokeStyle = 'rgba(31,79,191,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(tx, ty);
  ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(hd - 0.4) * 9, ty - Math.sin(hd - 0.4) * 9);
  ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(hd + 0.4) * 9, ty - Math.sin(hd + 0.4) * 9); ctx.stroke();
  ctx.font = '700 13px "Saira Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(247,245,236,0.95)'; ctx.strokeText(FORMATIONS[form].label.toUpperCase(), tx, ty - 14);
  ctx.fillStyle = OVL.blue; ctx.fillText(FORMATIONS[form].label.toUpperCase(), tx, ty - 14);
  ctx.restore();
}

// The unit as a W A S D nudge will leave it: dashed rings with a tick for the new front.
function drawNudge(ctx) {
  const n = Nudge.cur;
  if (!n) return;
  const r = Math.max(6, Math.min(14, 3 * R.cam.zoom)), h = n.heading + n.rot;
  ctx.save();
  ctx.strokeStyle = 'rgba(31,79,191,0.9)'; ctx.fillStyle = 'rgba(128,224,255,0.3)'; ctx.lineWidth = 2;
  for (const t of Nudge.targets(n)) {
    const p = toScreen(t.x, t.y), q = toScreen(t.s.x, t.s.y);
    ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.setLineDash([3, 2]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(h) * r * 1.9, p.y + Math.sin(h) * r * 1.9); ctx.stroke();
  }
  ctx.restore();
}

// Distance and bearing, as a map reader states them: meters, degrees grid and mils.
function tapeLabel(a, b) {
  const d = dist(a.x, a.y, b.x, b.y), brg = bearing(a.x, a.y, b.x, b.y);
  return (d >= 1000 ? (d / 1000).toFixed(2) + ' km' : Math.round(d) + ' m') + ' · ' + pad3(Math.round(brg) % 360) + '° · ' + Math.round(brg * 6400 / 360) % 6400 + ' mils';
}
function drawTape(ctx, a, b, live) {
  const p = toScreen(a.x, a.y), q = toScreen(b.x, b.y), ang = Math.atan2(q.y - p.y, q.x - p.x);
  const nx = -Math.sin(ang) * 6, ny = Math.cos(ang) * 6;
  ctx.strokeStyle = OVL.black; ctx.lineWidth = 1.6; ctx.setLineDash(live ? [6, 4] : []);
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(p.x + nx, p.y + ny); ctx.lineTo(p.x - nx, p.y - ny); ctx.moveTo(q.x + nx, q.y + ny); ctx.lineTo(q.x - nx, q.y - ny); ctx.stroke();
  // Tick every 100 m along the tape when they are far enough apart to read.
  const d = dist(a.x, a.y, b.x, b.y), step = 100 * R.cam.zoom >= 14 ? 100 : 500 * R.cam.zoom >= 14 ? 500 : 0;
  if (step) for (let m = step; m < d; m += step) {
    const t = m / d, x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
    ctx.beginPath(); ctx.moveTo(x + nx * 0.5, y + ny * 0.5); ctx.lineTo(x - nx * 0.5, y - ny * 0.5); ctx.stroke();
  }
  const text = tapeLabel(a, b), mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  ctx.font = '700 12px "Saira Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(247,245,236,0.95)'; ctx.fillRect(mx - w / 2, my - 10, w, 20);
  ctx.strokeStyle = OVL.black; ctx.lineWidth = 1; ctx.strokeRect(mx - w / 2, my - 10, w, 20);
  ctx.fillStyle = OVL.black; ctx.fillText(text, mx, my + 1);
}
function drawTapes(ctx) {
  ctx.save();
  for (const t of G.ui.tapes) drawTape(ctx, t.a, t.b, false);
  if (G.ui.measuring && G.ui.tapeStart) {
    const s = toScreen(G.ui.tapeStart.x, G.ui.tapeStart.y);
    ctx.fillStyle = OVL.black; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill();
    if (G.ui.hover && G.ui.hoverIsPointer) drawTape(ctx, G.ui.tapeStart, G.ui.hover, true);
  }
  ctx.restore();
}

function drawFloaters(ctx) {
  ctx.font = '700 12px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of G.floaters) {
    if (f.side === 'red' && !enemyVisible(G.byId.get(f.id))) continue;
    const p = toScreen(f.x, f.y), a = 1 - f.t / f.life, y = p.y - 26 - f.t * 14;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(247,245,236,' + a + ')';
    ctx.strokeText(f.text, p.x, y);
    ctx.fillStyle = f.side === 'blue' ? 'rgba(31,79,191,' + a + ')' : 'rgba(198,40,40,' + a + ')';
    ctx.fillText(f.text, p.x, y);
  }
}

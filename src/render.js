'use strict';
// Drawing: a pre-rendered map sheet in the style of a military topographic map,
// seen straight down, with units, fire and orders drawn over it each frame.

const R = { canvas: null, ctx: null, w: 0, h: 0, dpr: 1, cam: { x: MAP_W / 2, y: MAP_H / 2, zoom: 4 }, terrain: null, minZoom: 1 };
const PXM = 5; // map sheet pixels per meter
// Collar (margin) around the map body, in meters, holding the marginal information.
const SHEET = { ml: 26, mr: 26, mt: 24, mb: 52 };
const SHEET_W = MAP_W + SHEET.ml + SHEET.mr, SHEET_H = MAP_H + SHEET.mt + SHEET.mb;

function initRender(canvas) {
  R.canvas = canvas;
  R.ctx = canvas.getContext('2d');
  resizeView();
  window.addEventListener('resize', resizeView);
}

function resizeView() {
  const c = R.canvas;
  R.dpr = Math.min(window.devicePixelRatio || 1, 2);
  R.w = c.clientWidth; R.h = c.clientHeight;
  c.width = Math.round(R.w * R.dpr); c.height = Math.round(R.h * R.dpr);
  R.minZoom = Math.min(R.w / SHEET_W, (R.h - 52 - (G.ui.panelH || 150)) / SHEET_H) * 0.95;
  clampCam();
}

// Keep the sheet within the band between the header and the order panel: when it is
// bigger than the band it must cover it (a little table may show at the edges);
// when smaller, it sits centered in it.
function clampCam() {
  const c = R.cam;
  c.zoom = clamp(c.zoom, R.minZoom, 16);
  const slack = 40 / c.zoom;
  const axis = (lo0, hi0, bandLo, bandHi, size) => {
    const lo = lo0 - slack - (bandLo - size / 2) / c.zoom;
    const hi = hi0 + slack - (bandHi - size / 2) / c.zoom;
    return lo <= hi ? [lo, hi] : [(lo + hi) / 2, (lo + hi) / 2];
  };
  const [x0, x1] = axis(-SHEET.ml, MAP_W + SHEET.mr, 0, R.w, R.w);
  const [y0, y1] = axis(-SHEET.mt, MAP_H + SHEET.mb, 52, R.h - (G.ui.panelH || 150), R.h);
  c.x = clamp(c.x, x0, x1); c.y = clamp(c.y, y0, y1);
}

function fitCamera(focus) {
  R.cam.zoom = Math.max(R.minZoom, Math.min(R.w / (R.w < 600 ? 90 : 130), R.h / 100));
  R.cam.x = focus ? focus.x : MAP_W / 2;
  R.cam.y = focus ? focus.y - 25 : MAP_H / 2;
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

// ---------------------------------------------------------------- terrain sheet
// Drawn flat, straight down, in the standard colors of US military topographic maps
// (FM 3-25.26): black for man-made features and the grid, red-brown for contours and
// elevations, green for vegetation. Index contours every 5 m.
const MAPC = {
  paper: [250, 249, 243],
  plowed: [244, 240, 228],
  grass: [228, 240, 206],
  woods: [190, 220, 164],
  woodsEdge: [128, 172, 104],
  contour: [168, 84, 50],
};
const CONTOUR_INTERVAL = 1, INDEX_EVERY = 5;

// Smoothed share of the cells around a point that are of one terrain kind.
function terrainShare(map, mask, x, y) {
  const fx = clamp(x / CELL - 0.5, 0, GW - 1.001), fy = clamp(y / CELL - 0.5, 0, GH - 1.001);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * GW + x0;
  return (mask[i] * (1 - tx) + mask[i + 1] * tx) * (1 - ty) + (mask[i + GW] * (1 - tx) + mask[i + GW + 1] * tx) * ty;
}

function buildTerrain(map) {
  const W = MAP_W * PXM, H = MAP_H * PXM;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H), px = img.data;
  const mask = (k) => { const a = new Float32Array(GW * GH); for (let i = 0; i < a.length; i++) a[i] = map.ter[i] === k ? 1 : 0; return a; };
  const woods = mask(TER.WOODS), grass = mask(TER.GRASS), plowed = mask(TER.PLOWED);
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) elev[y * W + x] = map.elevAt((x + 0.5) / PXM, (y + 0.5) / PXM);
  const level = (e, step) => Math.floor(e / step);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, wx = (x + 0.5) / PXM, wy = (y + 0.5) / PXM;
      let col = MAPC.paper;
      if (terrainShare(map, plowed, wx, wy) > 0.5) col = MAPC.plowed;
      if (terrainShare(map, grass, wx, wy) > 0.5) col = MAPC.grass;
      const w = terrainShare(map, woods, wx, wy);
      if (w > 0.36) col = w < 0.46 ? MAPC.woodsEdge : MAPC.woods;
      let [r, g, b] = col;
      // Contours: ordinary lines one pixel wide, index lines two.
      const e = elev[i];
      const xr = Math.min(W - 1, x + 1), yd = Math.min(H - 1, y + 1);
      const xr2 = Math.min(W - 1, x + 2), yd2 = Math.min(H - 1, y + 2);
      const idx = INDEX_EVERY * CONTOUR_INTERVAL;
      const onIndex = level(e, idx) !== level(elev[y * W + xr2], idx) || level(e, idx) !== level(elev[yd2 * W + x], idx);
      const onLine = level(e, CONTOUR_INTERVAL) !== level(elev[y * W + xr], CONTOUR_INTERVAL) || level(e, CONTOUR_INTERVAL) !== level(elev[yd * W + x], CONTOUR_INTERVAL);
      if (onIndex || onLine) {
        const a = onIndex ? 0.95 : 0.6;
        r = r * (1 - a) + MAPC.contour[0] * a; g = g * (1 - a) + MAPC.contour[1] * a; b = b * (1 - a) + MAPC.contour[2] * a;
      }
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.scale(PXM, PXM);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Tall grass: scattered tufts, the scrub symbol.
  ctx.strokeStyle = '#6f9a52'; ctx.lineWidth = 0.18;
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
    if (map.ter[cy * GW + cx] !== TER.GRASS || (cx * 7 + cy * 13) % 9 !== 0) continue;
    const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
    ctx.beginPath();
    ctx.moveTo(x - 0.5, y - 0.6); ctx.lineTo(x, y); ctx.lineTo(x + 0.5, y - 0.6);
    ctx.moveTo(x, y - 0.8); ctx.lineTo(x, y);
    ctx.moveTo(x - 0.7, y); ctx.lineTo(x + 0.7, y);
    ctx.stroke();
  }

  const pts = [];
  for (let cx = 0; cx < GW; cx++) {
    let s = 0, n = 0;
    for (let k = -3; k <= 3; k++) { const v = map.roadY[clamp(cx + k, 0, GW - 1)]; s += v; n++; }
    pts.push({ x: (cx + 0.5) * CELL, y: Math.floor(s / n / CELL) * CELL + CELL });
  }
  pts.unshift({ x: 0, y: pts[0].y }); pts.push({ x: MAP_W, y: pts[pts.length - 1].y });
  const road = () => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); };
  // Unimproved (dirt) road: dashed black double line.
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 4.2; ctx.setLineDash([3, 1.6]); road();
  ctx.strokeStyle = 'rgb(' + MAPC.paper.join(',') + ')'; ctx.lineWidth = 3.4; ctx.setLineDash([]); road();

  // Stone walls: black line with ticks on one side, traced cell to cell and straightened.
  ctx.strokeStyle = '#1b1b1b';
  for (const line of wallLines(map)) {
    ctx.lineWidth = 0.45;
    ctx.beginPath(); line.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], len = dist(a.x, a.y, b.x, b.y);
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      for (let d = 0.6; d < len; d += 1.2) {
        const tx = a.x + (b.x - a.x) * d / len, ty = a.y + (b.y - a.y) * d / len;
        ctx.moveTo(tx, ty); ctx.lineTo(tx + nx * 0.7, ty + ny * 0.7);
      }
    }
    ctx.stroke();
  }

  // Buildings: solid black.
  ctx.fillStyle = '#161616';
  for (const bd of map.buildings) ctx.fillRect(bd.x0 + 0.2, bd.y0 + 0.2, bd.x1 - bd.x0 - 0.4, bd.y1 - bd.y0 - 0.4);

  // Grid: 100 m squares. Northing lines are counted from the south edge.
  ctx.strokeStyle = 'rgba(10,10,10,0.8)'; ctx.lineWidth = 0.3;
  for (let x = 100; x < MAP_W; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke(); }
  for (let n = 100; n < MAP_H; n += 100) { ctx.beginPath(); ctx.moveTo(0, MAP_H - n); ctx.lineTo(MAP_W, MAP_H - n); ctx.stroke(); }

  // Elevation figures: index contour values and spot heights at hilltops, in meters.
  const base = map.elevBase;
  const halo = (text, x, y, color, size) => {
    ctx.font = '600 ' + size + 'px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(250,249,243,0.95)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  };
  const labels = [];
  const idxStep = INDEX_EVERY * CONTOUR_INTERVAL;
  for (let y = 12; y < MAP_H - 6; y += 7) for (let x = 10; x < MAP_W - 10; x += 7) {
    const e = map.elevAt(x, y), lv = Math.round(e / idxStep) * idxStep;
    if (lv <= 0 || Math.abs(e - lv) > 0.06) continue;
    if (labels.some(l => dist(l.x, l.y, x, y) < 45) || map.terAt(x, y) === TER.BUILDING) continue;
    labels.push({ x, y });
    halo(String(Math.round(base + lv)), x, y, 'rgb(' + MAPC.contour.join(',') + ')', 2.6);
  }
  const peaks = [];
  for (let cy = 4; cy < GH - 4; cy += 2) for (let cx = 4; cx < GW - 4; cx += 2) {
    const e = map.elev[cy * GW + cx];
    let top = true;
    for (let j = -8; j <= 8 && top; j++) for (let i = -8; i <= 8; i++) {
      if (!map.inGrid(cx + i, cy + j) || (!i && !j)) continue;
      if (map.elev[(cy + j) * GW + cx + i] > e) { top = false; break; }
    }
    if (top && !peaks.some(p => dist(p.x, p.y, (cx + 0.5) * CELL, (cy + 0.5) * CELL) < 30)) peaks.push({ x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL, e });
  }
  for (const p of peaks.slice(0, 4)) {
    ctx.fillStyle = 'rgb(' + MAPC.contour.join(',') + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, 0.45, 0, Math.PI * 2); ctx.fill();
    halo(String(Math.round(base + p.e)), p.x + 3.2, p.y - 1.8, 'rgb(' + MAPC.contour.join(',') + ')', 2.4);
  }
  map.peak = peaks.length ? Math.round(base + Math.max(...peaks.map(p => p.e))) : Math.round(base);
  R.terrain = c;
  buildSheet(map, c);
}

// Wall cells joined into chains, then simplified so diagonal walls draw straight.
function wallLines(map) {
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
  // Start at chain ends first so each wall traces in one piece.
  for (const pass of [1, 0]) {
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      if (!isWall(cx, cy) || seen.has(key(cx, cy))) continue;
      if (pass && nbrs(cx, cy).length > 1) continue;
      const pts = trace(cx, cy);
      lines.push(pts.length > 1 ? simplifyLine(pts, 2.2) : [{ x: pts[0].x - 0.6, y: pts[0].y }, { x: pts[0].x + 0.6, y: pts[0].y }]);
    }
  }
  return lines;
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

// 8-digit grid reference (10 m precision) for a map point.
function gridRef(x, y) {
  const e = Math.floor((G.grid.e * 1000 + x) / 10) % 10000;
  const n = Math.floor((G.grid.n * 1000 + (MAP_H - y)) / 10) % 10000;
  return String(e).padStart(4, '0') + ' ' + String(n).padStart(4, '0');
}

// ---------------------------------------------------------------- the printed sheet
// The map body is set into a paper sheet with a collar of marginal information:
// sheet name, grid values, legend, graphic scale, declination diagram. Paper grain
// and fold creases make it read as a physical map on the planning table.
function buildSheet(map, body) {
  const W = SHEET_W * PXM, H = SHEET_H * PXM;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(' + MAPC.paper.join(',') + ')';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(body, SHEET.ml * PXM, SHEET.mt * PXM);

  ctx.save();
  ctx.scale(PXM, PXM);
  ctx.translate(SHEET.ml, SHEET.mt);
  const ink = '#161616', brown = 'rgb(' + MAPC.contour.join(',') + ')';
  const text = (t, x, y, size, opts) => {
    opts = opts || {};
    ctx.font = (opts.weight || 600) + ' ' + size + 'px ' + (opts.serif ? '"Saira Condensed", "Arial Narrow", sans-serif' : '"IBM Plex Mono", ui-monospace, monospace');
    ctx.fillStyle = opts.color || ink;
    ctx.textAlign = opts.align || 'left'; ctx.textBaseline = opts.base || 'alphabetic';
    ctx.fillText(t, x, y);
  };

  // Neatline
  ctx.strokeStyle = ink; ctx.lineWidth = 0.5;
  ctx.strokeRect(0, 0, MAP_W, MAP_H);

  // Grid values in the margin: small leading digit, large principal digits.
  const gridLabel = (v, x, y, align) => {
    const s = String(v).padStart(3, '0');
    ctx.font = '600 1.7px "IBM Plex Mono", monospace';
    const small = ctx.measureText(s[0]).width;
    ctx.font = '700 2.8px "IBM Plex Mono", monospace';
    const big = ctx.measureText(s.slice(1)).width;
    const x0 = align === 'center' ? x - (small + big) / 2 : align === 'right' ? x - small - big : x;
    text(s[0], x0, y - 1, 1.7);
    text(s.slice(1), x0 + small, y, 2.8, { weight: 700 });
  };
  for (let x = 0; x <= MAP_W; x += 100) {
    ctx.lineWidth = 0.3;
    ctx.beginPath(); ctx.moveTo(x, -1.6); ctx.lineTo(x, 0); ctx.moveTo(x, MAP_H); ctx.lineTo(x, MAP_H + 1.6); ctx.stroke();
    const v = G.grid.e * 10 + x / 100;
    gridLabel(v, x, -2.4, 'center');
    gridLabel(v, x, MAP_H + 4.6, 'center');
  }
  for (let n = 0; n <= MAP_H; n += 100) {
    const y = MAP_H - n;
    ctx.beginPath(); ctx.moveTo(-1.6, y); ctx.lineTo(0, y); ctx.moveTo(MAP_W, y); ctx.lineTo(MAP_W + 1.6, y); ctx.stroke();
    const v = G.grid.n * 10 + n / 100;
    gridLabel(v, -2.2, y + 1, 'right');
    gridLabel(v, MAP_W + 2.2, y + 1, 'left');
  }

  // Title block
  text('SQUAD TACTICAL MAP', 0, -12, 2.4, { weight: 700 });
  text('SERIES T25 · EDITION 1', 0, -9, 1.6, { weight: 500 });
  text('HILL ' + map.peak, MAP_W / 2, -10, 5, { weight: 700, serif: true, align: 'center' });
  text('SHEET ' + String(G.settings ? G.settings.seed : 0).padStart(5, '0'), MAP_W, -12, 2.4, { weight: 700, align: 'right' });
  text('1:2 500 TRAINING SHEET', MAP_W, -9, 1.6, { weight: 500, align: 'right' });

  // Legend, bottom left
  const ly = MAP_H + 10;
  text('LEGEND', 0, ly, 1.9, { weight: 700 });
  const rows = [
    ['woods', 'Woods, hedgerow'], ['grass', 'Tall grass, scrub'], ['building', 'Building'], ['wall', 'Stone wall'],
    ['road', 'Unimproved road'], ['index', 'Index contour'], ['contour', 'Contour, 1 m'], ['spot', 'Spot elevation'],
  ];
  rows.forEach(([k, label], i) => {
    const col = Math.floor(i / 4), row = i % 4;
    const x = col * 46, y = ly + 3.6 + row * 4.4;
    ctx.save();
    if (k === 'woods') { ctx.fillStyle = 'rgb(' + MAPC.woods.join(',') + ')'; ctx.fillRect(x, y - 1.2, 7, 2.6); }
    else if (k === 'grass') {
      ctx.fillStyle = 'rgb(' + MAPC.grass.join(',') + ')'; ctx.fillRect(x, y - 1.2, 7, 2.6);
      ctx.strokeStyle = '#6f9a52'; ctx.lineWidth = 0.18;
      ctx.beginPath(); ctx.moveTo(x + 3, y - 0.5); ctx.lineTo(x + 3.5, y + 0.1); ctx.lineTo(x + 4, y - 0.5); ctx.moveTo(x + 2.8, y + 0.1); ctx.lineTo(x + 4.2, y + 0.1); ctx.stroke();
    }
    else if (k === 'building') { ctx.fillStyle = ink; ctx.fillRect(x + 2, y - 1.2, 3, 2.4); }
    else if (k === 'wall') {
      ctx.strokeStyle = ink; ctx.lineWidth = 0.45;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 7, y); ctx.stroke();
      ctx.lineWidth = 0.22; ctx.beginPath();
      for (let t = 0.6; t < 7; t += 1.2) { ctx.moveTo(x + t, y); ctx.lineTo(x + t, y + 0.7); }
      ctx.stroke();
    } else if (k === 'road') {
      ctx.strokeStyle = ink; ctx.lineWidth = 0.22; ctx.setLineDash([1.2, 0.6]);
      ctx.beginPath(); ctx.moveTo(x, y - 0.7); ctx.lineTo(x + 7, y - 0.7); ctx.moveTo(x, y + 0.7); ctx.lineTo(x + 7, y + 0.7); ctx.stroke();
    } else if (k === 'index' || k === 'contour') {
      ctx.strokeStyle = brown; ctx.lineWidth = k === 'index' ? 0.4 : 0.2;
      ctx.beginPath(); ctx.moveTo(x, y + 0.6); ctx.bezierCurveTo(x + 2, y - 1, x + 5, y + 1.5, x + 7, y - 0.4); ctx.stroke();
    } else if (k === 'spot') {
      ctx.fillStyle = brown; ctx.beginPath(); ctx.arc(x + 2, y, 0.45, 0, Math.PI * 2); ctx.fill();
      text(String(map.peak), x + 3, y + 0.7, 1.7, { color: brown });
    }
    ctx.restore();
    text(label, x + 9, y + 0.7, 1.9, { weight: 500, serif: true });
  });

  // Graphic scale, bottom center
  const sx = MAP_W / 2 - 50, sy = MAP_H + 13;
  text('GRAPHIC SCALE', MAP_W / 2, sy - 2.2, 1.7, { weight: 700, align: 'center' });
  ctx.strokeStyle = ink; ctx.lineWidth = 0.2;
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? 'rgb(' + MAPC.paper.join(',') + ')' : ink;
    ctx.fillRect(sx + i * 10, sy, 10, 1.1); ctx.strokeRect(sx + i * 10, sy, 10, 1.1);
  }
  for (let m = 0; m <= 100; m += 20) text(String(m), sx + m, sy + 3.6, 1.6, { align: 'center' });
  text('METERS', sx + 104, sy + 1.2, 1.6, { weight: 700 });
  text('CONTOUR INTERVAL 1 METER', MAP_W / 2, sy + 8, 1.8, { weight: 700, align: 'center' });
  text('ELEVATIONS IN METERS ABOVE MEAN SEA LEVEL', MAP_W / 2, sy + 11, 1.5, { weight: 500, align: 'center' });
  text('GRID: 100 METER SQUARES', MAP_W / 2, sy + 14, 1.5, { weight: 500, align: 'center' });
  text('TO GIVE A GRID REFERENCE: READ RIGHT, THEN UP', MAP_W / 2, sy + 17, 1.5, { weight: 500, align: 'center' });

  // Declination diagram, bottom right
  const dx = MAP_W - 22, dy = MAP_H + 34;
  const gm = map.gmAngle;
  const ray = (deg, len) => ({ x: dx + Math.sin(deg * Math.PI / 180) * len, y: dy - Math.cos(deg * Math.PI / 180) * len });
  ctx.strokeStyle = ink; ctx.lineWidth = 0.25;
  const tn = ray(0, 20), gn = ray(-1.2, 20), mn = ray(gm, 18);
  for (const p of [tn, gn, mn]) { ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  ctx.fillStyle = ink;
  // True north: star. Grid north: GN. Magnetic north: half arrowhead.
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.5 : 1.2; ctx.lineTo(tn.x + Math.cos(a) * rr, tn.y - 0.6 + Math.sin(a) * rr); }
  ctx.fill();
  text('GN', gn.x - 1.2, gn.y - 0.6, 1.6, { weight: 700, align: 'right' });
  ctx.beginPath(); ctx.moveTo(mn.x, mn.y); ctx.lineTo(mn.x + 1.2, mn.y + 2.6); ctx.lineTo(mn.x, mn.y + 2.2); ctx.fill();
  text('MN', mn.x + 1.4, mn.y + 0.5, 1.6, { weight: 700 });
  text(gm.toFixed(1) + '° G-M ANGLE', dx + 9, dy - 4, 1.4, { weight: 500 });
  text('GRID BEARINGS USED', dx + 9, dy - 2, 1.4, { weight: 500 });
  ctx.restore();

  // Paper grain
  const n = document.createElement('canvas');
  n.width = n.height = 256;
  const nctx = n.getContext('2d'), nimg = nctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 120 + Math.random() * 135;
    nimg.data[i * 4] = v; nimg.data[i * 4 + 1] = v * 0.97; nimg.data[i * 4 + 2] = v * 0.9; nimg.data[i * 4 + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = ctx.createPattern(n, 'repeat');
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Fold creases: the sheet was folded in half both ways.
  const crease = (x0, y0, x1, y1, vertical) => {
    const g = vertical ? ctx.createLinearGradient(x0 - 14, 0, x0 + 14, 0) : ctx.createLinearGradient(0, y0 - 14, 0, y0 + 14);
    g.addColorStop(0, 'rgba(60,50,30,0)'); g.addColorStop(0.48, 'rgba(60,50,30,0.07)');
    g.addColorStop(0.5, 'rgba(255,255,250,0.25)'); g.addColorStop(0.53, 'rgba(60,50,30,0.04)'); g.addColorStop(1, 'rgba(60,50,30,0)');
    ctx.fillStyle = g;
    if (vertical) ctx.fillRect(x0 - 14, 0, 28, H); else ctx.fillRect(0, y0 - 14, W, 28);
    ctx.strokeStyle = 'rgba(70,60,40,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  };
  crease(W / 2, 0, W / 2, H, true);
  crease(0, H / 2, W, H / 2, false);
  // Edge wear: slightly darker toward the sheet's edges.
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(120,96,50,0)'); v.addColorStop(1, 'rgba(120,96,50,0.12)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  R.sheet = c;
}

// ---------------------------------------------------------------- frame
// Overlay colors follow US doctrine for graphics on a map overlay:
// blue for friendly, red for enemy, black for fire support targets.
const TEAM_TAG = ['', '1', '2', '3', '4'];
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
  }
  drawEdgeLabels(ctx);
  drawOrdersOverlay(ctx);
  drawContacts(ctx);
  drawProjectiles(ctx);
  drawEffects(ctx);
  drawUnits(ctx);
  drawFloaters(ctx);
  drawScale(ctx);
}

// When the margin is scrolled off screen, repeat the grid values along the screen edge.
function drawEdgeLabels(ctx) {
  ctx.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(248,245,234,0.95)'; ctx.fillStyle = OVL.black;
  const top = 56;
  if (toScreen(0, 0).y < top) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (let x = 100; x < MAP_W; x += 100) {
      const p = toScreen(x, 0), t = String(G.grid.e * 10 + x / 100).padStart(3, '0');
      if (p.x < 4 || p.x > R.w - 30) continue;
      ctx.strokeText(t, p.x + 3, top); ctx.fillText(t, p.x + 3, top);
    }
  }
  const left = R.w > 760 ? 306 : 4;
  if (toScreen(0, 0).x < left) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    for (let n = 100; n < MAP_H; n += 100) {
      const p = toScreen(0, MAP_H - n), t = String(G.grid.n * 10 + n / 100).padStart(3, '0');
      if (p.y < top + 16 || p.y > R.h - 10) continue;
      ctx.strokeText(t, left, p.y - 2); ctx.fillText(t, left, p.y - 2);
    }
  }
}

// Coordinate card: graphic scale at the current zoom and the grid reference under the cursor.
function drawScale(ctx) {
  const z = R.cam.zoom, len = 50 * z;
  const hv = G.ui.hover && G.ui.hoverIsPointer ? G.ui.hover : null;
  const onMap = hv && hv.x >= 0 && hv.y >= 0 && hv.x <= MAP_W && hv.y <= MAP_H;
  const w = Math.max(len + 70, 210), h = onMap ? 46 : 30;
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
  ctx.fillText('50 M', x + 10 + len - 14, y + 14);
  if (onMap) {
    ctx.textBaseline = 'top';
    ctx.fillText('GR ' + gridRef(hv.x, hv.y) + '  ELEV ' + Math.round(G.map.elevBase + G.map.elevAt(hv.x, hv.y)) + ' M', x + 10, y + 26);
  }
}

function unitRadius() { return clamp(R.cam.zoom * 1.6, 10, 17); }

function enemyVisible(e) {
  const k = G.known.blue.get(e.id);
  return G.revealAll || (k && k.visible);
}

const PIECE_EDGE = { blue: '#3a7d96', red: '#a14646' };

// A game piece: a thick disc with the billet symbol printed on its face.
// Picked-up (selected) pieces are lifted off the map and throw a longer shadow.
function drawPiece(ctx, s, p, r, lifted) {
  const th = Math.max(2, r * 0.22), lift = lifted ? 4 : 0, y = p.y - lift;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3 + lift * 2;
  ctx.shadowOffsetX = 1.5 + lift * 0.8; ctx.shadowOffsetY = 2 + lift * 1.2;
  ctx.fillStyle = PIECE_EDGE[s.side];
  ctx.beginPath(); ctx.arc(p.x, y + th, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = PIECE_EDGE[s.side];
  ctx.fillRect(p.x - r, y, r * 2, th);
  drawSymbol(ctx, p.x, y, r, s.billet, { side: s.side });
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(p.x, y, r - 2.2, Math.PI * 1.08, Math.PI * 1.55); ctx.stroke();
  return y;
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
  const list = G.soldiers.filter(s => !s.routed && (s.side === 'blue' || enemyVisible(s)));
  list.sort((a, b) => (a.alive ? 1 : 0) - (b.alive ? 1 : 0) || (sel.has(a) ? 1 : 0) - (sel.has(b) ? 1 : 0) || a.y - b.y);
  const chit = Math.max(9, r * 0.7);
  for (const s of list) {
    const p = toScreen(s.x, s.y);
    if (p.x < -40 || p.y < -40 || p.x > R.w + 40 || p.y > R.h + 40) continue;
    const down = !s.active, lifted = sel.has(s) && !down;
    // Grease-pencil ring on the map around picked-up pieces.
    if (sel.has(s)) {
      ctx.strokeStyle = OVL.blue; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(p.x + 0.5, p.y + 1, r + 6, 0, Math.PI * 2); ctx.stroke();
    }
    // Facing: a notch on the map at the piece's front.
    if (!down) {
      const a = s.facing, tip = r + 8;
      ctx.fillStyle = s.side === 'blue' ? OVL.blue : OVL.red;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * tip, p.y + Math.sin(a) * tip);
      ctx.lineTo(p.x + Math.cos(a + 0.32) * (r + 2), p.y + Math.sin(a + 0.32) * (r + 2));
      ctx.lineTo(p.x + Math.cos(a - 0.32) * (r + 2), p.y + Math.sin(a - 0.32) * (r + 2));
      ctx.closePath(); ctx.fill();
    }
    const y = drawPiece(ctx, s, p, r, lifted);
    // Operational condition (MIL-STD-2525): slash for a casualty, X for killed.
    if (down) {
      ctx.strokeStyle = OVL.black; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      const k = r + 4;
      ctx.beginPath(); ctx.moveTo(p.x - k, y + k); ctx.lineTo(p.x + k, y - k);
      if (s.health === 'kia') { ctx.moveTo(p.x - k, y - k); ctx.lineTo(p.x + k, y + k); }
      ctx.stroke();
      continue;
    }
    // Unique designation (fire team) to the right of the frame.
    if (s.team.num) {
      ctx.font = '700 ' + Math.round(r * 0.9) + 'px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(248,245,234,0.95)';
      ctx.strokeText(TEAM_TAG[s.team.num], p.x + r + 3, y - r * 0.55);
      ctx.fillStyle = s.side === 'blue' ? OVL.blue : OVL.red;
      ctx.fillText(TEAM_TAG[s.team.num], p.x + r + 3, y - r * 0.55);
    }
    // Status chits stacked at the lower right: posture, then suppression, wounds, ammunition.
    const chits = [[POSTURE[s.posture].short, '#f3eedc', OVL.black]];
    if (s.pinned) chits.push(['PIN', '#b3261e', '#fff']);
    else if (s.suppressed) chits.push(['SUP', '#e8871e', '#1b1405']);
    if (s.health === 'light') chits.push(['WIA', '#fff', '#b3261e']);
    if (s.side === 'blue' && s.inMag + s.mags === 0) chits.push(['AMO', '#ffd60a', OVL.black]);
    chits.forEach(([label, bg, fg], i) => drawChit(ctx, p.x + r * 0.35 + i * 3, y + r * 0.45 + i * (chit * 0.62), chit, label, bg, fg));
  }
}

// Last known enemy positions: the symbol in a dashed frame (suspected), in red ink.
function drawContacts(ctx) {
  if (G.revealAll) return;
  const r = unitRadius();
  for (const k of G.known.blue.values()) {
    if (k.visible) continue;
    const e = G.byId.get(k.id);
    if (!e || !e.active) continue;
    const age = G.time - k.t;
    const p = toScreen(k.x, k.y);
    ctx.save();
    ctx.globalAlpha = clamp(1 - age / 50, 0.3, 0.9);
    drawSymbol(ctx, p.x, p.y, r, k.billet, { fill: 'rgba(255,255,255,0)', ink: OVL.red, dashed: true });
    ctx.restore();
  }
}

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
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(248,245,234,0.95)';
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
    const p = toScreen(c.dest.x, c.dest.y), rr = 16 * R.cam.zoom;
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
    const p = toScreen(s.x, s.y), L = 35 * R.cam.zoom;
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
    } else if (e.type === 'flash') {
      const p = toScreen(e.x, e.y);
      ctx.fillStyle = 'rgba(232,135,30,' + (1 - f) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4 + 5 * f, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'blast') {
      const p = toScreen(e.x, e.y), rr = (2 + e.r * 0.6 * Math.sqrt(f)) * z;
      ctx.fillStyle = 'rgba(232,135,30,' + (0.75 * (1 - f)) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, rr * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(22,22,22,' + (0.7 * (1 - f)) + ')'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function drawFloaters(ctx) {
  ctx.font = '700 12px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of G.floaters) {
    if (f.side === 'red' && !enemyVisible(G.byId.get(f.id))) continue;
    const p = toScreen(f.x, f.y), a = 1 - f.t / f.life, y = p.y - 26 - f.t * 14;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(248,245,234,' + a + ')';
    ctx.strokeText(f.text, p.x, y);
    ctx.fillStyle = f.side === 'blue' ? 'rgba(31,79,191,' + a + ')' : 'rgba(198,40,40,' + a + ')';
    ctx.fillText(f.text, p.x, y);
  }
}

'use strict';
// Drawing: a pre-rendered map sheet in the style of a military topographic map,
// seen straight down, with units, fire and orders drawn over it each frame.

const R = { canvas: null, ctx: null, w: 0, h: 0, dpr: 1, cam: { x: MAP_W / 2, y: MAP_H / 2, zoom: 4 }, terrain: null, minZoom: 1 };
const PXM = 5; // map sheet pixels per meter

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
  R.minZoom = Math.min(R.w / MAP_W, R.h / MAP_H) * 0.9;
  clampCam();
}

function clampCam() {
  const c = R.cam;
  c.zoom = clamp(c.zoom, R.minZoom, 16);
  c.x = clamp(c.x, 0, MAP_W); c.y = clamp(c.y, 0, MAP_H);
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
// Drawn flat, straight down, as a military topographic map: white paper, green
// vegetation tint, brown contours with index contours every 5 m, black man-made
// features and a black 100 m grid.
const MAPC = {
  paper: [250, 249, 243],
  plowed: [244, 240, 228],
  grass: [228, 240, 206],
  woods: [190, 220, 164],
  woodsEdge: [128, 172, 104],
  contour: [156, 96, 44],
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

  // Unimproved road: black double line.
  const pts = [];
  for (let cx = 0; cx < GW; cx++) {
    let s = 0, n = 0;
    for (let k = -3; k <= 3; k++) { const v = map.roadY[clamp(cx + k, 0, GW - 1)]; s += v; n++; }
    pts.push({ x: (cx + 0.5) * CELL, y: Math.floor(s / n / CELL) * CELL + CELL });
  }
  pts.unshift({ x: 0, y: pts[0].y }); pts.push({ x: MAP_W, y: pts[pts.length - 1].y });
  const road = () => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); };
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 4.4; road();
  ctx.strokeStyle = '#fbf6e6'; ctx.lineWidth = 3.6; road();

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

  // Grid: 100 m lines heavy, 50 m lines light. Northing lines are counted from the south edge.
  for (let x = 0; x <= MAP_W; x += 50) {
    ctx.strokeStyle = x % 100 === 0 ? 'rgba(10,10,10,0.75)' : 'rgba(10,10,10,0.25)';
    ctx.lineWidth = x % 100 === 0 ? 0.32 : 0.16;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke();
  }
  for (let n = 0; n <= MAP_H; n += 50) {
    const y = MAP_H - n;
    ctx.strokeStyle = n % 100 === 0 ? 'rgba(10,10,10,0.75)' : 'rgba(10,10,10,0.25)';
    ctx.lineWidth = n % 100 === 0 ? 0.32 : 0.16;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke();
  }

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
    ctx.fillStyle = '#161616';
    ctx.beginPath(); ctx.arc(p.x, p.y, 0.45, 0, Math.PI * 2); ctx.fill();
    halo(String(Math.round(base + p.e)), p.x + 3.2, p.y - 1.8, '#161616', 2.4);
  }
  R.terrain = c;
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

// ---------------------------------------------------------------- frame
const TEAM_TAG = ['', '1', '2', '3', '4'];

function render() {
  const ctx = R.ctx, z = R.cam.zoom;
  ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  ctx.fillStyle = '#1d2119';
  ctx.fillRect(0, 0, R.w, R.h);
  const o = toScreen(0, 0);
  ctx.imageSmoothingEnabled = true;
  if (R.terrain) ctx.drawImage(R.terrain, o.x, o.y, MAP_W * z, MAP_H * z);

  drawEdgeLabels(ctx);
  drawOrdersOverlay(ctx);
  drawContacts(ctx);
  drawUnits(ctx);
  drawProjectiles(ctx);
  drawEffects(ctx);
  drawFloaters(ctx);
  drawScale(ctx);
}

// Grid line numbers along the top and left edges, as printed in a map's margin.
function drawEdgeLabels(ctx) {
  ctx.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(250,249,243,0.95)'; ctx.fillStyle = '#161616';
  const top = 52 + 4;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (let x = 0; x <= MAP_W; x += 100) {
    const p = toScreen(x, 0), t = String(G.grid.e * 10 + x / 100).padStart(3, '0');
    if (p.x < 4 || p.x > R.w - 30) continue;
    const y = Math.max(top, p.y + 3);
    ctx.strokeText(t, p.x + 3, y); ctx.fillText(t, p.x + 3, y);
  }
  ctx.textBaseline = 'bottom';
  const left = document.body.classList.contains('roster-open') || R.w > 760 ? 310 : 4;
  for (let n = 0; n <= MAP_H; n += 100) {
    const p = toScreen(0, MAP_H - n), t = String(G.grid.n * 10 + n / 100).padStart(3, '0');
    if (p.y < top + 16 || p.y > R.h - 10) continue;
    const x = Math.max(left, p.x + 3);
    ctx.strokeText(t, x, p.y - 2); ctx.fillText(t, x, p.y - 2);
  }
}

// Scale bar and marginal data, with the grid reference under the cursor.
function drawScale(ctx) {
  const z = R.cam.zoom, len = 50 * z;
  const hv = G.ui.hover && G.ui.hoverIsPointer ? G.ui.hover : null;
  const w = Math.max(len + 50, 230);
  const x = Math.max(14, R.w - w - 6), y = R.h - (G.ui.panelH || 0) - (hv ? 52 : 40);
  ctx.fillStyle = 'rgba(250,249,243,0.92)';
  ctx.strokeStyle = '#161616'; ctx.lineWidth = 1;
  ctx.fillRect(x - 8, y - 18, w, hv ? 58 : 46);
  ctx.strokeRect(x - 8, y - 18, w, hv ? 58 : 46);
  ctx.fillStyle = '#161616';
  ctx.fillRect(x, y - 3, len / 2, 5);
  ctx.strokeStyle = '#161616'; ctx.lineWidth = 1;
  ctx.strokeRect(x, y - 3, len, 5);
  ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('0', x - 3, y - 5);
  ctx.fillText('50 METERS', x + len - 30, y - 5);
  ctx.textBaseline = 'top';
  ctx.fillText('GRID 100 M · CONTOUR INTERVAL ' + CONTOUR_INTERVAL + ' M', x, y + 8);
  if (hv && hv.x >= 0 && hv.y >= 0 && hv.x <= MAP_W && hv.y <= MAP_H) {
    ctx.fillText('GR ' + gridRef(hv.x, hv.y) + '  ELEV ' + Math.round(G.map.elevBase + G.map.elevAt(hv.x, hv.y)) + ' M', x, y + 22);
  }
}

function unitRadius() { return clamp(R.cam.zoom * 1.5, 9, 15); }

function enemyVisible(e) {
  const k = G.known.blue.get(e.id);
  return G.revealAll || (k && k.visible);
}

function drawUnits(ctx) {
  const r = unitRadius();
  const sel = new Set(selMembers(G.ui.sel));
  const list = G.soldiers.filter(s => !s.routed && (s.side === 'blue' || enemyVisible(s)));
  list.sort((a, b) => (a.alive ? 1 : 0) - (b.alive ? 1 : 0) || a.y - b.y);
  for (const s of list) {
    const p = toScreen(s.x, s.y);
    if (p.x < -30 || p.y < -30 || p.x > R.w + 30 || p.y > R.h + 30) continue;
    const down = !s.active;
    if (sel.has(s)) {
      ctx.strokeStyle = '#161616'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.stroke();
    }
    if (!down) {
      // Facing tick
      ctx.strokeStyle = 'rgba(12,16,10,0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(s.facing) * (r + 1), p.y + Math.sin(s.facing) * (r + 1));
      ctx.lineTo(p.x + Math.cos(s.facing) * (r + 8), p.y + Math.sin(s.facing) * (r + 8));
      ctx.stroke();
      // Suppression ring
      if (s.supp > 8) {
        ctx.strokeStyle = s.pinned ? '#ff3b30' : s.suppressed ? '#ff8c1a' : 'rgba(255,190,80,0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.supp / 100); ctx.stroke();
      }
    }
    drawSymbol(ctx, p.x, p.y, r, s.billet, {
      side: s.side, prone: s.posture === 'prone',
      fill: down ? '#9a9d96' : undefined, alpha: s.health === 'kia' ? 0.55 : 1,
    });
    if (down) {
      ctx.strokeStyle = s.health === 'kia' ? '#2a2a2a' : '#c0392b'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(p.x - r - 3, p.y); ctx.lineTo(p.x + r + 3, p.y); ctx.stroke();
      continue;
    }
    // Posture bar to the left: tall standing, half kneeling, flat prone.
    const ph = s.posture === 'stand' ? r * 1.4 : s.posture === 'kneel' ? r * 0.8 : 3;
    const pw = s.posture === 'prone' ? 9 : 3.5;
    ctx.fillStyle = '#10140e';
    ctx.fillRect(p.x - r - 8 - pw / 2, p.y + r - ph, pw, ph);
    // Team number, top right.
    if (s.team.num) {
      ctx.font = '700 ' + Math.round(r * 0.85) + 'px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,12,8,0.85)';
      ctx.strokeText(TEAM_TAG[s.team.num], p.x + r * 0.75, p.y - r * 0.85);
      ctx.fillStyle = '#f4f1e4';
      ctx.fillText(TEAM_TAG[s.team.num], p.x + r * 0.75, p.y - r * 0.85);
    }
    if (s.health === 'light') {
      ctx.fillStyle = '#e53935';
      ctx.beginPath(); ctx.arc(p.x + r * 0.8, p.y + r * 0.8, 3.2, 0, Math.PI * 2); ctx.fill();
    }
    if (s.side === 'blue' && s.inMag + s.mags === 0) {
      ctx.fillStyle = '#ffe066'; ctx.font = '700 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center'; ctx.fillText('NO AMMO', p.x, p.y + r + 10);
    }
  }
}

function drawContacts(ctx) {
  if (G.revealAll) return;
  const r = unitRadius() * 0.8;
  for (const k of G.known.blue.values()) {
    if (k.visible) continue;
    const e = G.byId.get(k.id);
    if (!e || !e.active) continue;
    const age = G.time - k.t, a = clamp(1 - age / 45, 0.15, 0.8);
    const p = toScreen(k.x, k.y);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#c62828'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#b91c1c'; ctx.font = '700 ' + Math.round(r) + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', p.x, p.y + 1);
    ctx.restore();
  }
}

function drawOrdersOverlay(ctx) {
  const sel = G.ui.sel;
  // Planned routes for the selection.
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.5;
  for (const s of selMembers(sel)) {
    if (!s.active || !s.path.length) continue;
    ctx.strokeStyle = s.moveMode === 'rush' ? 'rgba(194,65,12,0.95)' : s.moveMode === 'crawl' ? 'rgba(14,116,144,0.95)' : 'rgba(29,78,216,0.9)';
    ctx.beginPath();
    let p = toScreen(s.x, s.y); ctx.moveTo(p.x, p.y);
    for (const w of s.path) { p = toScreen(w.x, w.y); ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Suppression targets.
  for (const s of selMembers(sel)) {
    if (!s.active || !s.suppressPt) continue;
    const a = toScreen(s.x, s.y), b = toScreen(s.suppressPt.x, s.suppressPt.y);
    ctx.strokeStyle = 'rgba(220,80,20,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,80,20,0.95)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, 7 * R.cam.zoom / 2, 0, Math.PI * 2); ctx.stroke();
  }
  // Pending order: line to the cursor with range and bearing.
  const pend = G.ui.pending, hv = G.ui.hover;
  if (sel && hv) {
    const m = selMembers(sel).filter(s => s.active);
    if (!m.length) return;
    const c = centroid(m), a = toScreen(c.x, c.y), b = toScreen(hv.x, hv.y);
    if (pend === 'launcher' || pend === 'frag') {
      const gs = pend === 'launcher' ? m.filter(s => s.launcher) : m;
      for (const s of gs.slice(0, 3)) {
        const sp = toScreen(s.x, s.y);
        const max = pend === 'launcher' ? s.launcher.range : s.grenade.range;
        ctx.strokeStyle = 'rgba(194,65,12,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, max * R.cam.zoom, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (!pend && !G.ui.hoverIsPointer) return;
    ctx.strokeStyle = pend ? 'rgba(194,65,12,0.95)' : 'rgba(22,22,22,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    const d = Math.round(dist(c.x, c.y, hv.x, hv.y));
    const label = (pend ? ORDER_LABEL[pend] + '  ' : '') + d + ' m  ' + pad3(bearing(c.x, c.y, hv.x, hv.y)) + '°';
    ctx.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(14,16,12,0.8)';
    ctx.fillRect(b.x + 12, b.y - 22, tw + 12, 20);
    ctx.fillStyle = '#ffe066'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x + 18, b.y - 12);
  }
}

function drawProjectiles(ctx) {
  for (const p of G.projectiles) {
    const f = Math.min(1, p.t / p.flight);
    const x = lerp(p.x0, p.x1, f), y = lerp(p.y0, p.y1, f);
    const s = toScreen(x, y);
    ctx.fillStyle = p.kind === 'frag' ? '#2c3a22' : '#1a1a1a';
    ctx.strokeStyle = '#f4f1e4'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, p.kind === 'frag' ? 3 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (p.kind === 'rpg' && f < 1) {
      const t = toScreen(lerp(p.x0, p.x1, Math.max(0, f - 0.15)), lerp(p.y0, p.y1, Math.max(0, f - 0.15)));
      ctx.strokeStyle = 'rgba(90,90,90,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
  }
}

// Tracers: Marine ammunition burns red-orange, the enemy's green.
function drawEffects(ctx) {
  const z = R.cam.zoom;
  for (const e of G.effects) {
    if (e.t < 0) continue;
    const f = e.t / e.life;
    if (e.type === 'tracer') {
      const h = clamp(f * 1.3, 0, 1), tl = clamp(f * 1.3 - 0.35, 0, 1);
      const a = toScreen(lerp(e.x1, e.x2, tl), lerp(e.y1, e.y2, tl)), b = toScreen(lerp(e.x1, e.x2, h), lerp(e.y1, e.y2, h));
      ctx.strokeStyle = e.side === 'blue' ? 'rgba(220,38,38,0.95)' : 'rgba(22,163,74,0.95)';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (e.type === 'flash') {
      const p = toScreen(e.x, e.y);
      ctx.fillStyle = 'rgba(245,158,11,' + (1 - f) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 + 6 * f, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'blast') {
      const p = toScreen(e.x, e.y);
      const rr = (2 + e.r * 0.6 * Math.sqrt(f)) * z;
      ctx.fillStyle = 'rgba(255,' + (180 - 120 * f | 0) + ',60,' + (0.85 * (1 - f)) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, rr * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(70,64,56,' + (0.45 * (1 - f)) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawFloaters(ctx) {
  ctx.font = '700 12px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of G.floaters) {
    if (f.side === 'red' && !enemyVisible(G.byId.get(f.id))) continue;
    const p = toScreen(f.x, f.y);
    const a = 1 - f.t / f.life;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,10,8,' + a + ')';
    ctx.strokeText(f.text, p.x, p.y - 22 - f.t * 14);
    ctx.fillStyle = f.side === 'blue' ? 'rgba(255,214,102,' + a + ')' : 'rgba(255,170,170,' + a + ')';
    ctx.fillText(f.text, p.x, p.y - 22 - f.t * 14);
  }
}

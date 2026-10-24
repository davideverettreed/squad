'use strict';
// Drawing: a pre-rendered 2.5D terrain sheet (hill shading, contours, extruded
// buildings, walls and trees), with units, fire and orders drawn over it each frame.

const R = { canvas: null, ctx: null, w: 0, h: 0, dpr: 1, cam: { x: MAP_W / 2, y: MAP_H / 2, zoom: 4 }, terrain: null, minZoom: 1 };
const PXM = 5;     // terrain sheet pixels per meter
const TILT = 0.55; // screen rise per meter of height, for the oblique 2.5D look

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
const GROUND = [
  [126, 144, 86],  // open
  [152, 156, 84],  // tall grass
  [70, 88, 54],    // woods floor
  [178, 160, 122], // road
  [96, 92, 86],    // building footprint
  [128, 140, 90],  // under a wall
  [124, 100, 72],  // plowed
];

function buildTerrain(map) {
  const W = MAP_W * PXM, H = MAP_H * PXM;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H), px = img.data;
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) elev[y * W + x] = map.elevAt((x + 0.5) / PXM, (y + 0.5) / PXM);
  const L = [-0.55, -0.6, 0.58];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, wx = (x + 0.5) / PXM, wy = (y + 0.5) / PXM;
      const k = map.terAt(wx, wy);
      let [r, g, b] = GROUND[k];
      const n = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 10;
      r += n; g += n; b += n * 0.6;
      if (k === TER.PLOWED && (wx * 0.9 + wy * 0.2) % 1.4 < 0.45) { r -= 16; g -= 14; b -= 10; }
      if (k === TER.GRASS && (x * 7 + y * 3) % 11 === 0) { r += 14; g += 12; }
      if (k === TER.ROAD) { const e = Math.abs(((wy - map.roadY[Math.floor(wx / CELL)] || 0)) - 2); if (e > 1.6) { r -= 14; g -= 14; b -= 12; } }
      const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
      const ex = (elev[y * W + xr] - elev[y * W + xl]) * PXM / 2, ey = (elev[yd * W + x] - elev[yu * W + x]) * PXM / 2;
      const nl = Math.hypot(ex, ey, 1);
      const shade = 0.82 + 0.45 * ((-ex * L[0] - ey * L[1] + L[2]) / nl - 0.58);
      r *= shade; g *= shade; b *= shade;
      // Contour every meter of elevation, heavier every five.
      const e0 = elev[i], f0 = Math.floor(e0);
      if (Math.floor(elev[y * W + xr]) !== f0 || Math.floor(elev[yd * W + x]) !== f0) {
        const heavy = Math.floor(Math.max(elev[y * W + xr], elev[yd * W + x])) % 5 === 0;
        const a = heavy ? 0.55 : 0.3;
        r = r * (1 - a) + 92 * a; g = g * (1 - a) + 64 * a; b = b * (1 - a) + 34 * a;
      }
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.scale(PXM, PXM);

  // 50 m grid
  ctx.strokeStyle = 'rgba(20,24,16,0.22)';
  ctx.lineWidth = 0.25;
  for (let x = 50; x < MAP_W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke(); }
  for (let y = 50; y < MAP_H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke(); }

  // Extruded features, drawn back to front.
  const items = [];
  const isWall = (cx, cy) => map.inGrid(cx, cy) && map.ter[cy * GW + cx] === TER.WALL;
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
    if (!isWall(cx, cy)) continue;
    // Join each wall cell to its neighbors; a diagonal only where no corner cell already joins them.
    const links = [];
    if (isWall(cx + 1, cy)) links.push([1, 0]);
    if (isWall(cx, cy + 1)) links.push([0, 1]);
    if (isWall(cx + 1, cy + 1) && !isWall(cx + 1, cy) && !isWall(cx, cy + 1)) links.push([1, 1]);
    if (isWall(cx - 1, cy + 1) && !isWall(cx - 1, cy) && !isWall(cx, cy + 1)) links.push([-1, 1]);
    const lone = !links.length && !isWall(cx - 1, cy) && !isWall(cx, cy - 1) && !isWall(cx - 1, cy - 1) && !isWall(cx + 1, cy - 1);
    const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
    for (const [dx, dy] of links) items.push({ y: y + dy * CELL, kind: 'wall', x1: x, y1: y, x2: x + dx * CELL, y2: y + dy * CELL });
    if (lone) items.push({ y, kind: 'wall', x1: x - 0.5, y1: y, x2: x + 0.5, y2: y });
  }
  for (const b of map.buildings) items.push({ y: b.y1, kind: 'building', b });
  for (const t of map.trees) items.push({ y: t.y, kind: 'tree', t });
  items.sort((a, b) => a.y - b.y);

  // Shadows first so they never fall across a roof.
  for (const it of items) {
    if (it.kind === 'building') {
      const b = it.b, s = b.height * 0.45;
      ctx.fillStyle = 'rgba(18,20,14,0.35)';
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y0); ctx.lineTo(b.x1 + s, b.y0 + s * 0.7); ctx.lineTo(b.x1 + s, b.y1 + s * 0.7);
      ctx.lineTo(b.x0 + s, b.y1 + s * 0.7); ctx.lineTo(b.x0, b.y1); ctx.closePath(); ctx.fill();
    } else if (it.kind === 'tree') {
      const t = it.t;
      ctx.fillStyle = 'rgba(18,24,12,0.32)';
      ctx.beginPath(); ctx.ellipse(t.x + t.h * 0.22, t.y + t.h * 0.12, t.r * 1.05, t.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const it of items) {
    if (it.kind === 'wall') {
      const h = 1.0 * TILT;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(18,20,14,0.3)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(it.x1 + 0.5, it.y1 + 0.4); ctx.lineTo(it.x2 + 0.5, it.y2 + 0.4); ctx.stroke();
      ctx.strokeStyle = '#6c665b'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke();
      ctx.strokeStyle = '#b4ad9c'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(it.x1, it.y1 - h); ctx.lineTo(it.x2, it.y2 - h); ctx.stroke();
      ctx.strokeStyle = 'rgba(90,84,72,0.6)'; ctx.lineWidth = 0.25; ctx.setLineDash([0.5, 0.9]);
      ctx.beginPath(); ctx.moveTo(it.x1, it.y1 - h); ctx.lineTo(it.x2, it.y2 - h); ctx.stroke();
      ctx.setLineDash([]);
    } else if (it.kind === 'building') {
      const b = it.b, h = b.height * TILT, w = b.x1 - b.x0, d = b.y1 - b.y0;
      ctx.fillStyle = '#b3a993'; ctx.fillRect(b.x0, b.y1 - h, w, h);
      ctx.fillStyle = 'rgba(40,36,30,0.55)';
      for (let x = b.x0 + 2; x < b.x1 - 1.5; x += 3.2) ctx.fillRect(x, b.y1 - h * 0.62, 1.1, h * 0.3);
      ctx.fillStyle = b.roof; ctx.fillRect(b.x0, b.y0 - h, w, d);
      ctx.strokeStyle = 'rgba(20,16,12,0.5)'; ctx.lineWidth = 0.25;
      if (w >= d) { ctx.beginPath(); ctx.moveTo(b.x0 + 0.5, b.y0 - h + d / 2); ctx.lineTo(b.x1 - 0.5, b.y0 - h + d / 2); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(b.x0 + w / 2, b.y0 - h + 0.5); ctx.lineTo(b.x0 + w / 2, b.y1 - h - 0.5); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(b.x0, b.y0 - h, w, w >= d ? d / 2 : d);
      ctx.strokeStyle = 'rgba(20,16,12,0.7)'; ctx.lineWidth = 0.3;
      ctx.strokeRect(b.x0, b.y0 - h, w, d + h);
    } else {
      const t = it.t, cy = t.y - t.h * TILT * 0.55;
      const g = 70 + t.tone * 12;
      ctx.fillStyle = 'rgb(' + (g * 0.55 | 0) + ',' + (g + 18 | 0) + ',' + (g * 0.45 | 0) + ')';
      ctx.beginPath(); ctx.arc(t.x, cy, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(190,220,140,0.16)';
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, cy - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }
  R.terrain = c;
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

function drawEdgeLabels(ctx) {
  ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(240,236,220,0.75)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = 0; x <= MAP_W; x += 50) {
    const p = toScreen(x, 0);
    if (p.x > 20 && p.x < R.w - 20) ctx.fillText(String(G.grid.e + x / 50).padStart(2, '0'), p.x, Math.max(4, p.y + 4));
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let y = 0; y <= MAP_H; y += 50) {
    const p = toScreen(0, y);
    if (p.y > 40 && p.y < R.h - 20) ctx.fillText(String(G.grid.n - y / 50).padStart(2, '0'), Math.max(4, p.x + 4), p.y);
  }
}

function drawScale(ctx) {
  const z = R.cam.zoom, len = 50 * z;
  const x = 14, y = R.h - (G.ui.panelH || 0) - 22;
  ctx.fillStyle = 'rgba(16,18,14,0.6)';
  ctx.fillRect(x - 6, y - 16, len + 50, 28);
  ctx.strokeStyle = '#f0ecdc'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
  ctx.moveTo(x + len / 2, y - 3); ctx.lineTo(x + len / 2, y + 3); ctx.moveTo(x + len, y - 4); ctx.lineTo(x + len, y + 4); ctx.stroke();
  ctx.fillStyle = '#f0ecdc'; ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('50 m', x + len + 6, y + 5);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('N ↑', x, y - 6);
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
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2.5;
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
    ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd6d6'; ctx.font = '700 ' + Math.round(r) + 'px "IBM Plex Mono", monospace';
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
    ctx.strokeStyle = s.moveMode === 'rush' ? 'rgba(255,224,102,0.9)' : s.moveMode === 'crawl' ? 'rgba(160,220,255,0.9)' : 'rgba(255,255,255,0.85)';
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
    ctx.strokeStyle = 'rgba(255,120,60,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,120,60,0.9)'; ctx.lineWidth = 1.5;
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
        ctx.strokeStyle = 'rgba(255,224,102,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, max * R.cam.zoom, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (!pend && !G.ui.hoverIsPointer) return;
    ctx.strokeStyle = pend ? 'rgba(255,224,102,0.9)' : 'rgba(255,255,255,0.4)';
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
    const arc = p.kind === 'rpg' ? 0 : Math.sin(f * Math.PI) * (p.kind === 'frag' ? 4 : 10);
    const s = toScreen(x, y - arc * TILT);
    ctx.fillStyle = p.kind === 'frag' ? '#2c3a22' : '#1a1a1a';
    ctx.strokeStyle = '#f4f1e4'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, p.kind === 'frag' ? 3 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (p.kind === 'rpg' && f < 1) {
      const t = toScreen(lerp(p.x0, p.x1, Math.max(0, f - 0.15)), lerp(p.y0, p.y1, Math.max(0, f - 0.15)));
      ctx.strokeStyle = 'rgba(230,230,220,0.6)'; ctx.lineWidth = 3;
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
      ctx.strokeStyle = e.side === 'blue' ? 'rgba(255,120,70,0.95)' : 'rgba(140,255,120,0.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (e.type === 'flash') {
      const p = toScreen(e.x, e.y);
      ctx.fillStyle = 'rgba(255,230,150,' + (1 - f) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 + 6 * f, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'blast') {
      const p = toScreen(e.x, e.y);
      const rr = (2 + e.r * 0.6 * Math.sqrt(f)) * z;
      ctx.fillStyle = 'rgba(255,' + (180 - 120 * f | 0) + ',60,' + (0.85 * (1 - f)) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, rr * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(70,64,56,' + (0.55 * (1 - f)) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y - f * 8, rr, 0, Math.PI * 2); ctx.fill();
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

'use strict';
// The sand table: the map sheet laid over a 3D model of the ground, heights exaggerated as
// on a real sand table, with the plan, the fog of war, the cones and the pieces drawn on
// it. Each man stands on it as a peg with his billet symbol above, sized to stay readable
// as the camera pulls back. Drag to pan, right-drag (or two fingers) to turn and tilt,
// wheel or pinch to zoom. Taps give the same orders as on the flat map; while planning,
// control measures can be placed and dragged here too.

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const DRAPE = 2048;      // pixels across the texture laid on the ground
const DRAPE_RATE = 0.12; // seconds between redraws of the plan, fog and pieces

const View3D = {
  active: false, built: false, mapRef: null, canvas: null,
  renderer: null, scene: null, camera: null, terrain: null, skirt: null, texture: null,
  drape: null, base: null, exag: 2, drapeT: 0,
  cam: { x: 500, y: 500, yaw: 0, pitch: 0.9, dist: 700 },
  pointers: new Map(), drag: null, pegs: new Map(), lost: [], symTex: new Map(), dragG: null,

  // ------------------------------------------------------------ opening and closing
  toggle() { if (this.active) this.close(); else this.open(); },

  open() {
    if (!G.running || !G.map) return;
    const go = () => withLoading('Building the sand table…', () => {
      try {
        if (!this.built) this.build();
        if (this.mapRef !== G.map) this.newMap();
        this.active = true;
        document.body.classList.add('view3d');
        this.canvas.hidden = false;
        this.resize();
        this.syncButton();
      } catch (e) { UI.toast('The 3D view could not start on this device.'); this.close(); }
    });
    if (window.THREE) { go(); return; }
    // The 3D library loads the first time the view opens.
    const s = document.createElement('script');
    s.src = THREE_URL;
    s.onload = go;
    s.onerror = () => UI.toast('The 3D view needs a connection the first time it opens.');
    document.head.appendChild(s);
  },

  close() {
    this.active = false;
    document.body.classList.remove('view3d');
    if (this.canvas) this.canvas.hidden = true;
    this.pointers.clear(); this.drag = null;
    this.syncButton();
  },

  syncButton() {
    const b = $('btn3d');
    if (b) { b.textContent = this.active ? '2D' : '3D'; b.title = this.active ? 'Back to the flat map (T)' : 'Sand table: the ground in 3D (T)'; }
    const c = $('ctl3d');
    if (c) c.hidden = !this.active;
  },

  // ------------------------------------------------------------ scene
  build() {
    this.canvas = $('view3d');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d2119);
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 30000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const sun = new THREE.DirectionalLight(0xffffff, 0.45);
    sun.position.set(-1, 1.4, -1); // from the northwest, as on the printed shading
    this.scene.add(sun);
    this.drape = document.createElement('canvas');
    this.drape.width = this.drape.height = DRAPE;
    this.texture = new THREE.CanvasTexture(this.drape);
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.raycaster = new THREE.Raycaster();
    this.bindInput();
    window.addEventListener('resize', () => { if (this.active) this.resize(); });
    this.built = true;
  },

  // A new sheet: the ground mesh, its sides, the table, and the printed map to lay on it.
  newMap() {
    const m = G.map, S = this.scene;
    for (const o of [this.terrain, this.skirt, this.table]) if (o) { S.remove(o); o.geometry.dispose(); }
    let hi = 0;
    for (const v of m.elev) if (v > hi) hi = v;
    // Sand-table exaggeration: low ground raised more, mountains less.
    this.exag = clamp(180 / Math.max(10, hi), 1.5, 3);
    const seg = Math.min(256, Math.round(MAP_W / CELL));
    const geo = new THREE.PlaneGeometry(MAP_W, MAP_H, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.height(pos.getX(i) + MAP_W / 2, pos.getZ(i) + MAP_H / 2));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.texture }));
    S.add(this.terrain);
    // The sides of the sand box, down to the table.
    const base = -12, wall = [], N = seg;
    const edge = (x0, y0, x1, y1) => {
      for (let k = 0; k < N; k++) {
        const ax = lerp(x0, x1, k / N), ay = lerp(y0, y1, k / N), bx = lerp(x0, x1, (k + 1) / N), by = lerp(y0, y1, (k + 1) / N);
        const A = [ax - MAP_W / 2, this.height(ax, ay), ay - MAP_H / 2], B = [bx - MAP_W / 2, this.height(bx, by), by - MAP_H / 2];
        const A0 = [A[0], base, A[2]], B0 = [B[0], base, B[2]];
        wall.push(...A, ...A0, ...B, ...B, ...A0, ...B0);
      }
    };
    edge(0, 0, MAP_W, 0); edge(MAP_W, 0, MAP_W, MAP_H); edge(MAP_W, MAP_H, 0, MAP_H); edge(0, MAP_H, 0, 0);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
    wg.computeVertexNormals();
    this.skirt = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0xb59a6a, side: THREE.DoubleSide }));
    S.add(this.skirt);
    const tg = new THREE.PlaneGeometry(MAP_W * 6, MAP_H * 6);
    tg.rotateX(-Math.PI / 2);
    this.table = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: 0x2a3122 }));
    this.table.position.y = base;
    S.add(this.table);
    this.buildBase();
    this.mapRef = m;
    this.clearPegs();
    // Start behind the squad, looking toward the reported enemy.
    const c = centroid(G.squads.blue.all), e = Plan.reported || { x: MAP_W / 2, y: MAP_H / 2 };
    Object.assign(this.cam, { x: lerp(c.x, e.x, 0.3), y: lerp(c.y, e.y, 0.3), yaw: Math.atan2(e.y - c.y, e.x - c.x), pitch: 0.95, dist: MAP_W * 0.85 });
  },

  height(x, y) {
    const m = G.map, k = m.terAt(x, y);
    const water = k === TER.POND || k === TER.RIVER || k === TER.OCEAN;
    return m.elevAt(clamp(x, 0, MAP_W - 0.01), clamp(y, 0, MAP_H - 0.01)) * this.exag - (water ? 0.6 : 0);
  },

  // The printed map, drawn once per sheet at the close-tile detail, in pieces.
  buildBase() {
    const b = this.base = document.createElement('canvas');
    b.width = b.height = DRAPE;
    const bx = b.getContext('2d'), ppm = DRAPE / MAP_W, chunk = 256, piece = document.createElement('canvas');
    piece.width = piece.height = chunk;
    const step = chunk / ppm;
    for (let y0 = 0; y0 < MAP_H; y0 += step) for (let x0 = 0; x0 < MAP_W; x0 += step) {
      const pc = piece.getContext('2d');
      pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(0, 0, chunk, chunk);
      drawMapRegion(pc, G.map, x0, y0, step, step, ppm, 1);
      bx.drawImage(piece, Math.round(x0 * ppm), Math.round(y0 * ppm));
    }
  },

  // The overlay drawing of the flat map, pointed at the drape instead of the screen.
  redrawDrape() {
    const ctx = this.drape.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    const save = { cam: R.cam, w: R.w, h: R.h };
    R.cam = { x: MAP_W / 2, y: MAP_H / 2, zoom: DRAPE / MAP_W }; R.w = R.h = DRAPE;
    try {
      Fog.draw(ctx);
      drawPlan(ctx); drawOrdersOverlay(ctx); drawProjectiles(ctx); drawEffects(ctx);
      drawCones(ctx); drawGhostFormation(ctx); drawTapes(ctx);
    } finally { R.cam = save.cam; R.w = save.w; R.h = save.h; }
    this.texture.needsUpdate = true;
  },

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  },

  placeCamera() {
    const c = this.cam;
    c.pitch = clamp(c.pitch, 0.18, 1.45); c.dist = clamp(c.dist, 60, MAP_W * 2.2);
    c.x = clamp(c.x, 0, MAP_W); c.y = clamp(c.y, 0, MAP_H);
    const ty = this.height(c.x, c.y);
    const hd = Math.cos(c.pitch) * c.dist;
    this.camera.position.set(c.x - MAP_W / 2 - Math.cos(c.yaw) * hd, ty + Math.sin(c.pitch) * c.dist, c.y - MAP_H / 2 - Math.sin(c.yaw) * hd);
    this.camera.lookAt(c.x - MAP_W / 2, ty, c.y - MAP_H / 2);
  },

  frame(dt) {
    if (!this.active) return;
    if (this.mapRef !== G.map) this.newMap();
    this.drapeT -= dt;
    if (this.drapeT <= 0) { this.drapeT = DRAPE_RATE; this.redrawDrape(); }
    this.placeCamera();
    this.updatePegs();
    this.renderer.render(this.scene, this.camera);
  },

  // ------------------------------------------------------------ pieces
  // The billet symbol, as on the flat map's round counters, for the top of a peg.
  symbolTexture(side, billet) {
    const key = side + ':' + billet;
    if (!this.symTex.has(key)) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      drawSymbol(c.getContext('2d'), 32, 32, 27, billet, { side });
      this.symTex.set(key, new THREE.CanvasTexture(c));
    }
    return this.symTex.get(key);
  },
  pegFor(s) {
    let p = this.pegs.get(s.id);
    if (p) return p;
    const g = new THREE.Group();
    const col = s.side === 'blue' ? 0x3a7d96 : 0xa14646;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18), new THREE.MeshLambertMaterial({ color: col }));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.08, 18), new THREE.MeshLambertMaterial({ color: s.side === 'blue' ? 0xe9f6fb : 0xfbeaea }));
    const sym = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.symbolTexture(s.side, s.billet), depthTest: true }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 2, 28), new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    g.add(body, top, sym, ring);
    p = { g, body, top, sym, ring, side: s.side };
    this.scene.add(g);
    this.pegs.set(s.id, p);
    return p;
  },
  // Pegs stand a little taller than life so they read at a distance; the farther the
  // camera, the bigger they are drawn.
  pegScale() { return clamp(this.cam.dist / 500, 0.7, 4); },
  pegHeight(s) { return s.active ? 6 * { stand: 1, kneel: 0.72, prone: 0.4 }[s.posture] : 1.2; },

  updatePegs() {
    const k = this.pegScale(), sel = new Set(selMembers(G.ui.sel)), seen = new Set();
    for (const s of G.soldiers) {
      if (s.routed || !(s.side === 'blue' || G.revealAll || enemyVisible(s))) continue;
      seen.add(s.id);
      const p = this.pegFor(s), h = this.pegHeight(s) * k, r = 2 * k;
      p.g.visible = true;
      p.g.position.set(s.x - MAP_W / 2, this.height(s.x, s.y), s.y - MAP_H / 2);
      p.body.scale.set(r, h, r); p.body.position.y = h / 2;
      p.body.material.color.setHex(s.active ? (s.side === 'blue' ? 0x3a7d96 : 0xa14646) : (s.health === 'kia' ? 0x3a3a3a : 0x7a7a7a));
      p.top.scale.set(r, 1, r); p.top.position.y = h + 0.04;
      p.sym.visible = s.active;
      p.sym.scale.set(4.6 * k, 4.6 * k, 1); p.sym.position.y = h + 3.2 * k;
      p.ring.visible = sel.has(s);
      p.ring.scale.set(r, r, r); p.ring.position.y = 0.3;
    }
    for (const [id, p] of this.pegs) if (!seen.has(id)) p.g.visible = false;
    // Last known enemy positions: faint red spheres where a man was last seen.
    let n = 0;
    if (!G.revealAll) for (const kn of G.known.blue.values()) {
      const e = G.byId.get(kn.id);
      if (kn.visible || !e || !e.active) continue;
      let m = this.lost[n];
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xc62828, transparent: true, opacity: 0.35, wireframe: true }));
        this.scene.add(m); this.lost.push(m);
      }
      m.visible = true; m.scale.setScalar(2.4 * k);
      m.position.set(kn.x - MAP_W / 2, this.height(kn.x, kn.y) + 2.4 * k, kn.y - MAP_H / 2);
      n++;
    }
    for (; n < this.lost.length; n++) this.lost[n].visible = false;
  },
  clearPegs() {
    for (const p of this.pegs.values()) this.scene.remove(p.g);
    this.pegs.clear();
  },

  // ------------------------------------------------------------ picking
  // The map point under a screen point, or null off the ground.
  groundAt(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((sx / r.width) * 2 - 1, -(sy / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain)[0];
    return hit ? { x: hit.point.x + MAP_W / 2, y: hit.point.z + MAP_H / 2 } : null;
  },
  screenOf(x, y, up) {
    const v = new THREE.Vector3(x - MAP_W / 2, this.height(x, y) + (up == null ? 1 : up), y - MAP_H / 2).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height, z: v.z };
  },
  // The man nearest a screen point, as a piece the tap handler understands.
  pieceAt(sx, sy) {
    let best = null, bd = 24;
    for (const s of G.soldiers) {
      if (s.routed || (s.side === 'red' && !enemyVisible(s))) continue;
      const q = this.screenOf(s.x, s.y, this.pegHeight(s) * this.pegScale() * 0.6);
      if (q.z > 1) continue;
      const d = Math.hypot(q.x - sx, q.y - sy) + (s.alive ? 0 : 6) + (s.side === 'blue' ? 0 : 2);
      if (d < bd) { bd = d; best = { kind: 'man', x: s.x, y: s.y, side: s.side, soldier: s }; }
    }
    return best;
  },

  // A control measure point near a screen point, for dragging while planning.
  hitGraphic(sx, sy) {
    let best = null, bd = 22;
    for (const g of Plan.graphics) g.pts.forEach((pt, idx) => {
      const q = this.screenOf(pt.x, pt.y);
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (q.z <= 1 && d < bd) { bd = d; best = { g, idx }; }
    });
    return best;
  },

  // ------------------------------------------------------------ input
  bindInput() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, button: e.button });
      this.moved = this.pointers.size > 1;
      this.drag = { turn: e.button === 2 || e.shiftKey };
      // While planning, a control measure under the finger is dragged instead of the view.
      this.dragG = this.pointers.size === 1 && G.running && Plan.planning && !Plan.tool && e.button !== 2 ? this.hitGraphic(e.offsetX, e.offsetY) : null;
      if (this.pointers.size === 2) this.pinch = this.twoFinger();
    });
    cv.addEventListener('pointermove', (e) => {
      // The pointer's ground point, for the tape and route previews.
      if (e.pointerType === 'mouse' && ((G.ui.measuring && G.ui.tapeStart) || Plan.routeDraft || Plan.plStart)) {
        G.ui.hover = this.groundAt(e.offsetX, e.offsetY); G.ui.hoverIsPointer = true;
      }
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
      p.x = e.offsetX; p.y = e.offsetY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 6) this.moved = true;
      const c = this.cam;
      if (this.pointers.size === 2 && this.pinch) {
        const now = this.twoFinger();
        c.dist *= this.pinch.d / Math.max(1, now.d);
        c.yaw += (now.a - this.pinch.a);
        c.pitch += (now.my - this.pinch.my) * 0.006;
        this.pinch = now;
      } else if (this.pointers.size === 1 && this.moved && this.dragG) {
        const w = this.groundAt(p.x, p.y), pt = this.dragG.g.pts[this.dragG.idx];
        if (w) { pt.x = clamp(w.x, 0, MAP_W); pt.y = clamp(w.y, 0, MAP_H); }
      } else if (this.pointers.size === 1 && this.moved) {
        if (this.drag && this.drag.turn) { c.yaw += dx * 0.006; c.pitch += dy * 0.006; }
        else {
          // Pan along the ground, scaled to how far away it is.
          // Forward is f, screen right is (-fy, fx): the ground follows the finger.
          const k = c.dist / 900, fx = Math.cos(c.yaw), fy = Math.sin(c.yaw);
          c.x += -(-fy) * dx * k + fx * dy * k;
          c.y += -fx * dx * k + fy * dy * k;
        }
      }
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (e.type === 'pointerup' && this.dragG && this.pointers.size === 0) {
        // A tap or drag on a control measure selects it in the order's Execution paragraph.
        Plan.selected = this.dragG.g.id; this.dragG = null;
        OPORD.show('E');
        return;
      }
      if (e.type === 'pointerup' && !this.moved && this.pointers.size === 0) this.tap(p.x, p.y, p.button === 2);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) this.drag = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist *= Math.exp(e.deltaY * 0.0012); }, { passive: false });
  },
  twoFinger() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
  },

  tap(sx, sy, secondary) {
    const w = this.groundAt(sx, sy);
    if (!w) return;
    UI.handleTap(sx, sy, secondary, { w, piece: this.pieceAt(sx, sy) });
  },

  // On-screen buttons for phones: turn, tilt, zoom.
  nudge(kind) {
    const c = this.cam;
    if (kind === 'left') c.yaw -= 0.35;
    else if (kind === 'right') c.yaw += 0.35;
    else if (kind === 'up') c.pitch += 0.15;
    else if (kind === 'down') c.pitch -= 0.15;
    else if (kind === 'in') c.dist *= 0.75;
    else if (kind === 'out') c.dist /= 0.75;
  },
};

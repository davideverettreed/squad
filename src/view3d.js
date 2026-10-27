'use strict';
// The sand table: the map sheet laid over a 3D model of the ground, heights exaggerated as
// on a real sand table, with the plan, the fog of war, the cones and the pieces drawn on
// it. Each man stands on it as a peg with his billet symbol above, sized to stay readable
// as the camera pulls back. Drag to pan, right-drag (or two fingers) to turn and tilt,
// wheel or pinch to zoom. Taps give the same orders as on the flat map; while planning,
// control measures can be placed and dragged here too.

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
// The ground is cut into tiles, each with its own picture of the map and the overlays.
// Tiles near the camera get a sharper picture than those farther off.
const TILE_M = 500;            // meters across a ground tile
const TILE_RES = [512, 1024, 2048]; // picture sizes: far, middle, near (1, 2 and 4 px per meter)
const TILE_RATE = 0.1;         // least seconds between redraws of one tile's overlays
const BUILD_MS = 8;            // milliseconds a frame may spend drawing the printed map

const View3D = {
  active: false, built: false, mapRef: null, canvas: null,
  renderer: null, scene: null, camera: null, tiles: [], skirt: null, table: null, exag: 2,
  cam: { x: 500, y: 500, yaw: 0, pitch: 0.9, dist: 700 },
  ghostPegs: [], pointers: new Map(), drag: null, pegs: new Map(), lost: [], symTex: new Map(), dragG: null, marks: [], marksRef: null, drawingDrape: false,

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
    this.aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.frustum = new THREE.Frustum();
    this.raycaster = new THREE.Raycaster();
    this.bindInput();
    window.addEventListener('resize', () => { if (this.active) this.resize(); });
    this.built = true;
  },

  // A new sheet: the ground tiles, the sides of the box, the table, and the printed map.
  newMap() {
    const m = G.map, S = this.scene;
    for (const t of this.tiles) { S.remove(t.mesh); t.mesh.geometry.dispose(); t.tex.dispose(); }
    for (const o of [this.skirt, this.table]) if (o) { S.remove(o); o.geometry.dispose(); }
    this.tiles = [];
    let hi = 0;
    for (const v of m.elev) if (v > hi) hi = v;
    // Sand-table exaggeration: low ground raised more, mountains less.
    this.exag = clamp(180 / Math.max(10, hi), 1.2, 3);
    const seg = Math.round(TILE_M / 8), nt = Math.ceil(MAP_W / TILE_M);
    for (let j = 0; j < nt; j++) for (let i = 0; i < nt; i++) {
      const x0 = i * TILE_M, y0 = j * TILE_M, w = Math.min(TILE_M, MAP_W - x0), h = Math.min(TILE_M, MAP_H - y0);
      const geo = new THREE.PlaneGeometry(w, h, seg, seg);
      geo.rotateX(-Math.PI / 2);
      geo.translate(x0 + w / 2 - MAP_W / 2, 0, y0 + h / 2 - MAP_H / 2);
      const pos = geo.attributes.position, nrm = geo.attributes.normal;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k) + MAP_W / 2, y = pos.getZ(k) + MAP_H / 2;
        pos.setY(k, this.height(x, y));
        // Normals from the ground itself, so neighboring tiles meet without a seam.
        const dx = this.height(x + 4, y) - this.height(x - 4, y), dy = this.height(x, y + 4) - this.height(x, y - 4);
        const l = Math.hypot(dx, 8, dy);
        nrm.setXYZ(k, -dx / l, 8 / l, -dy / l);
      }
      geo.computeBoundingSphere();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = TILE_RES[0];
      const tex = new THREE.CanvasTexture(canvas);
      tex.anisotropy = this.aniso;
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
      S.add(mesh);
      const t = { x0, y0, w, h, mesh, canvas, tex, res: TILE_RES[0], base: null, baseRes: 0, queue: [], drawnAt: -1, dirty: true };
      this.tiles.push(t);
      this.setBase(t, TILE_RES[0]);
    }
    // The sides of the sand box, down to the table.
    const base = -12, wall = [], N = nt * seg;
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
    this.mapRef = m;
    this.clearPegs();
    this.objRef = null;
    this.buildMarks();
    // Start behind the squad, looking toward the reported enemy.
    const c = centroid(G.squads.blue.all), e = Plan.reported || { x: MAP_W / 2, y: MAP_H / 2 };
    Object.assign(this.cam, { x: lerp(c.x, e.x, 0.3), y: lerp(c.y, e.y, 0.3), yaw: Math.atan2(e.y - c.y, e.x - c.x), pitch: 0.95, dist: MAP_W * 0.85 });
  },

  height(x, y) {
    const m = G.map, k = m.terAt(x, y);
    const water = k === TER.POND || k === TER.RIVER || k === TER.OCEAN;
    return m.elevAt(clamp(x, 0, MAP_W - 0.01), clamp(y, 0, MAP_H - 0.01)) * this.exag - (water ? 0.6 : 0);
  },

  // A tile's printed map at a given size. Until it is drawn, a blown-up copy of what there
  // is (the last picture, or the whole sheet) stands in, and pieces are drawn a few a frame.
  setBase(t, res) {
    const b = document.createElement('canvas');
    b.width = b.height = res;
    const bx = b.getContext('2d');
    bx.imageSmoothingEnabled = true;
    if (t.base) bx.drawImage(t.base, 0, 0, res, res);
    else if (R.sheet) {
      const P = SHEET_PPM;
      bx.drawImage(R.sheet, (SHEET.ml + t.x0) * P, (SHEET.mt + t.y0) * P, t.w * P, t.h * P, 0, 0, res, res);
    }
    t.base = b; t.baseRes = res; t.queue = [];
    // Smaller pieces for the sharpest pictures, so no one frame does much drawing.
    const piece = res >= 2048 ? 128 : 256;
    for (let py = 0; py < res; py += piece) for (let px = 0; px < res; px += piece) t.queue.push({ px, py, n: piece });
    t.dirty = true;
  },
  // Spend a few milliseconds drawing the printed map, nearest tiles first.
  buildSome() {
    const t0 = performance.now(), c = this.cam;
    const todo = this.tiles.filter(t => t.queue.length).sort((a, b) => this.tileDist(a) - this.tileDist(b));
    const piece = this.piece || (this.piece = document.createElement('canvas'));
    for (const t of todo) {
      const ppm = t.baseRes / t.w, level = ppm >= 3 ? 2 : 1;
      while (t.queue.length) {
        if (performance.now() - t0 > BUILD_MS) return;
        const q = t.queue.shift();
        if (piece.width !== q.n) piece.width = piece.height = q.n;
        const pc = piece.getContext('2d');
        pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(0, 0, q.n, q.n);
        drawMapRegion(pc, G.map, t.x0 + q.px / ppm, t.y0 + q.py / ppm, q.n / ppm, q.n / ppm, ppm, level);
        t.base.getContext('2d').drawImage(piece, q.px, q.py);
        t.dirty = true;
      }
    }
  },
  tileDist(t) { return dist(t.x0 + t.w / 2, t.y0 + t.h / 2, this.cam.x, this.cam.y); },

  // Picture size for a tile: sharpest close to where the camera looks, when it is close.
  wantRes(t) {
    const d = this.tileDist(t), near = this.cam.dist;
    if (near < 700 && d < TILE_M * 0.9) return TILE_RES[2];
    if (near < 1800 && d < TILE_M * 2.2) return TILE_RES[1];
    return TILE_RES[0];
  },

  // A tile's overlays: the flat map's drawing pointed at the tile instead of the screen.
  redrawTile(t) {
    const res = this.wantRes(t);
    if (res !== t.res) {
      t.canvas.width = t.canvas.height = res; t.res = res;
      t.tex.dispose();
      t.tex = new THREE.CanvasTexture(t.canvas); t.tex.anisotropy = this.aniso;
      t.mesh.material.map = t.tex; t.mesh.material.needsUpdate = true;
    }
    if (res > t.baseRes) this.setBase(t, res);
    const ctx = t.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(t.base, 0, 0, res, res);
    const save = { cam: R.cam, w: R.w, h: R.h };
    R.cam = { x: t.x0 + t.w / 2, y: t.y0 + t.h / 2, zoom: res / t.w }; R.w = R.h = res;
    this.drawingDrape = true; // the terrain flags stand up in 3D instead
    try {
      Fog.draw(ctx);
      drawPlan(ctx); drawPlanGhosts(ctx); drawOrdersOverlay(ctx); drawProjectiles(ctx); drawEffects(ctx);
      drawCones(ctx); drawGhostFormation(ctx); drawNudge(ctx); drawUnitDrag(ctx); drawTapes(ctx);
      drawBeatenZones(ctx);
      if (G.ui.showDest) drawDestinations(ctx);
    } finally { R.cam = save.cam; R.w = save.w; R.h = save.h; this.drawingDrape = false; }
    t.tex.needsUpdate = true;
    t.drawnAt = performance.now(); t.dirty = false;
  },

  // Every tile is drawn again soon (an overlay was turned on or off).
  markDirty() { for (const t of this.tiles || []) t.dirty = true; },

  // Redraw the tiles in view, oldest first, two a frame at most.
  refreshTiles() {
    const cam = this.camera, now = performance.now();
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const due = this.tiles.filter(t => this.frustum.intersectsObject(t.mesh) && (t.dirty || now - t.drawnAt > TILE_RATE * 1000 || this.wantRes(t) !== t.res))
      .sort((a, b) => (b.dirty - a.dirty) || a.drawnAt - b.drawnAt);
    for (const t of due.slice(0, 2)) this.redrawTile(t);
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
    this.placeCamera();
    this.buildSome();
    this.refreshTiles();
    this.updatePegs();
    this.updateMarks();
    this.updateGhosts();
    this.updateObjects();
    this.updateFlares();
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
  // An ammunition bar for a peg, in steps of a tenth.
  ammoTexture(f) {
    const k = Math.round(f * 10);
    this.ammoTex = this.ammoTex || new Map();
    if (!this.ammoTex.has(k)) {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 12;
      const x = c.getContext('2d');
      x.fillStyle = 'rgba(20,20,20,0.8)'; x.fillRect(0, 0, 64, 12);
      if (k > 0) { x.fillStyle = ammoColor(k / 10); x.fillRect(2, 2, 60 * k / 10, 8); }
      else { x.strokeStyle = '#d83a2e'; x.lineWidth = 2; x.strokeRect(2, 2, 60, 8); }
      this.ammoTex.set(k, new THREE.CanvasTexture(c));
    }
    return this.ammoTex.get(k);
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
    const ammo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ammoTexture(1) }));
    g.add(body, top, sym, ring, ammo);
    p = { g, body, top, sym, ring, ammo, ammoK: 10, side: s.side };
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
      p.ammo.visible = s.active && s.side === 'blue';
      if (p.ammo.visible) {
        const ak = Math.round(s.ammoFrac * 10);
        if (ak !== p.ammoK) { p.ammoK = ak; p.ammo.material.map = this.ammoTexture(ak / 10); p.ammo.material.needsUpdate = true; }
        p.ammo.scale.set(4.6 * k, 0.86 * k, 1); p.ammo.position.y = h + 0.9 * k;
      }
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
  // ------------------------------------------------------------ signal flares
  // Five glowing stars above the squad leader, rising, bursting and drifting down.
  updateFlares() {
    this.flareObjs = this.flareObjs || new Map();
    const glow = this.glowTex || (this.glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
    })());
    const k = this.pegScale(), live = new Set(G.flares || []);
    for (const [fl, o] of this.flareObjs) if (!live.has(fl)) { this.scene.remove(o.group); o.trail.geometry.dispose(); this.flareObjs.delete(fl); }
    for (const fl of live) {
      let o = this.flareObjs.get(fl);
      if (!o) {
        // A flare: its head (then five stars), a smoke trail up from the launcher, and a
        // smoke streak behind each star.
        const group = new THREE.Group();
        const sprite = () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: fl.color })); group.add(sp); return sp; };
        const line = (n) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: n }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xe8e8e2, transparent: true })); group.add(l); return l; };
        o = { group, head: sprite(), stars: [0, 1, 2, 3, 4].map(sprite), trail: line(24), streaks: [0, 1, 2, 3, 4].map(() => line(2)), ground: sprite() };
        this.scene.add(group); this.flareObjs.set(fl, o);
      }
      const st = flareState(fl.t), base = this.height(fl.x, fl.y) + 1.5;
      const x0 = fl.x - MAP_W / 2, z0 = fl.y - MAP_H / 2, alt = FLARE.alt * st.climb;
      // The climb bends a little downwind as it goes.
      const at = (f) => new THREE.Vector3(x0 + 10 * f * f, base + alt * f, z0 + 4 * f * f);
      o.trail.geometry.setFromPoints(Array.from({ length: 24 }, (_, i) => at(i / 23)));
      o.trail.material.opacity = 0.8 * st.fade;
      const top = at(1);
      o.head.visible = !st.burst;
      o.head.position.copy(top); o.head.scale.setScalar(6 * k); o.head.material.opacity = st.fade;
      o.head.material.color.set(st.burst ? fl.color : '#fff6d0');
      const drop = st.fall * 45;
      o.stars.forEach((sp, i) => {
        const a = (i - 2) * 0.8, r = 22 * st.burst + st.fall * 10;
        const p = new THREE.Vector3(top.x + Math.sin(a) * r, top.y - drop - Math.abs(i - 2) * 3 * st.burst, top.z + Math.cos(a) * r * 0.5);
        sp.visible = st.burst > 0; sp.position.copy(p); sp.scale.setScalar(9 * k); sp.material.opacity = st.fade;
        const ln = o.streaks[i]; ln.visible = st.burst > 0;
        ln.geometry.setFromPoints([top, p]); ln.material.opacity = 0.45 * st.fade;
      });
      // The light on the ground under the burning stars.
      o.ground.visible = st.burst > 0;
      o.ground.position.set(top.x, this.height(fl.x, fl.y) + 2, top.z); o.ground.scale.setScalar(120 * st.burst);
      o.ground.material.opacity = 0.35 * st.fade;
    }
    this.updateSmoke();
  },

  // Black-powder smoke: white puffs that swell, rise, drift and thin.
  updateSmoke() {
    this.smokeSprites = this.smokeSprites || [];
    const tex = this.smokeTex || (this.smokeTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(240,240,236,0.6)'); g.addColorStop(1, 'rgba(240,240,236,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
    })());
    let n = 0;
    for (const e of G.effects) {
      if (e.type !== 'smoke' || e.t < 0) continue;
      let sp = this.smokeSprites[n];
      if (!sp) { sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); this.scene.add(sp); this.smokeSprites.push(sp); }
      n++;
      const f = e.t / e.life;
      sp.visible = true;
      sp.position.set(e.x - MAP_W / 2 + f * 6, this.height(e.x, e.y) + 1.6 + f * 5, e.y - MAP_H / 2 - f * 4);
      sp.scale.setScalar(2 + 9 * Math.sqrt(f)); sp.material.opacity = 0.8 * (1 - f);
    }
    for (; n < this.smokeSprites.length; n++) this.smokeSprites[n].visible = false;
  },

  // ------------------------------------------------------------ mission objects
  updateObjects() {
    if (this.objRef === G.objects) return;
    for (const g of this.objMeshes || []) this.scene.remove(g);
    this.objMeshes = []; this.objRef = G.objects;
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    for (const o of G.objects || []) {
      const g = new THREE.Group(), add = (geo, c, x, y, z, ry) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); return m; };
      if (o.kind === 'helo') {
        add(new THREE.BoxGeometry(12, 3.5, 3.5), 0x4a5240, 0, 1.6, 0, 0.4).rotation.z = 0.15;
        add(new THREE.BoxGeometry(8, 1, 1), 0x4a5240, 8, 2.4, -3.4, 0.4);
        add(new THREE.BoxGeometry(16, 0.3, 0.8), 0x222222, 0, 3.6, 0, 1.2);
      } else if (o.kind === 'cache') {
        for (const [x, z, y] of [[-2, 0, 1], [2, 0, 1], [0, 2, 1], [0, 0, 3]]) add(new THREE.BoxGeometry(3, 2, 3), 0x6b5a3a, x, y, z);
      } else if (o.kind === 'camp') {
        for (const [x, z] of [[-6, 2], [5, 3], [0, -5]]) add(new THREE.ConeGeometry(2.6, 3.2, 4), 0x5a6b45, x, 1.6, z, 0.78);
        add(new THREE.SphereGeometry(0.8, 8, 6), 0xd8501e, 0, 0.5, 1);
      } else if (o.kind === 'truck') {
        add(new THREE.BoxGeometry(7, 2.6, 2.6), 0x4d5a3d, -1, 1.9, 0, 0.3);
        add(new THREE.BoxGeometry(2.4, 2.4, 2.5), 0x3e4a31, 3.6, 1.8, 1.1, 0.3);
      } else if (o.kind === 'relay') {
        add(new THREE.CylinderGeometry(0.25, 0.4, 18, 6), 0x333333, 0, 9, 0);
        add(new THREE.BoxGeometry(2.5, 1.8, 2), 0x55604a, 2, 0.9, 1);
      }
      g.position.set(o.x - MAP_W / 2, this.height(o.x, o.y), o.y - MAP_H / 2);
      g.scale.setScalar(1.5);
      this.scene.add(g); this.objMeshes.push(g);
    }
  },

  // ------------------------------------------------------------ plan ghosts
  // Where the plan leaves each unit: a pale peg with the unit's name, to tap and plan on from.
  updateGhosts() {
    const gs = G.running && !G.over && G.squads.blue ? Plan.ghosts().filter(g => !g.aim) : [], k = this.pegScale();
    this.ghostList = gs;
    gs.forEach((gh, i) => {
      let m = this.ghostPegs[i];
      if (!m) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), new THREE.MeshLambertMaterial({ color: 0x80e0ff, transparent: true, opacity: 0.45 }));
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
        g.add(body, label);
        this.scene.add(g);
        m = this.ghostPegs[i] = { g, body, label, unit: null };
      }
      if (m.unit !== gh.unit) {
        const f = this.flagTexture(PLAN_UNITS[gh.unit], '#1f4fbf');
        m.label.material.map = f.tex; m.label.material.needsUpdate = true; m.aspect = f.aspect; m.unit = gh.unit;
      }
      const r = (gh.unit === 'squad' ? 9 : 6) * k, h = (gh.aim ? 3 : 7) * k;
      m.g.visible = true;
      // An aim point (suppression) is a low amber marker; a team's place a blue peg.
      m.body.material.color.setHex(gh.aim ? 0xffa040 : 0x80e0ff);
      // Beside the control measure it ends on, so each can be tapped on its own.
      const gx = gh.x + 12 * k, gy = gh.y - 12 * k;
      m.g.position.set(gx - MAP_W / 2, this.height(gx, gy), gy - MAP_H / 2);
      m.body.scale.set(r, h, r); m.body.position.y = h / 2;
      m.label.scale.set(5 * k * m.aspect, 5 * k, 1); m.label.position.y = h + 4 * k;
    });
    for (let i = gs.length; i < this.ghostPegs.length; i++) this.ghostPegs[i].g.visible = false;
  },
  ghostAt(sx, sy) {
    let best = null, bd = 30;
    for (const gh of this.ghostList || []) {
      const k = this.pegScale(), q = this.screenOf(gh.x + 12 * k, gh.y - 12 * k, 3 * k);
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (q.z <= 1 && d < bd) { bd = d; best = gh; }
    }
    return best;
  },

  // ------------------------------------------------------------ terrain flags
  // A pennant with a name, as on the flat map, for the top of a flagpole.
  flagTexture(text, color) {
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    ctx.font = '700 44px "Saira Condensed", "Arial Narrow", sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 48, h = 64;
    c.width = w; c.height = h;
    ctx.font = '700 44px "Saira Condensed", "Arial Narrow", sans-serif';
    ctx.fillStyle = 'rgba(250,248,240,0.97)'; ctx.strokeStyle = color; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(w - 3, 3); ctx.lineTo(w - 20, h / 2); ctx.lineTo(w - 3, h - 3); ctx.lineTo(3, h - 3); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 14, h / 2 + 2);
    return { tex: new THREE.CanvasTexture(c), aspect: w / h };
  },
  // Key terrain, settlements and the reported enemy stand on the sand table as flagpoles;
  // the enemy's carries a red diamond, the hostile symbol.
  buildMarks() {
    for (const m of this.marks) this.scene.remove(m.g);
    this.marks = [];
    this.marksRef = Plan.terrain;
    for (const k of Plan.terrain || []) {
      if (k.kind === 'aa') continue; // an area: it stays drawn on the ground
      const red = k.kind === 'eny', ink = red ? '#c62828' : '#161616';
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshLambertMaterial({ color: red ? 0x8e1c1c : 0x222222 }));
      const f = this.flagTexture(k.name, ink);
      const flag = new THREE.Sprite(new THREE.SpriteMaterial({ map: f.tex }));
      flag.center.set(0, 0.5);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), new THREE.MeshLambertMaterial({ color: red ? 0xf4c4c4 : 0xf7f5ec }));
      g.add(pole, flag, base);
      let dia = null;
      if (red) {
        dia = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshLambertMaterial({ color: 0xd84343, transparent: true, opacity: 0.8 }));
        g.add(dia);
      }
      g.position.set(k.x - MAP_W / 2, this.height(k.x, k.y), k.y - MAP_H / 2);
      this.scene.add(g);
      this.marks.push({ g, pole, flag, base, dia, aspect: f.aspect });
    }
  },
  updateMarks() {
    if (this.marksRef !== Plan.terrain) this.buildMarks();
    const k = this.pegScale(), on = !!Plan.showTerrain;
    for (const m of this.marks) {
      m.g.visible = on;
      if (!on) continue;
      const H = 26 * k, fh = 7.5 * k;
      m.pole.scale.set(0.5 * k, H, 0.5 * k); m.pole.position.y = H / 2;
      m.flag.scale.set(fh * m.aspect, fh, 1); m.flag.position.set(0.5 * k, H - fh / 2, 0);
      m.base.scale.set(2.2 * k, 0.5, 2.2 * k); m.base.position.y = 0.25;
      if (m.dia) { m.dia.scale.set(4.5 * k, 4.5 * k, 4.5 * k); m.dia.position.y = H * 0.45; m.dia.rotation.y += 0.01; }
    }
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
    const hit = this.raycaster.intersectObjects(this.tiles.map(t => t.mesh))[0];
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
  // The same rules as on the flat map: along a line, inside an area.
  hitGraphic(sx, sy) { return Plan.hitGraphic(sx, sy, (x, y) => this.screenOf(x, y)); },

  // ------------------------------------------------------------ input
  bindInput() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, button: e.button });
      this.moved = this.pointers.size > 1;
      this.drag = { turn: e.button === 2 || e.shiftKey };
      // A beaten zone, or a handle of the selected one: dragged to reshape it.
      const w0 = this.pointers.size === 1 && e.button === 0 && !e.shiftKey && G.running && !G.over && !Plan.tool ? this.groundAt(e.offsetX, e.offsetY) : null;
      this.dragZ = w0 ? zoneHit(e.offsetX, e.offsetY, w0, (x, y) => this.screenOf(x, y)) : null;
      if (this.dragZ) { const z = this.dragZ.z; this.dragZ.orig = { x: z.x, y: z.y, len: z.len, wid: z.wid, ang: z.ang }; this.dragZ.from = w0; }
      // While planning, a team's ghost under the pointer is dragged to give the team its spot.
      this.dragGh = !this.dragZ && this.pointers.size === 1 && e.button === 0 && !e.shiftKey && G.running && !G.over && !Plan.tool ? this.ghostAt(e.offsetX, e.offsetY) : null;
      // A finger (or the left button) pressed on one of our pieces drags the unit to a new place.
      this.dragU = !this.dragZ && !this.dragGh && this.pointers.size === 1 && e.button === 0 && !e.shiftKey && G.running && !G.over && !Plan.tool && !G.ui.measuring ? UI.unitDragStart(this.pieceAt(e.offsetX, e.offsetY)) : null;
      if (this.pointers.size > 1 && this.dragU) { this.dragU = null; G.ui.unitDrag = null; }
      // While planning, a control measure under the finger is dragged instead of the view.
      this.dragG = !this.dragZ && !this.dragU && this.pointers.size === 1 && G.running && Plan.planning && !Plan.tool && e.button !== 2 ? this.hitGraphic(e.offsetX, e.offsetY) : null;
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
      } else if (this.pointers.size === 1 && this.moved && this.dragZ) {
        const w = this.groundAt(p.x, p.y);
        if (w) { dragZone(this.dragZ, w); this.markDirty(); }
      } else if (this.pointers.size === 1 && this.moved && this.dragGh) {
        const w0 = this.groundAt(p.x, p.y), o = this.dragGh.offW, l = this.dragGh.line;
        const w = w0 && o ? { x: w0.x + o.x, y: w0.y + o.y } : w0;
        if (w && this.dragGh.live) { this.dragGh.to = w; G.ui.liveDrag = this.dragGh; this.markDirty(); }
        else if (w && SPOT_TASKS.includes(l.task)) {
          const a = Plan.anchor(Plan.graphic(l.task === 'assault' || l.task === 'suppress' ? l.target : l.where));
          l.spots = l.spots || {}; l.spots[this.dragGh.unit] = Object.assign({}, l.spots[this.dragGh.unit], { dx: w.x - a.x, dy: w.y - a.y });
          this.markDirty();
        }
      } else if (this.pointers.size === 1 && this.moved && this.dragU) {
        const w = this.groundAt(p.x, p.y);
        if (w) { G.ui.unitDrag.to = w; this.drapeDirty = true; }
      } else if (this.pointers.size === 1 && this.moved && this.dragG) {
        const w = this.groundAt(p.x, p.y), dg = this.dragG;
        if (w && (dg.along || dg.inside)) {
          // Taken by its middle (a line) or its inside (an area): the whole measure moves.
          if (!dg.orig) { dg.orig = dg.g.pts.map(q => ({ x: q.x, y: q.y })); dg.from = this.groundAt(p.sx, p.sy) || w; }
          dg.g.pts.forEach((q, i) => { q.x = clamp(dg.orig[i].x + w.x - dg.from.x, 0, MAP_W); q.y = clamp(dg.orig[i].y + w.y - dg.from.y, 0, MAP_H); });
        } else if (w) { const pt = dg.g.pts[dg.idx]; pt.x = clamp(w.x, 0, MAP_W); pt.y = clamp(w.y, 0, MAP_H); }
        this.markDirty();
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
      if (e.type === 'pointerup' && this.dragZ && this.pointers.size === 0) {
        const d = this.dragZ; this.dragZ = null;
        zoneDone(d, this.moved); this.markDirty();
        return;
      }
      if (e.type === 'pointerup' && this.dragGh && this.pointers.size === 0) {
        const g = this.dragGh; this.dragGh = null;
        if (!this.moved) UI.ghostTap(g, e.shiftKey || e.ctrlKey || e.metaKey);
        else ghostDropped(g);
        return;
      }
      if (e.type === 'pointerup' && this.dragU && this.pointers.size === 0) {
        const d = this.dragU; this.dragU = null;
        const w = this.moved ? this.groundAt(p.x, p.y) : null;
        if (w) { UI.unitDrop(p.x, p.y, w, d); return; }
        G.ui.unitDrag = null;
      }
      if (e.type === 'pointerup' && this.dragG && !this.moved && this.pointers.size === 0 && Plan.planning && this.ghostAt(p.x, p.y)) {
        this.dragG = null;
        this.tap(p.x, p.y, false);
        return;
      }
      if (e.type === 'pointerup' && this.dragG && this.pointers.size === 0) {
        // A drag moves the control measure; a tap opens its menu (change, rename, delete).
        const g = this.dragG.g;
        Plan.selected = g.id; this.dragG = null;
        if (this.moved) OPORD.refresh(); else UI.graphicMenu(p.x, p.y, g);
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
    UI.handleTap(sx, sy, secondary, { w, piece: this.pieceAt(sx, sy), ghost: Plan.planning ? this.ghostAt(sx, sy) : null });
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

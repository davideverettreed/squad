'use strict';
// Fog of war on the map: the ground the squad can see now is drawn clear, ground it has
// seen before is faded, and ground it has never seen is faded more. One observer (a
// man from each fire team, and the squad leader) is swept per frame by rays cast out
// to spotting range; a ray stops at a crest, a building or enough vegetation.

const FOG_CELL = 10;   // meters per fog cell
const FOG_TARGET = 1;  // height above the ground that counts as seen (a kneeling man)

const Fog = {
  on: true, fw: 0, fh: 0, seen: null, vis: null, views: new Map(), turn: 0, canvas: null, dirty: true,

  reset() {
    this.fw = Math.ceil(MAP_W / FOG_CELL); this.fh = Math.ceil(MAP_H / FOG_CELL);
    this.seen = new Uint8Array(this.fw * this.fh);
    this.vis = new Uint8Array(this.fw * this.fh);
    this.views = new Map(); this.turn = 0; this.dirty = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.fw; this.canvas.height = this.fh;
  },

  // The men who look for the squad: one from each team that still has a man up, and the SL.
  observers() {
    const sq = G.squads.blue, out = [];
    for (const t of [sq.hq, ...sq.teams]) { const s = t.leader; if (s) out.push(s); }
    return out;
  },

  // Everything one man can see, as a list of fog cells.
  sweep(s) {
    const m = G.map, fw = this.fw, fh = this.fh, out = new Uint8Array(fw * fh);
    const eye = m.elevAt(s.x, s.y) + POSTURE[s.posture].eye, R0 = SPOT_RANGE;
    const rays = Math.ceil(2 * Math.PI * R0 / (FOG_CELL * 0.8)), step = CELL;
    for (let k = 0; k < rays; k++) {
      const a = k / rays * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      // horizon: the lowest slope a sight line must have to clear the ground and buildings so
      // far. veg: earlier vegetation, as the slope of its top and how much it thins a line.
      let horizon = -Infinity;
      const vegTop = [], vegAmt = [];
      for (let r = step; r <= R0; r += step) {
        const x = s.x + dx * r, y = s.y + dy * r;
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) break;
        const g = m.elevAt(x, y), slope = (g + FOG_TARGET - eye) / r;
        if (slope >= horizon) {
          // Vegetation counts only where its top rises above this line.
          let dens = 0;
          for (let i = 0; i < vegTop.length; i++) if (vegTop[i] > slope) dens += vegAmt[i];
          if (dens < 1) out[Math.floor(y / FOG_CELL) * fw + Math.floor(x / FOG_CELL)] = 1;
        }
        const T = TERRAIN[m.ter[Math.floor(y / CELL) * GW + Math.floor(x / CELL)]];
        const top = (g + (T.losH || 0) - eye) / r;
        // A man sees out of the cover he stands in; vegetation below every line still open does nothing.
        if (T.density && r > 6 && top > horizon) { vegTop.push(top); vegAmt.push(T.density * step); }
        horizon = Math.max(horizon, T.solid ? top : (g - eye) / r);
        // Stop when vegetation above the highest line to the ground still ahead blocks it all.
        if (vegTop.length > 8) {
          let tot = 0;
          for (let i = 0; i < vegTop.length; i++) if (vegTop[i] > 0.15) tot += vegAmt[i];
          if (tot >= 1) break;
        }
      }
    }
    // The man's own patch is always in view.
    const c = Math.floor(s.y / FOG_CELL) * fw + Math.floor(s.x / FOG_CELL);
    if (c >= 0 && c < out.length) out[c] = 1;
    return out;
  },

  update() {
    if (!G.running || !this.seen) return;
    const obs = this.observers();
    if (!obs.length) return;
    const s = obs[this.turn++ % obs.length];
    this.views.set(s.id, this.sweep(s));
    // Drop the view of a man who is no longer an observer.
    const ids = new Set(obs.map(o => o.id));
    for (const id of [...this.views.keys()]) if (!ids.has(id)) this.views.delete(id);
    this.vis.fill(0);
    for (const v of this.views.values()) for (let i = 0; i < v.length; i++) if (v[i]) this.vis[i] = 1;
    for (let i = 0; i < this.vis.length; i++) if (this.vis[i]) this.seen[i] = 1;
    this.dirty = true;
  },

  // A wash over the sheet: none where the squad can see, lighter where it has seen,
  // heavier where it has not.
  draw(ctx) {
    if (!this.on || !this.seen || !G.running || G.revealAll) return;
    if (this.dirty) {
      const c = this.canvas.getContext('2d'), img = c.createImageData(this.fw, this.fh), d = img.data;
      for (let i = 0; i < this.vis.length; i++) {
        const a = this.vis[i] ? 0 : this.seen[i] ? 0.4 : 0.66;
        d[i * 4] = 214; d[i * 4 + 1] = 210; d[i * 4 + 2] = 198; d[i * 4 + 3] = a * 255;
      }
      c.putImageData(img, 0, 0);
      this.dirty = false;
    }
    const o = toScreen(0, 0), z = R.cam.zoom;
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas, o.x, o.y, MAP_W * z, MAP_H * z);
    ctx.restore();
  },
};

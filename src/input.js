'use strict';
// Mouse, touch and keyboard. Drag pans, wheel or pinch zooms, tap selects or orders,
// right-click moves (or engages a visible enemy).

const Input = {
  pointers: new Map(), moved: false, camStart: null, pinch: null,

  init(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, button: e.button });
      if (this.pointers.size === 1) {
        this.moved = false;
        this.camStart = { x: R.cam.x, y: R.cam.y };
        // While planning, a control measure under the finger is dragged instead of the map.
        this.dragG = G.running && Plan.planning && !Plan.tool && e.button !== 2 ? Plan.hitGraphic(e.offsetX, e.offsetY) : null;
      } else if (this.pointers.size === 2) {
        this.moved = true;
        const [a, b] = [...this.pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: R.cam.zoom, world: toWorld(mid.x, mid.y) };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      G.ui.hover = toWorld(e.offsetX, e.offsetY);
      G.ui.hoverIsPointer = e.pointerType === 'mouse';
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.offsetX; p.y = e.offsetY;
      if (this.pointers.size === 1) {
        if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) this.moved = true;
        if (this.moved && this.dragG) {
          const w = toWorld(p.x, p.y), pt = this.dragG.g.pts[this.dragG.idx];
          pt.x = clamp(w.x, 0, MAP_W); pt.y = clamp(w.y, 0, MAP_H);
        } else if (this.moved) {
          R.cam.x = this.camStart.x - (p.x - p.sx) / R.cam.zoom;
          R.cam.y = this.camStart.y - (p.y - p.sy) / R.cam.zoom;
          clampCam();
        }
      } else if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        R.cam.zoom = clamp(this.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, this.pinch.d), R.minZoom, 16);
        R.cam.x = this.pinch.world.x - (mid.x - R.w / 2) / R.cam.zoom;
        R.cam.y = this.pinch.world.y - (mid.y - R.h / 2) / R.cam.zoom;
        clampCam();
      }
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (e.type === 'pointerup' && this.dragG && this.pointers.size === 0) {
        Plan.selected = this.dragG.g.id;
        this.dragG = null;
        OPORD.show('E');
        return;
      }
      if (e.type === 'pointerup' && !this.moved && this.pointers.size === 0) UI.handleTap(p.x, p.y, p.button === 2);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 1) {
        const q = [...this.pointers.values()][0];
        q.sx = q.x; q.sy = q.y;
        this.camStart = { x: R.cam.x, y: R.cam.y };
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { G.ui.hover = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = toWorld(e.offsetX, e.offsetY);
      R.cam.zoom = clamp(R.cam.zoom * Math.exp(-e.deltaY * 0.0015), R.minZoom, 16);
      R.cam.x = before.x - (e.offsetX - R.w / 2) / R.cam.zoom;
      R.cam.y = before.y - (e.offsetY - R.h / 2) / R.cam.zoom;
      clampCam();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, select, textarea')) return;
      if (!G.running) return;
      const k = e.key;
      if (k === ' ') { e.preventDefault(); togglePause(); }
      else if (k === 'v' || k === 'V') $('btnCones').click();
      else if (k === 'm' || k === 'M') $('btnMeasure').click();
      else if (k === 't' || k === 'T') View3D.toggle();
      else if (k === 'f' || k === 'F') { Fog.on = !Fog.on; UI.toast(Fog.on ? 'Fog of war shown.' : 'Fog of war hidden.'); }
      else if (k === '1' || k === '2' || k === '3') UI.selectTeam(+k);
      else if (k === '0' || k === '`') UI.select({ level: 'squad', squad: G.squads.blue });
      else if (k === 'Escape') {
        if ($('planMenu')) UI.closePlanMenu();
        else if (G.ui.measuring) UI.setMeasuring(false);
        else if (Plan.tool) { Plan.tool = null; Plan.plStart = null; Plan.routeDraft = null; Plan.routeUnit = null; OPORD.refresh(); }
        else if (G.ui.pending) { G.ui.pending = null; UI.refreshOrders(); }
        else UI.select(null);
      }
    });
  },
};

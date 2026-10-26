'use strict';
// Mouse, touch and keyboard. Drag pans, wheel or pinch zooms. With a mouse, left click
// selects and right click opens the action menu; on a touch screen a tap selects or orders.

const Input = {
  pointers: new Map(), moved: false, camStart: null, pinch: null,

  init(canvas) {
    // With a mouse the buttons split the work: left selects, right acts. Touch keeps taps.
    window.addEventListener('pointerdown', (e) => { G.ui.mouse = e.pointerType === 'mouse'; }, true);
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, button: e.button });
      if (this.pointers.size === 1) {
        this.moved = false;
        this.camStart = { x: R.cam.x, y: R.cam.y };
        // While planning, a plan ghost under the pointer is tapped or dragged to its spot.
        this.dragGh = e.button === 0 && G.running && Plan.planning && !Plan.tool ? ghostAt(e.offsetX, e.offsetY) : null;
        if (this.dragGh) { const q = ghostScreen(this.dragGh), w = toScreen(this.dragGh.x, this.dragGh.y); this.dragGh.off = { x: q.x - w.x, y: q.y - w.y }; }
        // Right button held after step-off: where the selected unit goes, then drag to set its front.
        this.faceDrag = e.button === 2 && G.running && !G.over && !Plan.planning && G.ui.sel ? { at: toWorld(e.offsetX, e.offsetY), to: null } : null;
        G.ui.faceDrag = this.faceDrag;
        // A finger (or the left button) pressed on one of our pieces drags the unit to a new place.
        this.dragU = !this.dragGh && e.button === 0 && G.running && !G.over && !Plan.tool && !G.ui.measuring ? UI.unitDragStart(pieceAt(e.offsetX, e.offsetY)) : null;
        // While planning, a control measure under the finger is dragged instead of the map.
        this.dragG = !this.dragU && !this.dragGh && G.running && Plan.planning && !Plan.tool && e.button !== 2 ? Plan.hitGraphic(e.offsetX, e.offsetY) : null;
      } else if (this.pointers.size === 2) {
        this.moved = true;
        if (this.dragU) { this.dragU = null; G.ui.unitDrag = null; }
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
        if (this.moved && this.dragGh) {
          const g = this.dragGh, l = g.line;
          if (SPOT_TASKS.includes(l.task)) {
            // Kept as an offset from the checkpoint (or objective), so the spot moves with it.
            const w = toWorld(p.x - g.off.x, p.y - g.off.y), a = Plan.anchor(Plan.graphic(l.task === 'assault' || l.task === 'suppress' ? l.target : l.where));
            l.spots = l.spots || {}; l.spots[g.unit] = { dx: w.x - a.x, dy: w.y - a.y };
            g.x = w.x; g.y = w.y;
          }
        } else if (this.moved && this.faceDrag) {
          this.faceDrag.to = toWorld(p.x, p.y);
        } else if (this.moved && this.dragU) {
          G.ui.unitDrag.to = toWorld(p.x, p.y);
        } else if (this.moved && this.dragG) {
          const w = toWorld(p.x, p.y), dg = this.dragG;
          if (dg.along || dg.inside) {
            // Taken by its middle (a line) or its inside (an area): the whole measure moves.
            if (!dg.orig) { dg.orig = dg.g.pts.map(q => ({ x: q.x, y: q.y })); dg.from = toWorld(p.sx, p.sy); }
            dg.g.pts.forEach((q, i) => { q.x = clamp(dg.orig[i].x + w.x - dg.from.x, 0, MAP_W); q.y = clamp(dg.orig[i].y + w.y - dg.from.y, 0, MAP_H); });
          } else {
            const pt = dg.g.pts[dg.idx];
            pt.x = clamp(w.x, 0, MAP_W); pt.y = clamp(w.y, 0, MAP_H);
          }
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
      if (e.type === 'pointerup' && this.dragGh && this.pointers.size === 0) {
        const g = this.dragGh; this.dragGh = null;
        if (!this.moved) UI.ghostTap(g, e.shiftKey || e.ctrlKey || e.metaKey);
        else if (!SPOT_TASKS.includes(g.line.task)) UI.toast('Team spots can be given on a move, a bound, an assault, a fighting position, a support by fire position or a suppress line.');
        else OPORD.refresh();
        return;
      }
      if (e.type === 'pointerup' && this.faceDrag && this.pointers.size === 0) {
        const f = this.faceDrag; this.faceDrag = null; G.ui.faceDrag = null;
        if (this.moved && f.to && dist(f.at.x, f.at.y, f.to.x, f.to.y) > 3) {
          issueOrder(G.ui.sel, 'move', { x: f.at.x, y: f.at.y, mode: G.ui.moveMode, face: angleTo(f.at.x, f.at.y, f.to.x, f.to.y) });
          return;
        }
      }
      if (e.type === 'pointerup' && this.dragU && this.pointers.size === 0) {
        const d = this.dragU; this.dragU = null;
        if (this.moved) { UI.unitDrop(p.x, p.y, toWorld(p.x, p.y), d); return; }
        G.ui.unitDrag = null; // a plain tap: handled below as usual
      }
      // A tap (no drag) on a plan ghost picks the unit, even when it stands on a control measure.
      if (e.type === 'pointerup' && this.dragG && !this.moved && this.pointers.size === 0 && ghostAt(p.x, p.y)) {
        this.dragG = null;
        UI.handleTap(p.x, p.y, false);
        return;
      }
      if (e.type === 'pointerup' && this.dragG && this.pointers.size === 0) {
        // A drag moves the control measure; a tap opens its menu (change, rename, delete).
        const g = this.dragG.g;
        Plan.selected = g.id; this.dragG = null;
        if (this.moved) OPORD.refresh(); else UI.graphicMenu(p.x, p.y, g);
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

    window.addEventListener('keyup', (e) => {
      G.ui.shift = e.shiftKey;
      // Space held shows where every unit is going; let go, it hides them.
      if (e.key === ' ' && G.ui.showDest) { e.preventDefault(); G.ui.showDest = false; View3D.markDirty(); }
    });
    window.addEventListener('keydown', (e) => {
      G.ui.shift = e.shiftKey;
      if (e.target.closest && e.target.closest('input, select, textarea')) return;
      if (!G.running) return;
      const k = e.key;
      const lk = k.length === 1 ? k.toLowerCase() : k;
      // W A S D shift the selected unit, Q E turn it (after step-off).
      if ('wasdqe'.includes(lk) && lk.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { if (Nudge.key(lk)) e.preventDefault(); return; }
      if (k === ' ') { e.preventDefault(); if (!G.ui.showDest) { G.ui.showDest = true; View3D.markDirty(); } }
      else if (lk === 'p' && !e.ctrlKey && !e.metaKey) togglePause();
      else if (k === 'v' || k === 'V') $('btnCones').click();
      else if (k === 'm' || k === 'M') $('btnMeasure').click();
      else if (lk === 'z' && !e.ctrlKey && !e.metaKey) UI.changeSpacing(-1);
      else if (lk === 'x' && !e.ctrlKey && !e.metaKey) UI.changeSpacing(1);
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

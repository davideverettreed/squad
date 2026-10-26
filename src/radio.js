'use strict';
// Orders by radio after step-off. The squad leader calls the order; the unit answers and
// acts after a delay that grows when it is under fire, when its leader is down and when
// the squad's confidence is low. A shaken unit under fire may not copy the message at all.

const Radio = {
  queue: [],

  reset() { this.queue = []; },

  // Orders from the player go by radio once the squad has stepped off.
  routes(sel) {
    return G.running && !Plan.planning && !G.execIssuing && !G.radioDelivering && sel && sel.squad && sel.squad.side === 'blue';
  },

  callsign(sel) {
    if (sel.level === 'squad') return G.squads.blue.name;
    if (sel.level === 'team') return sel.team.short;
    if (sel.level === 'group') return sel.teams.map(t => t.short).join(' and ');
    return sel.soldier.label;
  },
  sender() {
    const sl = G.squads.blue.all.find(s => s.billet === 'SL' && s.active);
    return sl ? 'SL' : 'Acting SL';
  },

  // A point is called by the nearest control measure if there is one close, else by grid.
  where(p) {
    let best = null, bd = 60;
    for (const g of Plan.graphics) {
      const a = Plan.anchor(g), d = dist(a.x, a.y, p.x, p.y);
      if (d < bd) { bd = d; best = g; }
    }
    return best ? best.name : 'grid ' + gridRef(p.x, p.y);
  },

  text(type, arg) {
    switch (type) {
      case 'move': return 'move to ' + this.where(arg) + (arg.mode && arg.mode !== 'walk' ? ', ' + MOVE[arg.mode].label.toLowerCase() : '') + (arg.face != null ? ', face ' + pad3(Math.round((arg.face * 180 / Math.PI + 90 + 360) % 360)) : '');
      case 'bound': return 'bound to ' + this.where(arg);
      case 'assault': return 'assault ' + this.where(arg);
      case 'suppress': return 'suppress ' + this.where(arg);
      case 'launcher': return '40 mike-mike on ' + this.where(arg);
      case 'frag': return 'frag ' + this.where(arg);
      case 'engage': return 'engage the enemy ' + arg.title.toLowerCase();
      case 'face': return 'watch bearing ' + pad3(bearing(G.squads.blue.all[0].x, G.squads.blue.all[0].y, arg.x, arg.y));
      case 'posture': return { stand: 'get up', kneel: 'take a knee', prone: 'get down' }[arg];
      case 'fire': return { free: 'fire at will', return: 'return fire only', hold: 'hold fire' }[arg];
      case 'formation': return 'go to ' + FORMATIONS[arg].label.toLowerCase();
      case 'halt': return 'halt';
      case 'nudge': return arg.text;
      case 'spacing': return arg.text;
      case 'cover': return 'take cover';
      case 'fallback': return 'fall back';
      case 'lift': return 'lift fire';
    }
    return type;
  },

  delayFor(sel) {
    const m = selMembers(sel).filter(commandable);
    let d = 2 + rand() * 2;
    const teams = [...new Set(m.map(s => s.team))];
    if (teams.some(t => t.num && (!t.leader || t.leader.billet !== 'TL'))) d += 3;
    const supp = m.length ? m.reduce((n, s) => n + s.supp, 0) / m.length : 0;
    d += supp / 100 * 4;
    if (!G.squads.blue.all.some(s => s.billet === 'SL' && s.active)) d += 2;
    return d * (1.6 - 0.8 * Plan.conf);
  },

  send(sel, type, arg) {
    if (type === 'move') arg = { x: arg.x, y: arg.y, mode: arg.mode || G.ui.moveMode, face: arg.face };
    const to = this.callsign(sel);
    G.log(this.sender() + ': ' + to + ', ' + this.text(type, arg) + ', over.', 'radio');
    this.queue.push({ due: G.time + this.delayFor(sel), sel, type, arg, to });
  },

  update() {
    if (!this.queue.length) return;
    const due = this.queue.filter(q => q.due <= G.time);
    if (!due.length) return;
    this.queue = this.queue.filter(q => q.due > G.time);
    for (const q of due) {
      const m = selMembers(q.sel).filter(commandable);
      if (!m.length) { G.log(q.to + ': (no answer)', 'radio'); continue; }
      const underFire = m.some(s => G.time - s.team.lastFiredUpon < 3);
      if (chance((1 - Plan.conf) * (underFire ? 0.35 : 0.12))) { G.log(q.to + ': Say again, over.', 'radio'); continue; }
      G.log(q.to + ': Roger, out.', 'radio');
      G.radioDelivering = true;
      try { issueOrder(q.sel, q.type, q.arg); } finally { G.radioDelivering = false; }
    }
  },
};

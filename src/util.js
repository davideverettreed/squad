'use strict';
// Shared helpers: seeded random numbers, math and geometry.
// All game randomness goes through RNG so a mission seed reproduces the same map.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let RNG = Math.random;
function setSeed(seed) { RNG = mulberry32(seed); }
function rand() { return RNG(); }
function randRange(a, b) { return a + (b - a) * RNG(); }
function randInt(a, b) { return Math.floor(a + (b - a + 1) * RNG()); }
function pick(arr) { return arr[Math.floor(RNG() * arr.length)]; }
function chance(p) { return RNG() < p; }
function gauss() {
  const u = Math.max(1e-9, RNG()), v = RNG();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(RNG() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Rotate a formation offset (ox = right of travel, oy = ahead) to world space.
// World y grows southward (down the screen); heading is the direction of travel.
function rotateOffset(ox, oy, heading) {
  const fx = Math.cos(heading), fy = Math.sin(heading);
  const rx = -fy, ry = fx;
  return { x: rx * ox + fx * oy, y: ry * ox + fy * oy };
}

function centroid(list) {
  if (!list.length) return null;
  let x = 0, y = 0;
  for (const p of list) { x += p.x; y += p.y; }
  return { x: x / list.length, y: y / list.length };
}

// Compass bearing in degrees (north up), as a Marine would call it.
function bearing(ax, ay, bx, by) {
  const deg = Math.atan2(bx - ax, -(by - ay)) * 180 / Math.PI;
  return Math.round((deg + 360) % 360);
}
function pad3(n) { return String(n).padStart(3, '0'); }

function fmtClock(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// Draws the app icons (a blue squad leader counter on a scrap of map) into web/icons.
// Run once with: node tools/make-icons.js   (needs Playwright with Chromium)
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const draw = (size, maskable) => `
  const c = document.createElement('canvas'); c.width = c.height = ${size};
  const x = c.getContext('2d'), S = ${size}, pad = ${maskable ? 0 : 0.06} * S;
  x.fillStyle = '#1d2119'; x.fillRect(0, 0, S, S);
  // Map paper with contours and a grid line.
  const m = ${maskable ? 0 : 0.1} * S;
  x.fillStyle = '#f7f5ec'; x.fillRect(m, m, S - 2 * m, S - 2 * m);
  x.save(); x.beginPath(); x.rect(m, m, S - 2 * m, S - 2 * m); x.clip();
  x.fillStyle = '#bedca4'; x.beginPath(); x.ellipse(S * 0.2, S * 0.85, S * 0.35, S * 0.25, 0.4, 0, 7); x.fill();
  x.strokeStyle = 'rgb(168,84,50)'; x.lineWidth = S * 0.008;
  for (let k = 1; k <= 6; k++) { x.lineWidth = S * (k % 5 === 0 ? 0.016 : 0.008); x.beginPath(); x.ellipse(S * 0.78, S * 0.22, S * 0.08 * k, S * 0.055 * k, -0.5, 0, 7); x.stroke(); }
  x.strokeStyle = '#161616'; x.lineWidth = S * 0.01;
  x.beginPath(); x.moveTo(S * 0.5, 0); x.lineTo(S * 0.5, S); x.moveTo(0, S * 0.5); x.lineTo(S, S * 0.5); x.stroke();
  x.restore();
  // The counter: squad leader symbol, circle with X, lower half solid.
  const cx = S / 2, cy = S / 2, r = S * ${maskable ? 0.26 : 0.3};
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.arc(cx + r * 0.08, cy + r * 0.14, r, 0, 7); x.fill();
  x.fillStyle = '#3a7d96'; x.beginPath(); x.arc(cx, cy + r * 0.12, r, 0, 7); x.fill();
  x.fillStyle = '#80e0ff'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  x.fillStyle = '#0d1418'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI); x.closePath(); x.fill();
  const k = r * 0.7071; x.lineWidth = r * 0.13; x.lineCap = 'round';
  x.strokeStyle = '#0d1418'; x.beginPath(); x.moveTo(cx - k, cy - k); x.lineTo(cx, cy); x.lineTo(cx + k, cy - k); x.stroke();
  x.strokeStyle = '#80e0ff'; x.beginPath(); x.moveTo(cx - k, cy + k); x.lineTo(cx, cy); x.lineTo(cx + k, cy + k); x.stroke();
  x.strokeStyle = '#0d1418'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
  c.toDataURL('image/png');`;

(async () => {
  const out = path.join(__dirname, '..', 'web', 'icons');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [name, size, mask] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
    const url = await p.evaluate(draw(size, mask));
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
  }
  await b.close();
  console.log('Wrote icons to web/icons');
})();

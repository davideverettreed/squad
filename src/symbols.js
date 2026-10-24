'use strict';
// Billet symbols from the Marine rifle squad organization figure:
// squad leader (circle, X, lower half solid), fire team leader (slash),
// automatic rifleman (arrow), grenadier (G), rifleman (R).
// Enemy-only billets (machine gunner, RPG, marksman) are placeholders until
// each foreign organization is modeled.

const SIDE_FILL = { blue: '#80e0ff', red: '#ff8080' };
const INK = '#0d1418';

function drawSymbol(ctx, x, y, r, billet, o) {
  o = o || {};
  const fill = o.fill || SIDE_FILL[o.side || 'blue'], ink = o.ink || INK;
  ctx.save();
  ctx.translate(x, y);
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  if (o.prone) ctx.scale(1.12, 0.74);
  const lw = Math.max(1.2, r * 0.13);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  const k = r * 0.7071;
  switch (billet) {
    case 'SL': {
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-k, -k); ctx.lineTo(0, 0); ctx.lineTo(k, -k); ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.beginPath(); ctx.moveTo(-k, k); ctx.lineTo(0, 0); ctx.lineTo(k, k); ctx.stroke();
      break;
    }
    case 'TL':
      ctx.beginPath(); ctx.moveTo(-k, k); ctx.lineTo(k, -k); ctx.stroke();
      break;
    case 'AR':
    case 'MG': {
      ctx.beginPath(); ctx.moveTo(0, r * 0.62); ctx.lineTo(0, -r * 0.15); ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.7); ctx.lineTo(r * 0.38, -r * 0.08); ctx.lineTo(-r * 0.38, -r * 0.08); ctx.closePath(); ctx.fill();
      if (billet === 'MG') { ctx.beginPath(); ctx.moveTo(-r * 0.36, r * 0.36); ctx.lineTo(r * 0.36, r * 0.36); ctx.stroke(); }
      break;
    }
    default: {
      const txt = { G: 'G', R: 'R', MM: 'M', RPG: 'AT' }[billet] || billet;
      ctx.fillStyle = ink;
      ctx.font = '700 ' + Math.round(r * (txt.length > 1 ? 0.9 : 1.25)) + 'px "Saira Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, 0, r * 0.06);
    }
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// Small standalone symbol for the roster.
function symbolCanvas(billet, side, size) {
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = c.height = size * dpr;
  c.style.width = c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  drawSymbol(ctx, size / 2, size / 2, size / 2 - 1.5, billet, { side });
  return c;
}

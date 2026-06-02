// One-off placeholder PWA icon generator. Run: node scripts/gen-icons.mjs
// Produces pure-vector chess-board icons (no font dependency) via sharp.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const BG = '#0f172a';     // slate-900
const LIGHT = '#e2e8f0';  // slate-200
const DARK = '#475569';   // slate-600

// A 4x4 checkerboard occupying a centred square of the given board fraction.
function icon(size, boardFraction, rounded) {
  const board = Math.round(size * boardFraction);
  const offset = Math.round((size - board) / 2);
  const cell = board / 4;
  let squares = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const fill = (r + c) % 2 === 0 ? LIGHT : DARK;
      squares += `<rect x="${offset + c * cell}" y="${offset + r * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`;
    }
  }
  const rx = rounded ? Math.round(size * 0.18) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rx}" fill="${BG}"/>
    ${squares}
  </svg>`;
}

async function render(svg, out) {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(out, buf);
  console.log('wrote', out);
}

await render(icon(192, 0.7, true), 'public/icon-192.png');
await render(icon(512, 0.7, true), 'public/icon-512.png');
// Maskable: smaller board fraction so the motif survives the safe-zone crop,
// full-bleed background (no rounding — the launcher applies the mask shape).
await render(icon(512, 0.5, false), 'public/icon-maskable-512.png');

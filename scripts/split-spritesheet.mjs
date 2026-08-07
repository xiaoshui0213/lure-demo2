/**
 * Split a transparent (or checkerboard) spritesheet into individual PNG icons.
 *
 * Usage:
 *   node scripts/split-spritesheet.mjs --input assets/node-icons-sheet.png --out public/maps/nodes
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_INPUT = path.join(
  ROOT,
  'assets/node-icons-sheet.png',
);
const DEFAULT_OUT = path.join(ROOT, 'public/maps/nodes');

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, out: DEFAULT_OUT, minArea: 900, pad: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = path.resolve(ROOT, argv[++i]);
    else if (a === '--out') args.out = path.resolve(ROOT, argv[++i]);
    else if (a === '--min-area') args.minArea = Number(argv[++i]);
    else if (a === '--pad') args.pad = Number(argv[++i]);
  }
  return args;
}

function isBackground(r, g, b, a = 255) {
  if (a < 8) return true;
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const spread = max - min;
  // Checkerboard / light gray export background.
  if (min >= 228 && spread <= 10) return true;
  // Near-white squares.
  if (min >= 248 && spread <= 12) return true;
  return false;
}

function findComponents(data, width, height, channels, minArea) {
  const size = width * height;
  const foreground = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const o = i * channels;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = channels >= 4 ? data[o + 3] : 255;
    foreground[i] = isBackground(r, g, b, a) ? 0 : 1;
  }

  const labels = new Int32Array(size);
  let currentLabel = 0;
  const components = [];

  for (let i = 0; i < size; i++) {
    if (!foreground[i] || labels[i] !== 0) continue;

    currentLabel++;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const queue = [i];
    labels[i] = currentLabel;

    while (queue.length) {
      const idx = queue.pop();
      area++;
      const x = idx % width;
      const y = (idx - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);

      for (const n of neighbors) {
        if (foreground[n] && labels[n] === 0) {
          labels[n] = currentLabel;
          queue.push(n);
        }
      }
    }

    if (area >= minArea) {
      components.push({ label: currentLabel, area, minX, minY, maxX, maxY });
    }
  }

  return { labels, components };
}

function sortComponents(components) {
  // Stable reading order: top-to-bottom rows, then left-to-right.
  const rowBucket = 48;
  return [...components].sort((a, b) => {
    const rowA = Math.floor((a.minY + a.maxY) / 2 / rowBucket);
    const rowB = Math.floor((b.minY + b.maxY) / 2 / rowBucket);
    if (rowA !== rowB) return rowA - rowB;
    return (a.minX + a.maxX) / 2 - (b.minX + b.maxX) / 2;
  });
}

async function makeTransparentCrop(sourceBuffer, rect, channels) {
  const { data, info } = await sharp(sourceBuffer)
    .extract(rect)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const alpha = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const o = i * info.channels;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    alpha[i] = isBackground(r, g, b, data[o + 3]) ? 0 : 255;
  }

  // Drop isolated checkerboard speckles.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (!alpha[idx]) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (alpha[(y + dy) * width + (x + dx)] > 0) neighbors++;
        }
      }
      if (neighbors < 2) alpha[idx] = 0;
    }
  }

  for (let i = 0; i < width * height; i++) {
    data[i * info.channels + 3] = alpha[i];
  }

  return sharp(Buffer.from(data), {
    raw: {
      width,
      height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(args.out, { recursive: true });

  const sourceBuffer = await sharp(args.input).ensureAlpha().toBuffer();
  const { data, info } = await sharp(sourceBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { components } = findComponents(
    data,
    info.width,
    info.height,
    info.channels,
    args.minArea,
  );
  const sorted = sortComponents(components);

  console.log(`Input : ${args.input} (${info.width}x${info.height})`);
  console.log(`Output: ${args.out}`);
  console.log(`Found : ${sorted.length} icon(s)`);

  const manifest = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const left = Math.max(0, c.minX - args.pad);
    const top = Math.max(0, c.minY - args.pad);
    const right = Math.min(info.width - 1, c.maxX + args.pad);
    const bottom = Math.min(info.height - 1, c.maxY + args.pad);
    const rect = {
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1,
    };

    const png = await makeTransparentCrop(sourceBuffer, rect, info.channels);
    const name = `icon_${String(i + 1).padStart(2, '0')}.png`;
    const outPath = path.join(args.out, name);
    await fs.writeFile(outPath, png);

    manifest.push({
      file: name,
      index: i + 1,
      area: c.area,
      width: rect.width,
      height: rect.height,
      bounds: rect,
      center: {
        x: Math.round((c.minX + c.maxX) / 2),
        y: Math.round((c.minY + c.maxY) / 2),
      },
    });

    console.log(`  · ${name}  ${rect.width}x${rect.height}  area=${c.area}`);
  }

  await fs.writeFile(
    path.join(args.out, 'spritesheet-manifest.json'),
    JSON.stringify(
      {
        source: path.relative(ROOT, args.input).replace(/\\/g, '/'),
        imageSize: { width: info.width, height: info.height },
        exportedAt: new Date().toISOString(),
        icons: manifest,
      },
      null,
      2,
    ),
  );

  console.log(`\nDone. Wrote ${manifest.length} PNG(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

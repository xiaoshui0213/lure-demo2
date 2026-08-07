/**
 * Batch extract map node icons from a world map PNG as transparent PNGs.
 *
 * Uses crop boxes + edge flood-fill matting (works on dark icons on dark maps).
 *
 * Usage:
 *   node scripts/extract-map-nodes.mjs
 *   node scripts/extract-map-nodes.mjs --input path/to/map.png --out public/maps/nodes
 *   node scripts/extract-map-nodes.mjs --only shallow_bay
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_INPUT = path.join(
  ROOT,
  'assets/map-reference.png',
);
const DEFAULT_OUT = path.join(ROOT, 'public/maps/nodes');

/** Percent-based crop boxes tuned for assets/map-reference.png (1024×580). */
const NODES = [
  { id: 'shallow_bay', label: '浅水湾', xPct: 12.0, yPct: 19.0, wPct: 12.0, hPct: 14.0, yShiftPct: 1.0 },
  { id: 'pingzhi_town', label: '平治镇', xPct: 35.5, yPct: 6.0, wPct: 12.0, hPct: 14.0, yShiftPct: 3.0 },
  { id: 'old_pier', label: '旧码头', xPct: 41.5, yPct: 22.0, wPct: 12.0, hPct: 14.0, yShiftPct: -1.0 },
  { id: 'north_reef_island', label: '北礁岛', xPct: 46.0, yPct: 37.0, wPct: 12.0, hPct: 14.0, yShiftPct: -1.5 },
  { id: 'shallow_reef_point', label: '浅滩礁点', xPct: 55.0, yPct: 16.0, wPct: 12.0, hPct: 14.0, yShiftPct: 1.0 },
  { id: 'sea_spider_reef', label: '海蜘礁', xPct: 70.5, yPct: 6.0, wPct: 12.0, hPct: 14.0, yShiftPct: 3.0 },
  { id: 'lighthouse_ruins_a', label: '灯塔废墟', xPct: 67.0, yPct: 23.0, wPct: 12.0, hPct: 14.0, yShiftPct: -0.5 },
  { id: 'lighthouse_ruins_b', label: '灯塔废墟', xPct: 87.5, yPct: 12.0, wPct: 12.0, hPct: 14.0, yShiftPct: 1.5 },
  { id: 'channel_junction', label: '航道岔口', xPct: 7.0, yPct: 36.0, wPct: 12.0, hPct: 14.0, yShiftPct: 0.0 },
  { id: 'shipwreck_cemetery', label: '沉船墓地', xPct: 24.0, yPct: 40.5, wPct: 12.0, hPct: 14.0, yShiftPct: -1.5 },
  { id: 'undercurrent_area', label: '暗流区', xPct: 39.0, yPct: 54.0, wPct: 12.0, hPct: 14.0, yShiftPct: -1.5 },
  { id: 'monster_nest', label: '怪物巢穴', xPct: 55.0, yPct: 52.5, wPct: 13.0, hPct: 15.0, yShiftPct: -1.5 },
  { id: 'mist_ring', label: '迷雾环', xPct: 81.0, yPct: 42.5, wPct: 12.0, hPct: 14.0, yShiftPct: -1.5 },
  { id: 'mutation_zone', label: '异化场域', xPct: 90.5, yPct: 62.0, wPct: 12.0, hPct: 14.0, yShiftPct: -1.5 },
  { id: 'sea_trench', label: '海沟', xPct: 12.0, yPct: 61.5, wPct: 12.0, hPct: 14.0, yShiftPct: -1.5 },
  { id: 'abyss_entrance', label: '深渊入口', xPct: 19.0, yPct: 81.5, wPct: 12.0, hPct: 14.0, yShiftPct: -1.5 },
  { id: 'whirlpool', label: '漩涡', xPct: 44.5, yPct: 79.0, wPct: 13.0, hPct: 14.0, yShiftPct: -1.5 },
  { id: 'boss_nest', label: 'Boss巢穴', xPct: 65.0, yPct: 87.0, wPct: 14.0, hPct: 15.0, yShiftPct: -1.5 },
];

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, out: DEFAULT_OUT, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = path.resolve(ROOT, argv[++i]);
    else if (a === '--out') args.out = path.resolve(ROOT, argv[++i]);
    else if (a === '--only') args.only = argv[++i];
  }
  return args;
}

function cropRect(imageWidth, imageHeight, node) {
  const cx = (node.xPct / 100) * imageWidth;
  const cy = ((node.yPct + (node.yShiftPct ?? 0)) / 100) * imageHeight;
  const w = (node.wPct / 100) * imageWidth;
  const h = (node.hPct / 100) * imageHeight;

  let left = Math.round(cx - w / 2);
  let top = Math.round(cy - h / 2);
  left = Math.max(0, Math.min(left, imageWidth - 1));
  top = Math.max(0, Math.min(top, imageHeight - 1));
  const width = Math.min(Math.round(w), imageWidth - left);
  const height = Math.min(Math.round(h), imageHeight - top);
  return { left, top, width, height };
}

function lum(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function sat(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function distRgb(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function sampleCornerColors(data, width, height, channels, size = 12) {
  const samples = [];
  const corners = [
    [0, 0],
    [width - size, 0],
    [0, height - size],
    [width - size, height - size],
  ];
  for (const [x0, y0] of corners) {
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        const i = (y * width + x) * channels;
        samples.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }
  return {
    r: median(samples.map((s) => s[0])),
    g: median(samples.map((s) => s[1])),
    b: median(samples.map((s) => s[2])),
  };
}

function isRouteOrLabel(r, g, b) {
  const l = lum(r, g, b);
  const s = sat(r, g, b);
  if (l > 205 && s < 45) return true;
  if (l > 165 && s < 90) return true;
  return false;
}

function mattingFromCrop(data, width, height, channels) {
  const bg = sampleCornerColors(data, width, height, channels);
  const bgLum = lum(bg.r, bg.g, bg.b);
  const bgTol = bgLum < 70 ? 34 : 42;

  const size = width * height;
  const bgMask = new Uint8Array(size);
  const queue = new Int32Array(size);
  let qHead = 0;
  let qTail = 0;

  const tryPush = (x, y) => {
    const idx = y * width + x;
    if (bgMask[idx]) return;
    const o = idx * channels;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (isRouteOrLabel(r, g, b)) {
      bgMask[idx] = 1;
      queue[qTail++] = idx;
      return;
    }
    const d = distRgb(r, g, b, bg.r, bg.g, bg.b);
    const l = lum(r, g, b);
    if (d <= bgTol || (l < 95 && d <= bgTol + 16)) {
      bgMask[idx] = 1;
      queue[qTail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  while (qHead < qTail) {
    const idx = queue[qHead++];
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) tryPush(x - 1, y);
    if (x < width - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < height - 1) tryPush(x, y + 1);
  }

  const cx = width / 2;
  const cy = height / 2;
  const protectR = Math.min(width, height) * 0.22;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const o = idx * channels;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const dx = x - cx;
      const dy = y - cy;
      const inCore = dx * dx + dy * dy <= protectR * protectR;

      let alpha = 0;
      if (!bgMask[idx]) {
        alpha = 255;
      } else if (inCore && !isRouteOrLabel(r, g, b)) {
        alpha = 220;
      } else {
        const d = distRgb(r, g, b, bg.r, bg.g, bg.b);
        alpha = d > bgTol + 8 ? Math.min(255, Math.round((d - bgTol) * 8)) : 0;
      }

      if (isRouteOrLabel(r, g, b)) alpha = 0;

      data[o + 3] = alpha;
    }
  }

  return data;
}

async function trimTransparent(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * channels + 3];
      if (a > 20) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return pngBuffer;

  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  return sharp(pngBuffer)
    .extract({
      left: minX,
      top: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    })
    .png()
    .toBuffer();
}

async function extractNode(baseImage, meta, node, outDir) {
  const rect = cropRect(meta.width, meta.height, node);
  const { data, info } = await baseImage
    .clone()
    .extract(rect)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  mattingFromCrop(data, info.width, info.height, info.channels);

  const trimmed = await trimTransparent(
    await sharp(Buffer.from(data), {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels,
      },
    })
      .png()
      .toBuffer(),
  );

  const outPath = path.join(outDir, `${node.id}.png`);
  await fs.writeFile(outPath, trimmed);
  const finalMeta = await sharp(trimmed).metadata();

  let opaque = 0;
  const { data: alphaData, info: alphaInfo } = await sharp(trimmed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 3; i < alphaData.length; i += alphaInfo.channels) {
    if (alphaData[i] > 20) opaque++;
  }

  return {
    id: node.id,
    label: node.label,
    outPath,
    width: finalMeta.width,
    height: finalMeta.height,
    opaquePixels: opaque,
    crop: rect,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodes = args.only ? NODES.filter((n) => n.id === args.only) : NODES;

  if (nodes.length === 0) {
    console.error(`No node matched --only ${args.only}`);
    process.exit(1);
  }

  await fs.mkdir(args.out, { recursive: true });

  const baseImage = sharp(args.input);
  const meta = await baseImage.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Failed to read image dimensions: ${args.input}`);
  }

  console.log(`Input : ${args.input} (${meta.width}x${meta.height})`);
  console.log(`Output: ${args.out}`);
  console.log(`Nodes : ${nodes.length}`);

  const manifest = [];
  for (const node of nodes) {
    process.stdout.write(`  · ${node.id} (${node.label}) ... `);
    try {
      const result = await extractNode(baseImage, meta, node, args.out);
      manifest.push(result);
      console.log(`ok ${result.width}x${result.height} (${result.opaquePixels}px)`);
    } catch (err) {
      console.log('failed');
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const manifestPath = path.join(args.out, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        source: path.relative(ROOT, args.input).replace(/\\/g, '/'),
        imageSize: { width: meta.width, height: meta.height },
        exportedAt: new Date().toISOString(),
        nodes: manifest.map(({ id, label, outPath, width, height, opaquePixels, crop }) => ({
          id,
          label,
          file: path.basename(outPath),
          width,
          height,
          opaquePixels,
          crop,
        })),
      },
      null,
      2,
    ),
  );

  console.log(`\nDone. Wrote ${manifest.length} PNG(s) + manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

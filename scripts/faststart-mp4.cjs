// 把 mp4 的 moov atom 挪到文件开头（"fast start"），解决"卡在第一帧不播放"的问题。
// 原理：只重排顶层 box（ftyp / moov / 其它 / mdat），并把 moov 内 stco/co64 里记录的
// 绝对文件偏移量整体加上 moov 的新增长度，不重新编码，速度极快、无损。
//
// 用法：node scripts/faststart-mp4.cjs <输入.mp4> <输出.mp4>

const fs = require('fs');

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('用法: node scripts/faststart-mp4.cjs <输入.mp4> <输出.mp4>');
  process.exit(1);
}

const buf = fs.readFileSync(inputPath);

function readTopLevelBoxes(buf) {
  const boxes = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit 扩展 size（largesize）
      size = Number(buf.readBigUInt64BE(i + 8));
      headerSize = 16;
    } else if (size === 0) {
      // size==0 表示"直到文件末尾"
      size = buf.length - i;
    }
    boxes.push({ type, start: i, size, headerSize });
    i += size;
  }
  return boxes;
}

// 容器 box —— 内部全是子 box，需要递归进去找 stco/co64；
// 其余类型视为叶子数据 box，不递归（避免把媒体数据误判成 box 头）。
const CONTAINER_TYPES = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'mvex', 'moof', 'traf', 'mfra',
]);

/** 递归扫描 buf[start, start+size) 区间内的 stco/co64，把每个 offset 都加 delta */
function patchOffsets(buf, start, size, delta) {
  const end = start + size;
  let i = start;
  while (i + 8 <= end) {
    let boxSize = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    let headerSize = 8;
    if (boxSize === 1) {
      boxSize = Number(buf.readBigUInt64BE(i + 8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = end - i;
    }
    if (type === 'stco') {
      const entryCount = buf.readUInt32BE(i + headerSize + 4);
      let p = i + headerSize + 8;
      for (let e = 0; e < entryCount; e++) {
        const off = buf.readUInt32BE(p);
        buf.writeUInt32BE(off + delta, p);
        p += 4;
      }
    } else if (type === 'co64') {
      const entryCount = buf.readUInt32BE(i + headerSize + 4);
      let p = i + headerSize + 8;
      for (let e = 0; e < entryCount; e++) {
        const off = buf.readBigUInt64BE(p);
        buf.writeBigUInt64BE(off + BigInt(delta), p);
        p += 8;
      }
    } else if (CONTAINER_TYPES.has(type)) {
      patchOffsets(buf, i + headerSize, boxSize - headerSize, delta);
    }
    i += boxSize;
  }
}

const top = readTopLevelBoxes(buf);
console.log('原始顶层 box:', top.map((b) => `${b.type}@${b.start}(${b.size})`).join(', '));

const ftyp = top.find((b) => b.type === 'ftyp');
const moov = top.find((b) => b.type === 'moov');
const mdatIdx = top.findIndex((b) => b.type === 'mdat');
if (!ftyp || !moov || mdatIdx === -1) {
  console.error('缺少 ftyp / moov / mdat，无法处理');
  process.exit(1);
}
if (top[1] === moov && top[1].start < top.find((b) => b.type === 'mdat').start) {
  console.log('moov 已经在 mdat 前面，文件已经是 fast-start，直接复制。');
  fs.writeFileSync(outputPath, buf);
  process.exit(0);
}

const moovBuf = Buffer.from(buf.subarray(moov.start, moov.start + moov.size));
// moov 挪到 ftyp 后面 —— 后面所有 box（除 ftyp）整体往后移动 moov.size 字节，
// 所以 stco/co64 里的绝对偏移都要 + moov.size
patchOffsets(moovBuf, 0, moovBuf.length, moov.size);

const others = top.filter((b) => b.type !== 'ftyp' && b.type !== 'moov');
const ftypBuf = Buffer.from(buf.subarray(ftyp.start, ftyp.start + ftyp.size));
const otherBufs = others.map((b) => Buffer.from(buf.subarray(b.start, b.start + b.size)));

const outBuf = Buffer.concat([ftypBuf, moovBuf, ...otherBufs]);
fs.writeFileSync(outputPath, outBuf);

console.log('写出:', outputPath, '大小:', outBuf.length, '(原始:', buf.length, ')');
console.log('新顶层 box:', readTopLevelBoxes(outBuf).map((b) => `${b.type}@${b.start}(${b.size})`).join(', '));

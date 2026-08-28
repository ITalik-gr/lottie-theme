import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Just enough PNG to read pixels, with no native dependency.
 *
 * The alternative is a canvas binding that has to compile, which is the difference
 * between `npx` working and not working. Only what the eyedropper needs is supported:
 * 8-bit truecolour with or without alpha, which is what screenshots are.
 */
export async function decodePng(
  source: string | Buffer,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  // A path or the bytes themselves: a screenshot arrives as a file, a bitmap embedded in
  // an animation arrives as base64 that was never on disk.
  const file = typeof source === 'string' ? await readFile(source) : source;
  if (file.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    const type = file.toString('ascii', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8]!;
      colorType = body[9]!;
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: bit depth ${bitDepth}, colour type ${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = source[i]!;
      line[i] =
        filter === 0 ? x
        : filter === 1 ? x + a
        : filter === 2 ? x + b
        : filter === 3 ? x + ((a + b) >> 1)
        : x + paeth(a, b, c);
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4;
      const from = x * channels;
      out[to] = line[from]!;
      out[to + 1] = line[from + 1]!;
      out[to + 2] = line[from + 2]!;
      out[to + 3] = channels === 4 ? line[from + 3]! : 255;
    }
    previous.set(line);
  }

  return { data: out, width, height };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Just enough PNG the other way.
 *
 * Recolouring an embedded bitmap was a browser-only trick: the editor has a canvas to
 * encode with, and Node has nothing. So an agent could read a file's bitmaps and not fix
 * them — which is most of the way to useless, since a quarter of real files carry one and
 * a black stripe texture on a white page is exactly the kind of thing nobody notices until
 * it ships. Written out rather than pulled in: one deflate and a CRC table is cheaper than
 * a dependency that has to compile.
 */
export function encodePng(pixels: { data: Uint8ClampedArray; width: number; height: number }): Buffer {
  const { width, height, data } = pixels;
  // Every scanline is prefixed with its filter type. Filter 0 (none) costs a few bytes
  // over a smarter choice and keeps this readable.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1);
    raw[at] = 0;
    for (let x = 0; x < width * 4; x++) raw[at + 1 + x] = data[y * width * 4 + x]!;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // 10..12: compression, filter and interlace methods — all zero, the only ones defined.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

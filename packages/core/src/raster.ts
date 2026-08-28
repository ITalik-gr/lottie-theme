import { deltaEOk, fromHex, oklabToRgb, oklchToRgbInGamut, rgbToOklab, rgbToOklch, toHex, type OKLab } from './color.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An embedded (or referenced) bitmap inside a Lottie document. */
export interface ImageAsset {
  id: string;
  /** Index in `doc.assets`, for writing a replacement back to the same slot. */
  index: number;
  w: number;
  h: number;
  /** `p` verbatim: a data URI when embedded, a filename when not. */
  source: string;
  mime: string | null;
  embedded: boolean;
}

export function listImageAssets(doc: any): ImageAsset[] {
  const list: any[] = Array.isArray(doc?.assets) ? doc.assets : [];
  const out: ImageAsset[] = [];
  list.forEach((a, index) => {
    if (!a || typeof a.id !== 'string' || Array.isArray(a.layers) || typeof a.p !== 'string') return;
    const embedded = a.p.startsWith('data:');
    out.push({
      id: a.id,
      index,
      w: Number(a.w) || 0,
      h: Number(a.h) || 0,
      source: a.p,
      mime: embedded ? (/^data:([^;,]+)/.exec(a.p)?.[1] ?? null) : null,
      embedded,
    });
  });
  return out;
}

/** Replace an asset's pixels, keeping its id, position and size — same slot, new bytes. */
export function setImageAsset(doc: any, index: number, dataUri: string, size?: { w: number; h: number }): void {
  const asset = doc?.assets?.[index];
  if (!asset || typeof asset.id !== 'string') throw new Error(`no image asset at index ${index}`);
  asset.p = dataUri;
  asset.e = 1; // marks the source as embedded
  asset.u = '';
  if (size) {
    asset.w = size.w;
    asset.h = size.h;
  }
}

/** RGBA bytes, as they come out of a canvas. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface QuantizedColor {
  hex: string;
  count: number;
  /** Share of the opaque pixels, 0..1. */
  share: number;
}

/**
 * The colours an image is actually made of, most used first.
 *
 * Shown to the user the same way the vector palette is, so a bitmap is mapped by name
 * rather than blindly. Fully transparent pixels are ignored — their RGB is meaningless
 * and would otherwise dominate the count.
 */
export function quantize(pixels: Pixels, bits = 4, maxColors = 32): QuantizedColor[] {
  const shift = 8 - bits;
  const counts = new Map<number, number>();
  let opaque = 0;
  const { data } = pixels;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 8) continue;
    opaque++;
    const key =
      ((data[i]! >> shift) << (bits * 2)) | ((data[i + 1]! >> shift) << bits) | (data[i + 2]! >> shift);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const mid = (1 << (shift - 1)) || 0;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([key, count]) => {
      const r = ((key >> (bits * 2)) << shift) + mid;
      const g = (((key >> bits) & ((1 << bits) - 1)) << shift) + mid;
      const b = ((key & ((1 << bits) - 1)) << shift) + mid;
      return { hex: toHex([r / 255, g / 255, b / 255]), count, share: opaque ? count / opaque : 0 };
    });
}

export interface RasterMapping {
  from: string;
  to: string;
}

/**
 * Recolour pixels by blending towards the mapped colours, with no threshold anywhere.
 *
 * A tolerance is the wrong tool: too small leaves dark antialiased edges, too large drags
 * neighbouring shades along. Instead every pixel is weighted by inverse distance in OKLab
 * to each source colour, so a pixel sitting exactly on a source colour becomes exactly the
 * target, and a pixel halfway along an antialiased edge lands halfway between the two
 * targets. No hard edges can appear, because no yes/no decision is ever made.
 *
 * Alpha is never touched — that is what preserves every soft edge and shadow.
 *
 * `strength` scales the whole effect, 0..1.
 */
export function recolorPixels(pixels: Pixels, mappings: readonly RasterMapping[], strength = 1): Pixels {
  if (!mappings.length || strength <= 0) return pixels;
  const sources = mappings.map((m) => rgbToOklab(fromHex(m.from)));
  const targets = mappings.map((m) => rgbToOklab(fromHex(m.to)));

  const { data } = pixels;
  const cache = new Map<number, [number, number, number]>();

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    let rgb = cache.get(key);
    if (!rgb) {
      const lab = rgbToOklab([data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255]);
      rgb = blend(lab, sources, targets, strength);
      cache.set(key, rgb);
    }
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  }
  return pixels;
}

function blend(lab: OKLab, sources: OKLab[], targets: OKLab[], strength: number): [number, number, number] {
  let wSum = 0;
  let L = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < sources.length; i++) {
    const d = deltaEOk(lab, sources[i]!);
    // An exact match must win outright, or floating point noise decides the colour.
    if (d < 1e-6) {
      const [r, g, bl] = oklabToRgb(targets[i]!);
      const mixed = mix(lab, [r, g, bl], strength);
      return mixed;
    }
    const w = 1 / (d * d);
    wSum += w;
    L += targets[i]![0] * w;
    a += targets[i]![1] * w;
    b += targets[i]![2] * w;
  }
  return mix(lab, oklabToRgb([L / wSum, a / wSum, b / wSum]), strength);
}

function mix(originalLab: OKLab, target: readonly number[], strength: number): [number, number, number] {
  const orig = oklabToRgb(originalLab);
  const at = (i: number) => Math.round(255 * (orig[i]! + (target[i]! - orig[i]!) * strength));
  return [at(0), at(1), at(2)];
}

/**
 * Flip perceptual lightness in place, keeping hue and chroma.
 *
 * The fallback for photographs and complex gradients, where mapping named colours is
 * meaningless. Worse than a real mapping, better than leaving a dark rectangle in a
 * light layout. Chroma is reduced where the flipped colour leaves sRGB, so hues do not
 * swing the way clamped RGB inversion makes them.
 */
export function invertPixelLightness(pixels: Pixels, strength = 1): Pixels {
  const { data } = pixels;
  const cache = new Map<number, [number, number, number]>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    let rgb = cache.get(key);
    if (!rgb) {
      const [L, C, h] = rgbToOklch([data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255]);
      const flipped = oklchToRgbInGamut([1 - L, C, h]);
      rgb = [
        Math.round(255 * (data[i]! / 255 + (flipped[0] - data[i]! / 255) * strength)),
        Math.round(255 * (data[i + 1]! / 255 + (flipped[1] - data[i + 1]! / 255) * strength)),
        Math.round(255 * (data[i + 2]! / 255 + (flipped[2] - data[i + 2]! / 255) * strength)),
      ];
      cache.set(key, rgb);
    }
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  }
  return pixels;
}

/** More colours than this and per-colour mapping stops being meaningful — it is a photo
 *  or a complex gradient, and lightness inversion or a manual replacement is the answer. */
export const MAPPABLE_COLOR_LIMIT = 32;

export function isMappable(palette: readonly QuantizedColor[]): boolean {
  return palette.length > 0 && palette.length <= MAPPABLE_COLOR_LIMIT;
}

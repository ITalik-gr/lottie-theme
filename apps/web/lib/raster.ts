'use client';

import { quantize, recolorPixels, invertPixelLightness, type Pixels, type QuantizedColor, type RasterMapping } from '@lottie-theme/core';

/** Decode a data URI (or URL) into raw pixels. Browser-only; the maths lives in core. */
export async function decodeImage(source: string): Promise<{ pixels: Pixels; width: number; height: number }> {
  const image = await createImageBitmap(await (await fetch(source)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, image.width, image.height);
  image.close();
  return { pixels: imageData, width: image.width, height: image.height };
}

/** Always PNG: the source may be a JPEG, but recoloured output needs lossless alpha. */
export function encodePng(pixels: Pixels): string {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.putImageData(pixels as ImageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/** A real `ImageData`, not a look-alike: `putImageData` rejects a plain object, and the
 *  core works on the same shape either way. */
const clone = (p: Pixels): Pixels =>
  new ImageData(new Uint8ClampedArray(p.data), p.width, p.height);

export type RasterMode = 'map' | 'invert';

export function transform(
  pixels: Pixels,
  mode: RasterMode,
  mappings: readonly RasterMapping[],
  strength: number,
): Pixels {
  const copy = clone(pixels);
  return mode === 'invert'
    ? invertPixelLightness(copy, strength)
    : recolorPixels(copy, mappings, strength);
}

export { quantize };
export type { QuantizedColor, RasterMapping, Pixels };

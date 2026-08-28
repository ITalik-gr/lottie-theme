import type { AlphaStop, Path } from './types.ts';
import { getAtPath, readAlphaStops } from './slots.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Colour stop of a gradient ramp, as edited by the UI. */
export interface ColorStop {
  position: number;
  hex: string;
}

/** Linear interpolation of the alpha ramp at `position` (0..1).
 *  A ramp with no stops is fully opaque — Lottie's own default. */
export function alphaAt(stops: readonly AlphaStop[], position: number): number {
  if (stops.length === 0) return 1;
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (position <= first.position) return first.alpha;
  if (position >= last.position) return last.alpha;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (position <= b.position) {
      const span = b.position - a.position;
      const t = span === 0 ? 0 : (position - a.position) / span;
      return a.alpha + (b.alpha - a.alpha) * t;
    }
  }
  return last.alpha;
}

/** True when the ramp fades to (near) nothing — the "mask into the background" pattern.
 *  Such gradients must take the colour of the *new* backdrop, not an inverted colour. */
export function fadesToTransparent(stops: readonly AlphaStop[], epsilon = 0.02): boolean {
  return stops.length > 0 && stops.some((s) => s.alpha <= epsilon);
}

/** Replace the alpha ramp of a gradient in place, keeping its colour stops untouched.
 *  `gradientPath` points at the `g.k.k` array (or a keyframe's `s` array). */
export function writeAlphaStops(doc: any, gradientPath: Path, stops: readonly AlphaStop[]): void {
  const arr = getAtPath(doc, gradientPath);
  if (!Array.isArray(arr)) throw new Error(`gradient path not found: ${gradientPath.join('.')}`);
  const existing = readAlphaStops(doc, gradientPath);
  const colorLength = arr.length - existing.length * 2;
  const tail = [...stops]
    .sort((a, b) => a.position - b.position)
    .flatMap((s) => [s.position, s.alpha]);
  arr.length = colorLength;
  arr.push(...tail);
}

export { readAlphaStops };

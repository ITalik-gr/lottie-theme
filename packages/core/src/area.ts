import type { Slot } from './types.ts';
import { getAtPath } from './slots.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/**
 * Roughly how much of the frame a colour covers.
 *
 * Counting slots is not the same as measuring area, and the difference decides whether a
 * light theme comes out right. The background of a real animation is often a single
 * rectangle — one slot — while the body text is a hundred small paths. Ranked by slot
 * count the text wins and the background is treated as a mark, so it gets pushed to a
 * readable grey instead of becoming white.
 *
 * Measured from the geometry beside each fill: rectangle and ellipse sizes, and the
 * bounding box of a path's vertices. Layer transforms are ignored, so this is an
 * estimate — but it separates "covers the frame" from "is a glyph", which is all the
 * role classifier needs.
 */

const first = (value: Any): Any => {
  if (!Array.isArray(value)) return value;
  // an animated property: keyframes, take the first value
  if (value.length && typeof value[0] === 'object' && value[0] !== null && 's' in value[0]) {
    return value[0].s;
  }
  return value;
};

function boxOfShape(item: Any): number | null {
  const ty = item?.ty;

  if (ty === 'rc' || ty === 'el') {
    const size = first(item?.s?.k);
    if (Array.isArray(size) && size.length >= 2) return Math.abs(size[0] * size[1]);
    return null;
  }

  if (ty === 'sr') {
    const outer = first(item?.or?.k);
    const r = typeof outer === 'number' ? outer : Array.isArray(outer) ? outer[0] : null;
    return typeof r === 'number' ? (2 * r) ** 2 : null;
  }

  if (ty === 'sh') {
    const path = first(item?.ks?.k);
    const vertices = Array.isArray(path) ? path[0]?.v ?? null : path?.v;
    if (!Array.isArray(vertices) || !vertices.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of vertices) {
      if (!Array.isArray(point) || point.length < 2) continue;
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return Math.abs((maxX - minX) * (maxY - minY));
  }

  return null;
}

/**
 * Relative area per slot, 0..1 against the composition size.
 *
 * Slots whose geometry cannot be measured get 0 — the caller falls back to usage counts
 * there rather than pretending to know.
 */
export function estimateAreas(doc: Any, slots: readonly Slot[]): number[] {
  const rootFrame = Math.max(1, (Number(doc?.w) || 0) * (Number(doc?.h) || 0));

  /**
   * Area has to be compared against the composition the shape lives in, not the root:
   * a precomp has its own width and height, and a rectangle filling a 300×300 precomp
   * looked like 6% of a 1200×1200 root and was classified as a mark rather than a
   * background.
   */
  const frameOf = (slot: Slot): number => {
    if (slot.path[0] !== 'assets') return rootFrame;
    const asset = getAtPath(doc, slot.path.slice(0, 2));
    const area = (Number(asset?.w) || 0) * (Number(asset?.h) || 0);
    return area > 0 ? area : rootFrame;
  };

  return slots.map((slot) => {
    const frame = frameOf(slot);
    if (slot.kind === 'solid-layer') {
      const layer = getAtPath(doc, slot.path.slice(0, -1));
      const area = (Number(layer?.sw) || 0) * (Number(layer?.sh) || 0);
      return Math.min(1, area / frame);
    }

    // Only the group the fill is actually in. Walking further up until some geometry
    // turned up was wrong in a way that mattered: a glyph inside a card inherited the
    // card's rectangle, measured as a full-frame surface, and a light theme left white
    // text on a white background.
    for (let cut = slot.path.length - 1; cut > 0; cut--) {
      const container = getAtPath(doc, slot.path.slice(0, cut));
      if (!Array.isArray(container)) continue;
      let largest = 0;
      for (const item of container) {
        const box = boxOfShape(item);
        if (box !== null) largest = Math.max(largest, box);
      }
      return largest > 0 ? Math.min(1, largest / frame) : 0;
    }
    return 0;
  });
}

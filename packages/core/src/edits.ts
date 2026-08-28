import type { AlphaStop, Slot } from './types.ts';
import { canonicalHex } from './color.ts';
import { collectSlots, writeSlot } from './slots.ts';
import { writeAlphaStops } from './alpha.ts';
import { writeStopPositions } from './gradient.ts';
import { writeEffectColor } from './effects.ts';
import { setLayerName } from './tree.ts';
import { setImageAsset } from './raster.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Everything a person changed about a document, as data.
 *
 * Kept separate from the document rather than applied to it, for three reasons: the
 * source stays pristine so "compare with original" is free, undo is a value swap rather
 * than a document copy, and the whole set serialises — which is what lets it be embedded
 * in the file (`meta.themeStudio`), written beside it as a sidecar, or reapplied to a
 * different animation with the same structure.
 */
export interface ThemeEdits {
  version: 1;
  /** Source colour → target colour, applied to every slot carrying it. */
  byHex?: Record<string, string>;
  /** Slot index → colour. Applied after `byHex`, so it wins. */
  byIndex?: Record<number, string>;
  /** Gradient ramp path (dot-joined) → replacement alpha stops. */
  alpha?: Record<string, AlphaStop[]>;
  /** Gradient ramp path (dot-joined) → where its colour stops sit, 0..1 in ramp order.
   *  Colours are not touched: a stop keeps its slot, so a position change and a colour
   *  change on the same stop are independent edits. */
  positions?: Record<string, number[]>;
  /** Effect colour path (dot-joined) → colour. Keyed by path rather than by slot index
   *  because effects sit outside the slot traversal — see `effects.ts`. */
  effects?: Record<string, string>;
  /** Layer path (dot-joined) → name written into `nm`. */
  names?: Record<string, string>;
  /** Named sets of slot indices: `surface`, `text-muted`, `accent`… */
  groups?: Record<string, number[]>;
  /** Image asset index → replacement data URI, with its size when it changed. */
  images?: Record<number, { dataUri: string; w?: number; h?: number }>;
}

export const emptyEdits = (): ThemeEdits => ({ version: 1 });

export function isEmptyEdits(edits: ThemeEdits): boolean {
  return (
    !Object.keys(edits.byHex ?? {}).length &&
    !Object.keys(edits.byIndex ?? {}).length &&
    !Object.keys(edits.alpha ?? {}).length &&
    !Object.keys(edits.positions ?? {}).length &&
    !Object.keys(edits.effects ?? {}).length &&
    !Object.keys(edits.names ?? {}).length &&
    !Object.keys(edits.groups ?? {}).length &&
    !Object.keys(edits.images ?? {}).length
  );
}

export function cloneEdits(edits: ThemeEdits): ThemeEdits {
  return structuredClone(edits);
}

export interface ApplyResult {
  doc: unknown;
  colorsChanged: number;
  rampsChanged: number;
  /** Effect colours written — a drop shadow's own colour, which no slot covers. */
  effectsChanged: number;
  namesChanged: number;
  imagesChanged: number;
  totalSlots: number;
  /** Entries that matched nothing — a stale preset, or a file with a different structure. */
  unusedHex: string[];
  unusedIndex: number[];
  unusedPaths: string[];
}

/** Apply an edit set to `doc` in place. */
export function applyEditsInPlace(
  doc: any,
  edits: ThemeEdits,
  slots?: readonly Slot[],
): ApplyResult {
  const unusedPaths: string[] = [];

  // Names first: `nm` is not part of the slot traversal, so this cannot shift indices.
  let namesChanged = 0;
  for (const [path, name] of Object.entries(edits.names ?? {})) {
    try {
      setLayerName(doc, path.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k)), name);
      namesChanged++;
    } catch {
      unusedPaths.push(path);
    }
  }

  const list = slots ?? collectSlots(doc);

  const byHex = new Map<string, string>();
  for (const [from, to] of Object.entries(edits.byHex ?? {})) {
    byHex.set(canonicalHex(from), canonicalHex(to));
  }
  const byIndex = new Map<number, string>();
  for (const [i, to] of Object.entries(edits.byIndex ?? {})) {
    byIndex.set(Number(i), canonicalHex(to));
  }

  const usedHex = new Set<string>();
  const usedIndex = new Set<number>();
  let colorsChanged = 0;

  for (const slot of list) {
    let target = byHex.get(slot.hex);
    if (target !== undefined) usedHex.add(slot.hex);
    const perIndex = byIndex.get(slot.index);
    if (perIndex !== undefined) {
      target = perIndex;
      usedIndex.add(slot.index);
    }
    if (target === undefined || target === slot.hex) continue;
    writeSlot(doc, slot, target);
    colorsChanged++;
  }

  let rampsChanged = 0;
  for (const [path, stops] of Object.entries(edits.alpha ?? {})) {
    try {
      writeAlphaStops(doc, path.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k)), stops);
      rampsChanged++;
    } catch {
      unusedPaths.push(path);
    }
  }

  let effectsChanged = 0;
  for (const [path, hex] of Object.entries(edits.effects ?? {})) {
    try {
      writeEffectColor(doc, path.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k)), hex);
      effectsChanged++;
    } catch {
      unusedPaths.push(path);
    }
  }

  // After the colours, and after the alpha: both read the ramp by stop count, and a
  // position is only ever written back into a slot that already exists.
  for (const [path, positions] of Object.entries(edits.positions ?? {})) {
    try {
      writeStopPositions(doc, path.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k)), positions);
      rampsChanged++;
    } catch {
      unusedPaths.push(path);
    }
  }

  let imagesChanged = 0;
  for (const [index, image] of Object.entries(edits.images ?? {})) {
    try {
      setImageAsset(doc, Number(index), image.dataUri, image.w && image.h ? { w: image.w, h: image.h } : undefined);
      imagesChanged++;
    } catch {
      unusedPaths.push(`assets.${index}`);
    }
  }

  return {
    doc,
    colorsChanged,
    rampsChanged,
    effectsChanged,
    namesChanged,
    imagesChanged,
    totalSlots: list.length,
    unusedHex: [...byHex.keys()].filter((h) => !usedHex.has(h)),
    unusedIndex: [...byIndex.keys()].filter((i) => !usedIndex.has(i)),
    unusedPaths,
  };
}

/** Apply an edit set to a deep copy, leaving the original untouched. */
export function applyEdits(doc: unknown, edits: ThemeEdits): ApplyResult {
  return applyEditsInPlace(structuredClone(doc), edits);
}

const META_KEY = 'themeStudio';

/**
 * Store the edit set inside the animation itself.
 *
 * Players ignore fields they do not know, so the file keeps working as normal while
 * carrying its own layer names, groups and colour map. One self-contained file that
 * does not lose its settings when it is handed to someone else.
 */
export function embedEdits(doc: any, edits: ThemeEdits): void {
  if (!doc.meta || typeof doc.meta !== 'object') doc.meta = {};
  doc.meta[META_KEY] = structuredClone(edits);
}

export function readEmbeddedEdits(doc: any): ThemeEdits | null {
  const stored = doc?.meta?.[META_KEY];
  if (!stored || typeof stored !== 'object' || stored.version !== 1) return null;
  return structuredClone(stored) as ThemeEdits;
}

export function stripEmbeddedEdits(doc: any): void {
  if (doc?.meta && typeof doc.meta === 'object') {
    delete doc.meta[META_KEY];
    if (!Object.keys(doc.meta).length) delete doc.meta;
  }
}

/**
 * Merge `incoming` over `base`, returning a new set.
 *
 * The same operation whether the edits arrive from a preset, from an auto-suggestion,
 * or over the wire from an agent — later entries win per key, and the categories stay
 * independent so a colour map never wipes out the layer names beside it.
 */
export function mergeEdits(base: ThemeEdits, incoming: ThemeEdits): ThemeEdits {
  const out = cloneEdits(base);
  out.byHex = { ...(out.byHex ?? {}), ...(incoming.byHex ?? {}) };
  out.byIndex = { ...(out.byIndex ?? {}), ...(incoming.byIndex ?? {}) };
  out.alpha = { ...(out.alpha ?? {}), ...(incoming.alpha ?? {}) };
  if (incoming.effects) out.effects = { ...(out.effects ?? {}), ...incoming.effects };
  if (incoming.positions) out.positions = { ...(out.positions ?? {}), ...incoming.positions };
  out.names = { ...(out.names ?? {}), ...(incoming.names ?? {}) };
  if (incoming.groups) out.groups = { ...(out.groups ?? {}), ...incoming.groups };
  if (incoming.images) out.images = { ...(out.images ?? {}), ...incoming.images };
  return out;
}

/** How much an edit set actually asks for — used to describe a step in an activity log. */
export function countEdits(edits: ThemeEdits): number {
  return (
    Object.keys(edits.byHex ?? {}).length +
    Object.keys(edits.byIndex ?? {}).length +
    Object.keys(edits.alpha ?? {}).length +
    Object.keys(edits.positions ?? {}).length +
    Object.keys(edits.effects ?? {}).length +
    Object.keys(edits.names ?? {}).length +
    Object.keys(edits.images ?? {}).length
  );
}

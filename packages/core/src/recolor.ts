import type { Slot } from './types.ts';
import { canonicalHex } from './color.ts';
import { collectSlots, writeSlot } from './slots.ts';

export interface ColorMap {
  /** `#RRGGBB` → `#RRGGBB`, applied to every slot carrying the source colour. */
  byHex?: Record<string, string>;
  /** Slot index → `#RRGGBB`. Applied after `byHex`, so it overrides it. */
  byIndex?: Record<number, string>;
}

export interface RecolorResult {
  /** The recoloured document. `recolor` returns a new document; `recolorInPlace` mutates. */
  doc: unknown;
  changed: number;
  total: number;
  /** Source colours in `byHex` that matched no slot — usually a typo or a stale preset. */
  unusedHex: string[];
  /** Slot indices in `byIndex` that are out of range for this document. */
  unusedIndex: number[];
}

function normalizeMap(map: ColorMap): { byHex: Map<string, string>; byIndex: Map<number, string> } {
  const byHex = new Map<string, string>();
  for (const [from, to] of Object.entries(map.byHex ?? {})) {
    byHex.set(canonicalHex(from), canonicalHex(to));
  }
  const byIndex = new Map<number, string>();
  for (const [i, to] of Object.entries(map.byIndex ?? {})) {
    byIndex.set(Number(i), canonicalHex(to));
  }
  return { byHex, byIndex };
}

/** Apply a colour map to `doc` in place. */
export function recolorInPlace(doc: unknown, map: ColorMap, slots?: readonly Slot[]): RecolorResult {
  const list = slots ?? collectSlots(doc);
  const { byHex, byIndex } = normalizeMap(map);
  const usedHex = new Set<string>();
  const usedIndex = new Set<number>();
  let changed = 0;

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
    changed++;
  }

  return {
    doc,
    changed,
    total: list.length,
    unusedHex: [...byHex.keys()].filter((h) => !usedHex.has(h)),
    unusedIndex: [...byIndex.keys()].filter((i) => !usedIndex.has(i)),
  };
}

/** Apply a colour map to a deep copy, leaving the original untouched. */
export function recolor(doc: unknown, map: ColorMap): RecolorResult {
  return recolorInPlace(structuredClone(doc), map);
}

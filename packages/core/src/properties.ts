import type { Slot, SlotKind } from './types.ts';

/**
 * One editable colour, as opposed to one *occurrence* of a colour.
 *
 * `collectSlots` walks the document in z-order and yields a slot per occurrence, which
 * is what keeps indices stable. But several of those occurrences can be the very same
 * JSON value — a precomp asset referenced by ten layers is one object walked ten times.
 * Editing it changes all ten. A property is that shared value, and it is what the UI
 * should present, highlight and recolour.
 */
export interface ColorProperty {
  key: string;
  kind: SlotKind;
  hex: string;
  /** Slot indices that resolve to this value, in document order. */
  slots: number[];
  /** How many times it is drawn. > 1 means a shared precomp or an animated colour. */
  occurrences: number;
  /** True when the same value is painted in more than one place and cannot be split. */
  shared: boolean;
  /** Gradient stop index, when the property is one stop of a ramp. */
  stop?: number;
}

export function collectProperties(slots: readonly Slot[]): ColorProperty[] {
  const byKey = new Map<string, ColorProperty>();
  for (const s of slots) {
    let p = byKey.get(s.renderKey);
    if (!p) {
      p = {
        key: s.renderKey,
        kind: s.kind,
        hex: s.hex,
        slots: [],
        occurrences: 0,
        shared: false,
        ...(s.stop ? { stop: s.stop.i } : {}),
      };
      byKey.set(s.renderKey, p);
    }
    p.slots.push(s.index);
    p.occurrences++;
  }
  for (const p of byKey.values()) p.shared = p.occurrences > 1;
  return [...byKey.values()];
}

/** Index from render key to property, for resolving a click on the canvas. */
export function propertyIndex(properties: readonly ColorProperty[]): Map<string, ColorProperty> {
  return new Map(properties.map((p) => [p.key, p]));
}

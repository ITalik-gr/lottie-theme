import type { Slot, SlotKind } from './types.ts';
import { fromHex, rgbToOklab, deltaEOk, type OKLab } from './color.ts';

export interface PaletteEntry {
  hex: string;
  /** Slot indices carrying this colour, in document order. */
  slots: number[];
  count: number;
  /** Which kinds of slot use it — a `#FFFFFF` that is both text and background matters. */
  kinds: SlotKind[];
}

/** Unique colours, most used first. The PoC's `report`, as data. */
export function buildPalette(slots: readonly Slot[]): PaletteEntry[] {
  const byHex = new Map<string, PaletteEntry>();
  for (const s of slots) {
    let e = byHex.get(s.hex);
    if (!e) {
      e = { hex: s.hex, slots: [], count: 0, kinds: [] };
      byHex.set(s.hex, e);
    }
    e.slots.push(s.index);
    e.count++;
    if (!e.kinds.includes(s.kind)) e.kinds.push(s.kind);
  }
  return [...byHex.values()].sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
}

export interface Cluster {
  /** Palette entries close enough in OKLab to be treated as one colour. */
  members: PaletteEntry[];
  /** Member with the highest slot count — the one to name the cluster after. */
  representative: PaletteEntry;
  count: number;
}

/**
 * Group near-identical colours. Exports routinely emit `#17181D` and `#17181E`
 * for what the designer meant as one surface colour; recolouring them separately
 * is busywork and leaves visible seams.
 *
 * `threshold` is an OKLab distance; 0.02 is roughly "indistinguishable side by side".
 */
export function clusterPalette(palette: readonly PaletteEntry[], threshold = 0.02): Cluster[] {
  const labs = new Map<string, OKLab>();
  const lab = (hex: string): OKLab => {
    let v = labs.get(hex);
    if (!v) {
      v = rgbToOklab(fromHex(hex));
      labs.set(hex, v);
    }
    return v;
  };

  const clusters: Cluster[] = [];
  // Most-used first, so the representative is the dominant colour rather than a stray.
  for (const entry of [...palette].sort((a, b) => b.count - a.count)) {
    const hit = clusters.find((c) => deltaEOk(lab(c.representative.hex), lab(entry.hex)) <= threshold);
    if (hit) {
      hit.members.push(entry);
      hit.count += entry.count;
    } else {
      clusters.push({ members: [entry], representative: entry, count: entry.count });
    }
  }
  return clusters;
}

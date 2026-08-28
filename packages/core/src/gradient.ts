import type { AlphaStop, Path, Slot } from './types.ts';
import { getAtPath, readAlphaStops } from './slots.ts';
import { toHex } from './color.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A gradient as one thing.
 *
 * Everywhere else in the tool a colour is a colour: one slot, one value, edited on its
 * own. A gradient is the exception — its stops only mean something together. Read as
 * separate slots they are three unrelated greens somewhere in a layer list, which is why
 * "how do I change this gradient" had no answer: there was nothing on screen that was
 * the gradient.
 */
export interface GradientStop {
  /** 0..1 along the ramp. */
  position: number;
  hex: string;
  /** The slot that holds this stop's colour — what an edit is keyed by. */
  slot: number;
}

export interface GradientRamp {
  /** Dot-joined path of the ramp array: `…g.k.k`, or `…g.k.k.<i>.s` when animated. */
  path: string;
  kind: 'gradient-fill' | 'gradient-stroke';
  /** `t: 1` linear, `t: 2` radial. */
  type: 'linear' | 'radial';
  /** Name of the layer it is painted in, when the layer has one. */
  layer: string | null;
  stops: GradientStop[];
  /** The alpha ramp that runs alongside the colours, empty when the gradient has none. */
  alpha: AlphaStop[];
  /** Which keyframe of an animated ramp this is, when it is one. */
  keyframe: number | null;
}

/** The colour stops of one ramp, in ramp order. */
export function readColorStops(doc: any, gradientPath: Path): { position: number; hex: string }[] {
  const arr = getAtPath(doc, gradientPath);
  if (!Array.isArray(arr)) return [];
  const alpha = readAlphaStops(doc, gradientPath);
  const count = (arr.length - alpha.length * 2) / 4;
  const out: { position: number; hex: string }[] = [];
  for (let s = 0; s < count; s++) {
    const o = s * 4;
    out.push({ position: arr[o], hex: toHex([arr[o + 1], arr[o + 2], arr[o + 3]]) });
  }
  return out;
}

/**
 * Move the colour stops along the ramp, leaving their colours where they are.
 *
 * Positions only — a stop keeps its slot index, so every colour edit keyed by index
 * survives the move. Lottie reads the ramp in order, so the positions are sorted on the
 * way in rather than trusted: an out-of-order ramp renders as a hard edge and looks like
 * the editor lost the colours.
 */
export function writeStopPositions(doc: any, gradientPath: Path, positions: readonly number[]): void {
  const arr = getAtPath(doc, gradientPath);
  if (!Array.isArray(arr)) throw new Error(`gradient path not found: ${gradientPath.join('.')}`);
  const alpha = readAlphaStops(doc, gradientPath);
  const count = (arr.length - alpha.length * 2) / 4;
  if (positions.length !== count) {
    throw new Error(`ramp has ${count} stops, given ${positions.length} positions`);
  }
  // A NaN reaching the array does not fail here — it fails much later, as a gradient the
  // renderer draws as nothing, with no clue where it came from.
  if (positions.some((p) => !Number.isFinite(p))) {
    throw new Error(`gradient positions must be numbers: ${positions.join(', ')}`);
  }
  const sorted = [...positions].sort((a, b) => a - b);
  sorted.forEach((position, s) => {
    arr[s * 4] = Math.min(1, Math.max(0, position));
  });
}

/**
 * Every gradient in the document, built from the slots already collected.
 *
 * Grouped by ramp path: the slots of one ramp are consecutive and each carries its stop
 * index, so no second traversal of the document is needed.
 */
export function listGradients(doc: any, slots: readonly Slot[]): GradientRamp[] {
  const byPath = new Map<string, GradientRamp>();
  /** Ramp path → stop index → the slot that holds that stop's colour. */
  const slotOfStop = new Map<string, Map<number, number>>();

  for (const slot of slots) {
    if (slot.kind !== 'gradient-fill' && slot.kind !== 'gradient-stroke') continue;
    if (!slot.stop) continue;
    // A gradient slot's `path` is the ramp array itself — the stop is addressed by
    // `offset` inside it — so the ramp needs no truncating.
    const rampPath = slot.path;
    const key = rampPath.join('.');
    if (!byPath.has(key)) {
      // `t` sits on the shape item, which is two hops above the ramp array (`g.k.k`) or
      // four when the ramp is animated (`g.k.k.<i>.s`).
      const animated = rampPath[rampPath.length - 1] === 's';
      const item = getAtPath(doc, rampPath.slice(0, animated ? -4 : -2));
      byPath.set(key, {
        path: key,
        kind: slot.kind,
        type: item?.t === 2 ? 'radial' : 'linear',
        layer: slot.layerTrail[slot.layerTrail.length - 1]?.name ?? null,
        // Positions and colours are read out of `doc`, never off the slot records: the
        // slots were collected from the file as it shipped, and this is asked most often
        // about a document with edits already applied to it. Taking the values from the
        // slot is how a gradient panel ends up showing the colours it used to have.
        stops: readColorStops(doc, rampPath).map((stop, i) => ({ ...stop, slot: -1, index: i })),
        alpha: readAlphaStops(doc, rampPath),
        keyframe: slot.keyframe?.i ?? null,
      });
      slotOfStop.set(key, new Map());
    }
    slotOfStop.get(key)!.set(slot.stop.i, slot.index);
  }

  const out: GradientRamp[] = [];
  for (const [key, ramp] of byPath) {
    const owners = slotOfStop.get(key)!;
    out.push({
      ...ramp,
      stops: ramp.stops
        .map((stop) => {
          const { index, ...rest } = stop as GradientStop & { index: number };
          return { ...rest, slot: owners.get(index) ?? -1 };
        })
        // A stop whose colour is not in the slot list cannot be edited, and a ramp is
        // read in order regardless of what the array happens to say.
        .filter((stop) => stop.slot >= 0)
        .sort((a, b) => a.position - b.position),
    });
  }
  return out;
}

import type { Path } from './types.ts';
import { getAtPath } from './slots.ts';
import { canonicalHex, fromHex, toHex } from './color.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Colour that lives on an *effect*, not in the shape tree.
 *
 * The docs page counts seven shapes a colour can take in a Lottie file. This is the
 * eighth, and the worst of them: a Drop Shadow effect carries its own colour, nothing in
 * the layer's shapes mentions it, and no palette built from fills and strokes will ever
 * show it. A violet glow behind a badge came through a dark→light conversion untouched
 * for exactly that reason — invisible against the dark page it was drawn for, a pink halo
 * on a white one, and unfindable with every tool the editor had.
 *
 * Kept out of the slot list on purpose. Slots are addressed by index, those indices are
 * embedded in every file this tool has already converted, and inserting a new kind of slot
 * into the traversal would silently renumber all of them. Effects are addressed by path,
 * like alpha ramps and layer names.
 */
export interface EffectColor {
  /** Dot-joined path of the colour array — what an edit is keyed by. */
  path: string;
  layer: string | null;
  /** The effect's name, e.g. `Drop Shadow`. */
  effect: string | null;
  /** The parameter's name, e.g. `Shadow Color`. */
  param: string | null;
  hex: string;
  /** The effect's own opacity, 0..255, when it has one: a shadow at 50% reads very
   *  differently from the same colour at full strength. */
  opacity: number | null;
}

/** Effect parameter types, from the schema: 2 is a colour, 0 a slider. */
const COLOR_PARAM = 2;
const SLIDER_PARAM = 0;

export function listEffectColors(doc: any): EffectColor[] {
  const out: EffectColor[] = [];

  const fromLayers = (layers: any[], base: Path) => {
    layers?.forEach?.((layer: any, li: number) => {
      if (!Array.isArray(layer?.ef)) return;
      layer.ef.forEach((effect: any, ei: number) => {
        if (!Array.isArray(effect?.ef)) return;
        const opacity = effect.ef.find((p: any) => p?.ty === SLIDER_PARAM && /opacity/i.test(p?.nm ?? ''));
        effect.ef.forEach((param: any, pi: number) => {
          if (param?.ty !== COLOR_PARAM) return;
          const value = param?.v?.k;
          // An animated effect colour is a keyframe list, not three numbers. Rare, and a
          // single hex could not describe it honestly, so it is left out rather than
          // reported as something that can be changed.
          if (!Array.isArray(value) || typeof value[0] !== 'number') return;
          out.push({
            path: [...base, li, 'ef', ei, 'ef', pi, 'v', 'k'].join('.'),
            layer: typeof layer.nm === 'string' ? layer.nm : null,
            effect: typeof effect.nm === 'string' ? effect.nm : null,
            param: typeof param.nm === 'string' ? param.nm : null,
            hex: toHex([value[0], value[1] ?? 0, value[2] ?? 0]),
            opacity: typeof opacity?.v?.k === 'number' ? opacity.v.k : null,
          });
        });
      });
    });
  };

  fromLayers(doc?.layers, ['layers']);
  (Array.isArray(doc?.assets) ? doc.assets : []).forEach((asset: any, ai: number) => {
    if (Array.isArray(asset?.layers)) fromLayers(asset.layers, ['assets', ai, 'layers']);
  });
  return out;
}

/** Recolour one effect parameter in place, keeping any fourth component it carries. */
export function writeEffectColor(doc: any, path: Path, hex: string): void {
  const array = getAtPath(doc, path);
  if (!Array.isArray(array) || typeof array[0] !== 'number') {
    throw new Error(`effect colour not found: ${path.join('.')}`);
  }
  const [r, g, b] = fromHex(canonicalHex(hex));
  array[0] = r;
  array[1] = g;
  array[2] = b;
}

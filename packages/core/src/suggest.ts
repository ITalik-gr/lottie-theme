import type { ColorProperty } from './properties.ts';
import type { Slot } from './types.ts';
import type { ThemeEdits } from './edits.ts';
import { readAlphaStops, fadesToTransparent } from './alpha.ts';
import { estimateAreas } from './area.ts';
import {
  contrastRatio, fromHex, oklchToRgbInGamut, rgbToOklch, toHex, type OKLCH,
} from './color.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** What a colour is doing in the picture. Drives how it should be transformed. */
export type Role =
  /** Large background areas: the thing a light theme mostly flips. */
  | 'surface'
  /** Small, high-contrast marks that have to stay readable. */
  | 'text'
  /** Brand colour: kept, not inverted. */
  | 'accent'
  /** Desaturated greys: secondary text, dividers, disabled states. */
  | 'muted'
  /** Strokes. */
  | 'border'
  /** A gradient stop whose alpha ramp reaches zero — it dissolves into the backdrop. */
  | 'fade';

export interface RoleGuess {
  key: string;
  role: Role;
  /** 0..1. Low means the heuristic was not sure and the user should look. */
  confidence: number;
  reason: string;
  /** Share of its composition this colour covers, where the geometry could be measured. */
  area?: number;
}

/** Above this OKLCH chroma a colour reads as deliberate brand colour, not as a neutral. */
const ACCENT_CHROMA = 0.06;

/**
 * Guess what each colour is for.
 *
 * There is no ground truth in a Lottie file — nothing records that a rectangle is a card
 * and not an icon. These are heuristics over what the document does expose: how often a
 * colour is used, how deep in the stack, whether it is a fill or a stroke, and where it
 * sits in OKLCH. They are meant to produce a draft a person then corrects, which is why
 * every guess carries a confidence and a reason rather than pretending to be certain.
 */
export function classifyRoles(
  doc: any,
  slots: readonly Slot[],
  properties: readonly ColorProperty[],
): RoleGuess[] {
  // How much of the picture a colour accounts for. Deliberately counted over slots by
  // hex, not over a property's own occurrences: those only say how many times a shared
  // precomp was walked, which has nothing to do with how prominent the colour is.
  const usageByHex = new Map<string, number>();
  for (const s of slots) usageByHex.set(s.hex, (usageByHex.get(s.hex) ?? 0) + 1);

  // Measured against a typical colour of this file rather than against its maximum.
  // Dividing by the maximum buries the difference between a second surface and a stray
  // mark: a black backdrop used 60 times scored 0.4 against a 150-use maximum and came
  // out as text, which turned the background of a light theme grey.
  //  so a single-colour document does not compare a colour against itself and
  // conclude it is merely typical.
  // `Math.max(2, …)` so a single-colour document does not compare a colour against
  // itself and conclude it is merely typical.
  const typicalUsage = Math.max(1, slots.length / Math.max(2, usageByHex.size));

  // Largest share of the frame any slot of this colour covers. A background is often a
  // single rectangle — one slot — so usage alone ranks it below the body text.
  const areas = estimateAreas(doc, slots);
  const areaByHex = new Map<string, number>();
  for (const s of slots) {
    areaByHex.set(s.hex, Math.max(areaByHex.get(s.hex) ?? 0, areas[s.index] ?? 0));
  }

  return properties.map((property) => {
    const slot = slots[property.slots[0] ?? -1];
    const [L, C] = rgbToOklch(fromHex(property.hex));

    // A gradient that fades to nothing is a mask into the backdrop, whatever its colour.
    if (property.stop !== undefined && slot) {
      const ramp = readAlphaStops(doc, slot.path);
      if (fadesToTransparent(ramp)) {
        return { key: property.key, role: 'fade' as const, confidence: 0.95, reason: 'gradient alpha reaches 0' };
      }
    }

    if (property.kind === 'stroke' || property.kind === 'gradient-stroke') {
      return { key: property.key, role: 'border' as const, confidence: 0.8, reason: 'stroke' };
    }

    if (property.kind === 'text-fill' || property.kind === 'text-stroke') {
      return { key: property.key, role: 'text' as const, confidence: 0.95, reason: 'text layer' };
    }

    if (C > ACCENT_CHROMA) {
      return {
        key: property.key,
        role: 'accent' as const,
        confidence: Math.min(1, 0.5 + C * 4),
        reason: `chroma ${C.toFixed(3)}`,
      };
    }

    // Neutral. Depth and usage separate a background from a mark drawn on it: the more
    // of the document a colour covers, and the further back it sits, the more it behaves
    // like a surface.
    const uses = usageByHex.get(property.hex) ?? 1;
    // Prominence alone. Depth in the stack was a term here and it hurt: Lottie lists the
    // topmost layer first, so a backdrop drawn late sits at a low index and got no credit
    // for being a background. The signal saturates — twice typical is already a surface,
    // and ten times typical is not five times more so.
    // Measured geometry wins outright where it exists; usage is the fallback for shapes
    // whose size cannot be read. Combining them the other way made a text colour used 150
    // times outrank the single rectangle behind it.
    const area = areaByHex.get(property.hex) ?? 0;
    const byUsage = uses / (uses + typicalUsage);
    const surfaceness = area > 0 ? area : byUsage;

    if (surfaceness > 0.55) {
      return {
        key: property.key,
        role: 'surface' as const,
        confidence: Math.min(1, surfaceness),
        reason: area > 0 ? `covers ${Math.round(area * 100)}% of the frame` : `used ${uses}×, low chroma`,
        area,
      };
    }
    // Sparse neutrals at either end of the lightness range are marks on a surface.
    if (L > 0.55 || L < 0.25) {
      return {
        key: property.key,
        role: 'text' as const,
        confidence: 0.5,
        reason: `used ${uses}×, L ${L.toFixed(2)}`,
      };
    }
    return {
      key: property.key,
      role: 'muted' as const,
      confidence: 0.4,
      reason: `used ${uses}×, mid grey`,
    };
  });
}

export interface SuggestOptions {
  /** The theme being generated. Decides the default backdrop. */
  target: 'light' | 'dark';
  /** The colour the animation will sit on. Fade gradients are pushed to it. */
  backdrop?: string;
  /** Minimum WCAG contrast for anything classified as text. */
  minTextContrast?: number;
  /** Roles the user has corrected by hand; these override the guesses. */
  overrides?: Record<string, Role>;
}

export interface ContrastIssue {
  /** The colour after the theme was applied. */
  hex: string;
  against: string;
  ratio: number;
  required: number;
  role: Role;
  /** Every colour property that ended up here — one entry per distinct problem, not per
   *  occurrence, or a 250-slot file reports the same thing eighty times. */
  keys: string[];
}

export interface Suggestion {
  edits: ThemeEdits;
  roles: RoleGuess[];
  /** Text colours that still fail WCAG against the new backdrop after adjustment. */
  audit: ContrastIssue[];
}

/**
 * Propose the opposite theme.
 *
 * Lightness is flipped in OKLCH rather than RGB. Inverting RGB muddies everything:
 * a green `#38E887` comes back magenta. In OKLCH the hue survives, and chroma is reduced
 * only as far as sRGB requires, so the result is recognisably the same colour family.
 *
 * Brand colours are not flipped at all — they are checked against the new backdrop and
 * nudged along lightness only if they no longer stand out. And a gradient whose alpha
 * ramp reaches zero is a mask dissolving into the background, so every one of its stops
 * takes the new backdrop colour; leaving it inverted is what makes converted animations
 * show a dark halo on a white page.
 *
 * The result is a draft, not an answer.
 */
export function suggestTheme(
  doc: any,
  slots: readonly Slot[],
  properties: readonly ColorProperty[],
  options: SuggestOptions,
): Suggestion {
  const backdrop = options.backdrop ?? (options.target === 'light' ? '#FFFFFF' : '#0E0F12');
  const minTextContrast = options.minTextContrast ?? 4.5;
  const backdropRgb = fromHex(backdrop);

  const guesses = classifyRoles(doc, slots, properties).map((g) =>
    options.overrides?.[g.key] ? { ...g, role: options.overrides[g.key]!, confidence: 1, reason: 'set by hand' } : g,
  );
  const roleOf = new Map(guesses.map((g) => [g.key, g.role]));
  const areaOf = new Map(guesses.map((g) => [g.key, g.area ?? 0]));

  /** A backplate covering essentially the whole frame should become the page it sits on.
   *  Flipping its lightness instead turns a near-black background into a mid grey, which
   *  is what makes an automatically converted animation look washed out. */
  const BACKPLATE = 0.9;

  const byIndex: Record<number, string> = {};
  const audit: ContrastIssue[] = [];
  const results = new Map<string, string>();

  for (const property of properties) {
    const role = roleOf.get(property.key) ?? 'surface';
    const lch = rgbToOklch(fromHex(property.hex));
    let next: string;

    if (role === 'fade') {
      next = backdrop;
    } else if (role === 'surface' && (areaOf.get(property.key) ?? 0) >= BACKPLATE) {
      next = backdrop;
    } else if (role === 'accent') {
      next = protectAccent(lch, backdropRgb);
    } else {
      next = toHex(oklchToRgbInGamut(flip(lch)));
      if (role === 'text' || role === 'border') {
        next = ensureContrast(next, backdrop, role === 'text' ? minTextContrast : 3);
      }
    }

    results.set(property.key, next);
    if (next === property.hex) continue;
    for (const index of property.slots) byIndex[index] = next;
  }

  // The largest surface is what most of this animation will read against.
  let ground = backdrop;
  let groundArea = 0;
  let groundKey: string | null = null;
  for (const guess of guesses) {
    const area = guess.area ?? 0;
    if (guess.role === 'surface' && area > groundArea) {
      groundArea = area;
      ground = results.get(guess.key) ?? ground;
      groundKey = guess.key;
    }
  }

  // Audited after the fact rather than during the transform, and for every mark rather
  // than only for real text layers. Most "text" in an exported Lottie is converted to
  // paths and never classified as text at all — auditing only text layers reports a clean
  // result while leaving white numbers on a white card.
  const issues = new Map<string, ContrastIssue>();
  for (const guess of guesses) {
    if (guess.role === 'fade' || guess.key === groundKey) continue;
    const hex = results.get(guess.key);
    if (!hex) continue;
    // A card only has to be distinguishable from the page; a mark has to be visible; text
    // has to be readable. Skipping surfaces entirely hid white values on a white card.
    const required = guess.role === 'text' ? minTextContrast : guess.role === 'surface' ? 1.5 : 3;
    const ratio = contrastRatio(fromHex(hex), fromHex(ground));
    if (ratio >= required) continue;

    const id = `${hex}|${guess.role}`;
    const existing = issues.get(id);
    if (existing) existing.keys.push(guess.key);
    else issues.set(id, { hex, against: ground, ratio, required, role: guess.role, keys: [guess.key] });
  }
  audit.push(...[...issues.values()].sort((a, b) => a.ratio - b.ratio));

  return { edits: { version: 1, byIndex }, roles: guesses, audit };
}

/** Perceptual lightness flip, hue untouched. */
function flip([L, C, h]: OKLCH): OKLCH {
  return [1 - L, C, h];
}

/** Keep a brand colour's hue and chroma; move it along lightness only far enough to
 *  stand out against the new backdrop. */
function protectAccent(lch: OKLCH, backdropRgb: readonly number[]): string {
  const [, C, h] = lch;
  let [L] = lch;
  const target = 3;
  const backdropL = rgbToOklch(backdropRgb as [number, number, number])[0];
  // Move away from the backdrop's lightness, never towards it.
  const direction = backdropL > 0.5 ? -1 : 1;
  for (let i = 0; i < 40; i++) {
    const candidate = oklchToRgbInGamut([L, C, h]);
    if (contrastRatio(candidate, backdropRgb as [number, number, number]) >= target) {
      return toHex(candidate);
    }
    L = Math.max(0, Math.min(1, L + direction * 0.02));
  }
  return toHex(oklchToRgbInGamut([L, C, h]));
}

/** Push a colour along lightness until it clears a contrast ratio, or give up and
 *  report it — silently producing unreadable text would be worse. */
function ensureContrast(hex: string, against: string, required: number): string {
  const againstRgb = fromHex(against);
  const [, C, h] = rgbToOklch(fromHex(hex));
  let [L] = rgbToOklch(fromHex(hex));
  const direction = rgbToOklch(againstRgb)[0] > 0.5 ? -1 : 1;
  for (let i = 0; i < 50; i++) {
    const candidate = oklchToRgbInGamut([L, C, h]);
    if (contrastRatio(candidate, againstRgb) >= required) return toHex(candidate);
    const nextL = L + direction * 0.02;
    if (nextL < 0 || nextL > 1) break;
    L = nextL;
  }
  return toHex(oklchToRgbInGamut([Math.max(0, Math.min(1, L)), C, h]));
}

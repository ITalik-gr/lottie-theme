'use client';

import { writeSlot, type ColorProperty, type Slot } from '@lottie-theme/core';

/**
 * Mapping SVG elements back to the colours that produced them.
 *
 * The problem: lottie-web builds an SVG whose relationship to the source document is
 * an implementation detail. Reaching into its internals would tie us to one version.
 *
 * Instead the document is rendered twice at the same frame — once normally, once with
 * every colour replaced by a value that encodes which colour property it came from.
 * The two DOM trees are structurally identical (verified across the corpus and across
 * frames), so walking them in lockstep transfers the decoded identities onto the live
 * SVG as `data-props` attributes. No internals, no guessing.
 */

/** Property ordinal → an exact 24-bit colour. Chosen so the value survives the
 *  float round-trip through Lottie and comes back out of the DOM unchanged. */
export function sentinelHex(ordinal: number): string {
  return `#${(ordinal & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
}

const RGB_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/;
const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function decodeSentinel(value: string | null): number | null {
  if (!value) return null;
  const rgb = RGB_RE.exec(value);
  if (rgb) return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
  const hex = HEX_RE.exec(value);
  if (hex) return parseInt(hex[1]!, 16);
  return null;
}

/** A copy of the document with every colour replaced by its property's sentinel. */
export function buildProbeDoc(
  doc: unknown,
  slots: readonly Slot[],
  properties: readonly ColorProperty[],
): { doc: unknown; order: string[] } {
  const probe = structuredClone(doc);
  const order: string[] = [];
  properties.forEach((property, ordinal) => {
    order.push(property.key);
    const hex = sentinelHex(ordinal);
    // Every slot of the property is written: the keyframes of an animated colour are
    // separate paths that must all carry the sentinel, or the renderer interpolates
    // towards the original colour and the decode fails.
    for (const index of property.slots) {
      const slot = slots[index];
      if (slot) writeSlot(probe, slot, hex);
    }
  });
  return { doc: probe, order };
}

const PAINT_ATTRS = ['fill', 'stroke', 'stop-color'] as const;
const URL_RE = /^url\(["']?#([^"')]+)["']?\)/;

/** Property keys painted by one element of the probe SVG, gradients resolved. */
function keysOf(el: Element, order: readonly string[], gradients: Map<string, string[]>): string[] {
  const keys: string[] = [];
  for (const attr of PAINT_ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const ref = URL_RE.exec(value);
    if (ref) {
      // A gradient-filled shape is what the pointer actually hits; its colours live on
      // <stop> elements inside <defs>, which no click can ever reach.
      for (const key of gradients.get(ref[1]!) ?? []) if (!keys.includes(key)) keys.push(key);
      continue;
    }
    const ordinal = decodeSentinel(value);
    const key = ordinal === null ? undefined : order[ordinal];
    if (key !== undefined && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Gradient element id → the property keys of its stops, in ramp order. */
function indexGradients(probeSvg: SVGElement, order: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const grad of probeSvg.querySelectorAll('linearGradient, radialGradient')) {
    const id = grad.getAttribute('id');
    if (!id) continue;
    const keys: string[] = [];
    for (const stop of grad.querySelectorAll('stop')) {
      const ordinal = decodeSentinel(stop.getAttribute('stop-color'));
      const key = ordinal === null ? undefined : order[ordinal];
      if (key !== undefined) keys.push(key);
    }
    out.set(id, keys);
  }
  return out;
}

export interface TagResult {
  /** Elements that ended up carrying at least one property. */
  tagged: number;
  /** Property keys that were never found in the DOM — usually a layer that is never
   *  drawn at this frame, or a zero-width stroke. They stay editable from the palette. */
  missing: string[];
  /** True when the two renders disagreed structurally, which invalidates the mapping. */
  mismatch: boolean;
}

/**
 * Transfer the probe's identities onto the live SVG as `data-props`, by walking both
 * trees in lockstep. Idempotent: safe to call again after a re-render.
 */
export function tagLiveSvg(
  liveSvg: SVGElement,
  probeSvg: SVGElement,
  order: readonly string[],
): TagResult {
  const gradients = indexGradients(probeSvg, order);
  const seen = new Set<string>();
  let tagged = 0;
  let mismatch = false;

  const walk = (live: Element, probe: Element): void => {
    if (live.tagName !== probe.tagName || live.children.length !== probe.children.length) {
      mismatch = true;
      return;
    }
    const keys = keysOf(probe, order, gradients);
    if (keys.length) {
      live.setAttribute('data-props', keys.join('|'));
      for (const key of keys) seen.add(key);
      tagged++;
    } else {
      live.removeAttribute('data-props');
    }
    for (let i = 0; i < live.children.length; i++) {
      walk(live.children[i]!, probe.children[i]!);
    }
  };

  walk(liveSvg, probeSvg);
  return { tagged, missing: order.filter((k) => !seen.has(k)), mismatch };
}

'use client';

import { alphaAt, readAlphaStops, type ColorProperty, type Slot } from '@lottie-theme/core';

/**
 * Resolving a click on the canvas into the colour the user meant.
 *
 * A single hit is not enough. Illustrations are stacks: an invisible overlay, a
 * gradient mask fading into the background, a hit-box rectangle — any of them can sit
 * on top of the thing being aimed at. So the whole stack under the pointer is returned,
 * top to bottom, and the user picks from it.
 */

export interface Hit {
  element: SVGElement;
  property: ColorProperty;
  /** Opacity actually reaching the screen at this point, 0..1, ancestors included.
   *  For a gradient it is the alpha ramp evaluated where the user clicked. */
  effectiveAlpha: number;
  /** Depth in the stack, 0 = topmost. */
  depth: number;
}

/** Reads an opacity attribute or inline style. An absent inline style is the empty
 *  string, and `Number('')` is 0 — which would read as fully transparent. */
const asNumber = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  if (t === '') return null;
  const n = t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Product of `opacity` up the tree, plus the element's own paint opacity.
 *  A `display:none` or `visibility:hidden` anywhere in the chain means nothing shows. */
function chainOpacity(el: Element, root: Element, kind: ColorProperty['kind']): number {
  let alpha = 1;
  let node: Element | null = el;
  while (node && node !== root.parentElement) {
    const style = node instanceof HTMLElement || node instanceof SVGElement ? node.style : null;
    if (style?.display === 'none' || style?.visibility === 'hidden') return 0;
    const own = asNumber(node.getAttribute('opacity')) ?? asNumber(style?.opacity);
    if (own !== null) alpha *= own;
    node = node.parentElement;
  }
  const paintAttr = kind === 'stroke' || kind === 'gradient-stroke' ? 'stroke-opacity' : 'fill-opacity';
  const paint = asNumber(el.getAttribute(paintAttr));
  if (paint !== null) alpha *= paint;
  return Math.max(0, Math.min(1, alpha));
}

const URL_RE = /^url\(["']?#([^"')]+)["']?\)/;

/**
 * Where along a gradient's ramp a screen point falls, 0..1.
 *
 * The point is pushed back into the painted element's user space, then projected onto
 * the gradient's axis. Without this, a gradient that fades to nothing looks like a
 * solid clickable slab, and the whole "hide what is invisible" filter is a lie.
 */
function gradientOffsetAt(el: SVGElement, svg: SVGSVGElement, x: number, y: number): number | null {
  const paint = el.getAttribute('fill') ?? el.getAttribute('stroke');
  const ref = paint ? URL_RE.exec(paint) : null;
  if (!ref) return null;
  const grad = svg.querySelector(`#${CSS.escape(ref[1]!)}`);
  if (!(grad instanceof SVGElement)) return null;

  const ctm = (el as SVGGraphicsElement).getScreenCTM?.();
  if (!ctm) return null;
  const point = new DOMPoint(x, y).matrixTransform(ctm.inverse());

  if (grad.tagName === 'linearGradient') {
    const x1 = Number(grad.getAttribute('x1') ?? 0);
    const y1 = Number(grad.getAttribute('y1') ?? 0);
    const x2 = Number(grad.getAttribute('x2') ?? 0);
    const y2 = Number(grad.getAttribute('y2') ?? 0);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return 0;
    const t = ((point.x - x1) * dx + (point.y - y1) * dy) / len2;
    return Math.max(0, Math.min(1, t));
  }

  if (grad.tagName === 'radialGradient') {
    const cx = Number(grad.getAttribute('cx') ?? 0);
    const cy = Number(grad.getAttribute('cy') ?? 0);
    const r = Number(grad.getAttribute('r') ?? 0);
    if (r === 0) return 0;
    return Math.max(0, Math.min(1, Math.hypot(point.x - cx, point.y - cy) / r));
  }

  return null;
}

export interface HitStackOptions {
  /** The document the animation was built from, for reading gradient alpha ramps. */
  doc: unknown;
  slots: readonly Slot[];
  properties: Map<string, ColorProperty>;
  /** Below this, a candidate is hidden unless the user asks to see everything. */
  alphaFloor?: number;
  includeTransparent?: boolean;
}

/**
 * Everything under the pointer, topmost first.
 *
 * `elementsFromPoint` is what makes this possible: it returns the whole stack whatever
 * is layered on top, so nothing has to be guessed at and no modifier key is needed to
 * "click deeper".
 */
export function hitStack(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  options: HitStackOptions,
): Hit[] {
  const { doc, slots, properties, alphaFloor = 0.02, includeTransparent = false } = options;
  const stack = document.elementsFromPoint(clientX, clientY);
  const hits: Hit[] = [];
  // One element can paint several properties (a gradient's stops), and one property can
  // appear on several stacked elements; both are worth listing once each.
  const seen = new Set<string>();

  stack.forEach((element, elementIndex) => {
    if (!svg.contains(element) || !(element instanceof SVGElement)) return;
    const keys = element.getAttribute('data-props');
    if (!keys) return;

    for (const key of keys.split('|')) {
      const property = properties.get(key);
      if (!property) continue;
      const dedupe = `${elementIndex}|${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      let effectiveAlpha = chainOpacity(element, svg, property.kind);
      if (property.stop !== undefined && effectiveAlpha > 0) {
        const slot = slots[property.slots[0] ?? -1];
        const ramp = slot ? readAlphaStops(doc, slot.path) : [];
        if (ramp.length) {
          const t = gradientOffsetAt(element, svg, clientX, clientY);
          if (t !== null) effectiveAlpha *= alphaAt(ramp, t);
        }
      }

      if (!includeTransparent && effectiveAlpha < alphaFloor) continue;
      hits.push({ element, property, effectiveAlpha, depth: hits.length });
    }
  });

  return hits.map((h, depth) => ({ ...h, depth }));
}

/**
 * Dim everything except the given elements and their ancestors.
 *
 * This replaces the proof of concept's blinking magenta. Flashing a colour tells you
 * *that* something changed; dimming the rest lets you actually look at the shape and
 * decide what it is — which is the whole question being answered here.
 *
 * Returns a function that puts the canvas back.
 */
export function xray(svg: SVGSVGElement, keep: Iterable<Element>): () => void {
  const kept = new Set<Element>();
  const targets: Element[] = [];
  for (const el of keep) {
    targets.push(el);
    for (let n: Element | null = el; n && n !== svg.parentElement; n = n.parentElement) kept.add(n);
  }
  if (!targets.length) return () => {};

  const dimmed: { el: SVGElement; opacity: string }[] = [];
  const walk = (el: Element) => {
    for (const child of el.children) {
      if (!(child instanceof SVGElement)) continue;
      if (kept.has(child)) {
        walk(child);
        continue;
      }
      dimmed.push({ el: child, opacity: child.style.opacity });
      child.style.opacity = '0.1';
    }
  };
  walk(svg);

  return () => {
    for (const { el, opacity } of dimmed) el.style.opacity = opacity;
  };
}

/**
 * Trace elements on the canvas without touching their paint.
 *
 * `outline` is deliberately not used: on an SVG node it draws the bounding box, which
 * points at a rectangle the user never sees rather than at the actual shape. A tight
 * drop-shadow follows the real geometry, and the x-ray dimming does the rest.
 */
export function highlight(elements: SVGElement | Iterable<SVGElement> | null): () => void {
  if (!elements) return () => {};
  const list = elements instanceof SVGElement ? [elements] : [...elements];
  const previous = list.map((el) => ({ el, filter: el.style.filter }));
  for (const el of list) {
    el.style.filter = 'drop-shadow(0 0 1px #ff00ff) drop-shadow(0 0 2px #ff00ff)';
  }
  return () => {
    for (const { el, filter } of previous) el.style.filter = filter;
  };
}

/** Elements painted by a given colour property. */
export function elementsForKeys(svg: SVGSVGElement, keys: Iterable<string>): SVGElement[] {
  const wanted = new Set(keys);
  if (!wanted.size) return [];
  const out: SVGElement[] = [];
  for (const el of svg.querySelectorAll<SVGElement>('[data-props]')) {
    if (el.getAttribute('data-props')!.split('|').some((k) => wanted.has(k))) out.push(el);
  }
  return out;
}

/** Minimal structural typing for the parts of a Lottie document we touch.
 *  Everything else is passed through untouched, so unknown fields survive a round-trip. */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** A path from the document root to a value: object keys and array indices. */
export type Path = readonly (string | number)[];

export type LayerType =
  | 0 // precomp
  | 1 // solid
  | 2 // image
  | 3 // null
  | 4 // shape
  | 5 // text
  | 6 // audio
  | 7 // video placeholder
  | 13 // camera
  | number; // ...and whatever else exporters emit (25, 29 seen in the wild)

/** How the colour is stored at `path` + `offset`. */
export type ColorEncoding =
  /** three consecutive numbers, 0..1 (or 0..255 in sloppy exports) */
  | 'rgb01'
  /** a `#RRGGBB` string in a single field (solid layers' `sc`) */
  | 'hexString';

export type SlotKind =
  | 'fill'
  | 'stroke'
  | 'gradient-fill'
  | 'gradient-stroke'
  | 'solid-layer'
  | 'text-fill'
  | 'text-stroke';

export interface LayerRef {
  /** Path to the layer object itself — used for renaming (`nm`) and for the layer tree. */
  path: Path;
  /** `nm`, or null when the exporter stripped it. */
  name: string | null;
  ty: LayerType;
  /** in-point / out-point in frames */
  ip: number;
  op: number;
  /** `ind`, the layer's own id inside its composition */
  ind: number | null;
  /** `refId` for precomps and images */
  refId: string | null;
  /** The layer has `masksProperties`. Masks are clickable but hold no colour. */
  hasMask: boolean;
  /**
   * Track matte role: `target` uses the layer above it as a matte (`tt`), `source` is
   * that layer (`td`). Both are hit-testable and both confuse anyone trying to click
   * the thing underneath, so they are called out rather than silently listed.
   */
  matte: 'none' | 'source' | 'target';
}

/** A single addressable colour in the document.
 *  `path`/`offset`/`encoding` are pure data, so a slot survives JSON serialisation
 *  and can be handed to the CLI, an MCP tool or `meta.themeStudio`. */
export interface Slot {
  /** Position in the ordered slot list. Stable for a given document structure. */
  index: number;
  kind: SlotKind;
  encoding: ColorEncoding;
  /** Path to the container holding the colour: the numeric array, or the layer for `hexString`. */
  path: Path;
  /**
   * Address of the single rendered colour this slot drives.
   *
   * Slots sharing a key are the *same JSON value* seen more than once, and cannot be
   * given different colours. That happens two ways: a precomp asset referenced by
   * several layers is one object visited once per reference, and the keyframes of an
   * animated fill interpolate into one painted colour. In one corpus file, 110 slots
   * collapse to 11 editable colours this way.
   */
  renderKey: string;
  /** Index of the first channel inside that array (0 for `hexString`). */
  offset: number;
  hex: string;
  /** Chain of layers from the root composition down to the owning layer. */
  layerTrail: LayerRef[];
  /** Trail of shape-group names inside the layer, e.g. `["Group 1", "Ellipse", "Fill"]`. */
  shapeTrail: string[];
  /** Opacity of the owning fill/stroke/gradient (`o.k`), when it is a plain number. */
  opacity: number | null;
  /** Gradient stops only: which stop this is, and the stop's position 0..1. */
  stop?: { i: number; position: number };
  /** Animated fill/stroke keyframes only. */
  keyframe?: { i: number; field: 's' | 'e' };
  /** Animated text documents only: which `t.d.k` entry this colour belongs to. */
  textDoc?: { i: number };
}

/** One alpha stop of a gradient ramp: position 0..1 → alpha 0..1. */
export interface AlphaStop {
  position: number;
  alpha: number;
}

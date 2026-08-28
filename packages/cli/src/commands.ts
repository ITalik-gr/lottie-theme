import {
  applyEdits, buildPalette, collectProperties, collectSlots, describeSlot, checkCompatibility,
  emptyEdits, embedEdits, portableEdits, readEmbeddedEdits, suggestTheme, canonicalHex, isHex,
  type Slot, type ThemeEdits,
} from '@lottie-theme/core';

/**
 * The CLI's behaviour, with no filesystem or process in it.
 *
 * The point of the whole package layout is that a person clicking in the browser and a
 * script running in CI change a file the same way. Keeping these functions pure keeps
 * them honest — and testable without touching a disk.
 */

export interface ReportLine {
  hex: string;
  count: number;
  kinds: string[];
}

export function report(doc: unknown): { slots: number; properties: number; colors: ReportLine[] } {
  const slots = collectSlots(doc);
  return {
    slots: slots.length,
    properties: collectProperties(slots).length,
    colors: buildPalette(slots).map((e) => ({ hex: e.hex, count: e.count, kinds: e.kinds })),
  };
}

export function list(doc: unknown): { index: number; hex: string; description: string }[] {
  return collectSlots(doc).map((slot: Slot) => ({
    index: slot.index,
    hex: slot.hex,
    description: describeSlot(slot),
  }));
}

/** `OLD=NEW` for a colour, `12=NEW` for a single slot. */
export function parseAssignments(args: readonly string[]): ThemeEdits {
  const edits: ThemeEdits = { version: 1, byHex: {}, byIndex: {} };
  for (const arg of args) {
    const at = arg.indexOf('=');
    if (at < 0) throw new Error(`expected KEY=VALUE, got ${JSON.stringify(arg)}`);
    const key = arg.slice(0, at);
    const value = arg.slice(at + 1);
    if (!isHex(value)) throw new Error(`${JSON.stringify(value)} is not a colour`);
    if (/^\d+$/.test(key)) edits.byIndex![Number(key)] = canonicalHex(value);
    else if (isHex(key)) edits.byHex![canonicalHex(key)] = canonicalHex(value);
    else throw new Error(`${JSON.stringify(key)} is neither a colour nor a slot index`);
  }
  return edits;
}

/** Merge edit sets left to right. Later sets win. */
export function mergeEdits(sets: readonly ThemeEdits[]): ThemeEdits {
  const out: ThemeEdits = emptyEdits();
  for (const set of sets) {
    out.byHex = { ...(out.byHex ?? {}), ...(set.byHex ?? {}) };
    out.byIndex = { ...(out.byIndex ?? {}), ...(set.byIndex ?? {}) };
    out.alpha = { ...(out.alpha ?? {}), ...(set.alpha ?? {}) };
    out.names = { ...(out.names ?? {}), ...(set.names ?? {}) };
    out.groups = { ...(out.groups ?? {}), ...(set.groups ?? {}) };
    out.images = { ...(out.images ?? {}), ...(set.images ?? {}) };
  }
  return out;
}

export interface ApplyOptions {
  /** Also honour an edit set already embedded in the document. */
  useEmbedded?: boolean;
  /** Write the edit set into the output under `meta.themeStudio`. */
  embed?: boolean;
  /** Only apply the parts that survive a structure mismatch. */
  reference?: readonly Slot[];
}

export interface ApplyReport {
  doc: unknown;
  edits: ThemeEdits;
  colorsChanged: number;
  totalSlots: number;
  warnings: string[];
}

export function apply(doc: unknown, edits: ThemeEdits, options: ApplyOptions = {}): ApplyReport {
  const embedded = options.useEmbedded ? readEmbeddedEdits(doc) : null;
  let effective = embedded ? mergeEdits([embedded, edits]) : edits;

  const warnings: string[] = [];
  if (options.reference) {
    const { compatible, reason } = checkCompatibility(options.reference, collectSlots(doc));
    if (!compatible) {
      warnings.push(`${reason}; applied by-hex edits only`);
      effective = portableEdits(effective, false);
    }
  }

  const result = applyEdits(doc, effective);
  if (options.embed) embedEdits(result.doc, effective);
  for (const hex of result.unusedHex) warnings.push(`no slot uses ${hex}`);
  for (const index of result.unusedIndex) warnings.push(`slot ${index} is out of range`);

  return {
    doc: result.doc,
    edits: effective,
    colorsChanged: result.colorsChanged,
    totalSlots: result.totalSlots,
    warnings,
  };
}

/** The auto-generated opposite theme, as an edit set. */
export function suggest(doc: unknown, target: 'light' | 'dark', backdrop?: string) {
  const slots = collectSlots(doc);
  return suggestTheme(doc, slots, collectProperties(slots), { target, backdrop });
}

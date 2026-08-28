import type { Slot } from './types.ts';
import type { ThemeEdits } from './edits.ts';
import { canonicalHex } from './color.ts';

/**
 * Named sets of slots — `surface`, `text-muted`, `accent`, `border`.
 *
 * Editing 150 identical slots one at a time is the thing that makes this work tedious.
 * A group is just a named list of slot indices, so a slot can belong to several, the
 * classifier can pre-fill them and a person can correct them. Because indices are stable,
 * a named group survives export and re-import — and that is what makes a batch possible:
 * name the groups once, apply the same theme to a whole folder.
 */
export interface SlotGroup {
  name: string;
  slots: number[];
  /** Current colour, when every member agrees on one. */
  hex: string | null;
}

export function listGroups(edits: ThemeEdits, slots: readonly Slot[]): SlotGroup[] {
  return Object.entries(edits.groups ?? {})
    .map(([name, indices]) => {
      const members = indices.filter((i) => i >= 0 && i < slots.length);
      const colors = new Set(members.map((i) => edits.byIndex?.[i] ?? slots[i]!.hex));
      return { name, slots: members, hex: colors.size === 1 ? [...colors][0]! : null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function setGroup(edits: ThemeEdits, name: string, slots: readonly number[]): ThemeEdits {
  const trimmed = name.trim();
  if (!trimmed) return edits;
  return { ...edits, groups: { ...(edits.groups ?? {}), [trimmed]: [...new Set(slots)].sort((a, b) => a - b) } };
}

export function removeGroup(edits: ThemeEdits, name: string): ThemeEdits {
  const groups = { ...(edits.groups ?? {}) };
  delete groups[name];
  return { ...edits, groups };
}

/** Recolour every slot of a group. */
export function colorGroup(edits: ThemeEdits, name: string, hex: string): ThemeEdits {
  const members = edits.groups?.[name] ?? [];
  const byIndex = { ...(edits.byIndex ?? {}) };
  for (const index of members) byIndex[index] = canonicalHex(hex);
  return { ...edits, byIndex };
}

/**
 * A fingerprint of the document's colour structure.
 *
 * Two animations exported from the same master differ in their colours but not in the
 * shape of their slot list. Comparing signatures is what decides whether an edit set
 * built for one file can safely be applied to another — index-addressed edits land on
 * the wrong shapes otherwise, silently.
 */
export function structureSignature(slots: readonly Slot[]): string {
  return slots.map((s) => `${s.kind[0]}${s.stop?.i ?? ''}`).join('') + `|${slots.length}`;
}

export interface Compatibility {
  compatible: boolean;
  reason: string;
}

/** Whether an edit set built against `reference` can be applied to `candidate`. */
export function checkCompatibility(
  reference: readonly Slot[],
  candidate: readonly Slot[],
): Compatibility {
  if (reference.length !== candidate.length) {
    return { compatible: false, reason: `${candidate.length} slots, expected ${reference.length}` };
  }
  if (structureSignature(reference) !== structureSignature(candidate)) {
    return { compatible: false, reason: 'same slot count but a different structure' };
  }
  return { compatible: true, reason: 'same slot structure' };
}

/**
 * Narrow an edit set to the parts that travel safely to a different document.
 *
 * Colour-by-hex, groups and alpha ramps are addressed by value or by path, so they carry
 * over. Per-slot colours, layer names and image replacements are addressed by position
 * and only make sense where the structure matches — so they are dropped unless it does.
 */
export function portableEdits(edits: ThemeEdits, structureMatches: boolean): ThemeEdits {
  if (structureMatches) return edits;
  return {
    version: 1,
    ...(edits.byHex ? { byHex: edits.byHex } : {}),
  };
}

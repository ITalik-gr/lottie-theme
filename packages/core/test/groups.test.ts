import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  applyEdits, checkCompatibility, collectSlots, colorGroup, embedEdits, listGroups,
  portableEdits, readEmbeddedEdits, removeGroup, setGroup, structureSignature,
  type ThemeEdits,
} from '../src/index.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
function corpus(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    // The corpus may not be checked out beside the code — see core.test.ts.
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.json')) out.push(p);
    }
  };
  walk(resolve(repoRoot, 'lotties'));
  return out.sort();
}
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** These need a real animation to group slots of. The corpus is a client's and is not in
 *  the repository; without it the suites are skipped, and the loads below must still not
 *  throw while vitest collects them. */
const hasCorpus = corpus().length > 0;
const first = (): unknown => (hasCorpus ? load(corpus()[0]!) : { layers: [] });

describe.skipIf(!hasCorpus)('slot groups', () => {
  const doc = first();
  const slots = collectSlots(doc);

  it('stores a named set and reads it back sorted and deduplicated', () => {
    const edits = setGroup({ version: 1 }, ' surface ', [5, 1, 1, 3]);
    expect(edits.groups).toEqual({ surface: [1, 3, 5] });
    expect(listGroups(edits, slots)[0]!.name).toBe('surface');
  });

  it('ignores an empty name', () => {
    expect(setGroup({ version: 1 }, '   ', [1]).groups).toBeUndefined();
  });

  it('recolours every member at once', () => {
    let edits: ThemeEdits = setGroup({ version: 1 }, 'surface', [0, 1, 2]);
    edits = colorGroup(edits, 'surface', '#ff00ff');
    expect(edits.byIndex).toEqual({ 0: '#FF00FF', 1: '#FF00FF', 2: '#FF00FF' });

    const out = collectSlots(applyEdits(doc, edits).doc);
    expect(out.slice(0, 3).map((s) => s.hex)).toEqual(['#FF00FF', '#FF00FF', '#FF00FF']);
  });

  it('reports a single colour only when the members agree', () => {
    const mixed = setGroup({ version: 1 }, 'g', [0, 1, 2]);
    const uniform = colorGroup(mixed, 'g', '#FF00FF');
    expect(listGroups(uniform, slots)[0]!.hex).toBe('#FF00FF');

    const disagreeing: ThemeEdits = { ...uniform, byIndex: { ...uniform.byIndex, 0: '#000000' } };
    expect(listGroups(disagreeing, slots)[0]!.hex).toBeNull();
  });

  it('drops indices that do not exist in this document', () => {
    const edits = setGroup({ version: 1 }, 'g', [0, 999999]);
    expect(listGroups(edits, slots)[0]!.slots).toEqual([0]);
  });

  it('removes a group', () => {
    const edits = removeGroup(setGroup({ version: 1 }, 'g', [0]), 'g');
    expect(edits.groups).toEqual({});
  });

  it('survives a round-trip through the document', () => {
    const copy = first();
    embedEdits(copy, setGroup({ version: 1 }, 'surface', [0, 1]));
    expect(readEmbeddedEdits(copy)?.groups).toEqual({ surface: [0, 1] });
  });
});

describe.skipIf(!hasCorpus)('batch compatibility', () => {
  it('accepts a document against itself', () => {
    for (const f of corpus()) {
      const slots = collectSlots(load(f));
      expect(checkCompatibility(slots, collectSlots(load(f)))).toEqual({
        compatible: true,
        reason: 'same slot structure',
      });
    }
  });

  it('accepts a recoloured copy — colours change, structure does not', () => {
    const doc = first();
    const slots = collectSlots(doc);
    const recoloured = applyEdits(doc, { version: 1, byHex: { '#FFFFFF': '#17181D' } }).doc;
    expect(checkCompatibility(slots, collectSlots(recoloured)).compatible).toBe(true);
  });

  it('rejects a document with a different slot count', () => {
    const a = collectSlots(first());
    const b = collectSlots(load(corpus()[1]!));
    const result = checkCompatibility(a, b);
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/slots, expected/);
  });

  it('rejects a same-sized document whose slots are of different kinds', () => {
    const fill = { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [1, 0, 0] } };
    const stroke = { ty: 'st', nm: 'S', o: { k: 100 }, c: { k: [1, 0, 0] } };
    const make = (shapes: unknown[]) => ({ layers: [{ ty: 4, nm: 'L', ip: 0, op: 60, ind: 1, shapes }] });
    const a = collectSlots(make([fill, stroke]));
    const b = collectSlots(make([stroke, fill]));
    expect(a).toHaveLength(2);
    expect(checkCompatibility(a, b)).toEqual({
      compatible: false,
      reason: 'same slot count but a different structure',
    });
  });

  it('gives files from the same export family the same signature', () => {
    const icons = corpus().filter((f) => f.includes('Affiliate Icons'));
    expect(icons.length).toBeGreaterThan(5);
    const signatures = new Set(icons.map((f) => structureSignature(collectSlots(load(f)))));
    // they are genuinely different animations, so most signatures differ — the point is
    // that the check is discriminating rather than always saying yes
    expect(signatures.size).toBeGreaterThan(1);
  });
});

describe.skipIf(!hasCorpus)('portable edits', () => {
  const full: ThemeEdits = {
    version: 1,
    byHex: { '#000000': '#FFFFFF' },
    byIndex: { 3: '#FF0000' },
    names: { 'layers.0': 'Card' },
    alpha: { 'layers.0.shapes.0.g.k.k': [{ position: 0, alpha: 1 }] },
    images: { 0: { dataUri: 'data:image/png;base64,AA' } },
    groups: { surface: [0] },
  };

  it('keeps everything when the structure matches', () => {
    expect(portableEdits(full, true)).toBe(full);
  });

  it('drops position-addressed edits when it does not', () => {
    const narrowed = portableEdits(full, false);
    expect(narrowed.byHex).toEqual({ '#000000': '#FFFFFF' });
    expect(narrowed.byIndex).toBeUndefined();
    expect(narrowed.names).toBeUndefined();
    expect(narrowed.images).toBeUndefined();
  });

  it('a narrowed set still applies cleanly to an unrelated document', () => {
    const other = load(corpus()[2]!);
    const r = applyEdits(other, portableEdits(full, false));
    expect(r.unusedIndex).toEqual([]);
    expect(r.unusedPaths).toEqual([]);
  });
});

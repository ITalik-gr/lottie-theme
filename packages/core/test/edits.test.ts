import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  applyEdits, applyEditsInPlace, buildLayerTree, collectSlots, countEdits, embedEdits, emptyEdits,
  listEffectColors, listGradients, mergeEdits,
  isEmptyEdits, readAlphaStops, readEmbeddedEdits, stripEmbeddedEdits, type ThemeEdits,
} from '../src/index.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
function corpus(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    // The corpus is 216 MB of a client's animations and may or may not be checked out
    // beside the code. Its absence makes these tests vacuous, not failing — the fixtures
    // in `test/fixtures` are what CI can always rely on.
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.json')) out.push(p);
    }
  };
  walk(resolve(repoRoot, 'lotties'));
  return out.sort();
}
/** Some checks below need real animations. The corpus is a client's and is not in the
 *  repository; without it they are skipped rather than failing on an empty list. */
const hasCorpus = corpus().length > 0;

const load = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const gradientDoc = () => ({
  layers: [{
    ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
    shapes: [{ ty: 'gf', nm: 'G', o: { k: 100 }, g: { p: 2, k: { k: [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0] } } }],
  }],
});

describe('edit sets', () => {
  it('starts empty and knows it', () => {
    expect(isEmptyEdits(emptyEdits())).toBe(true);
    expect(isEmptyEdits({ version: 1, byHex: { '#000000': '#FFFFFF' } })).toBe(false);
    expect(isEmptyEdits({ version: 1, names: { 'layers.0': 'Card' } })).toBe(false);
  });

  it('applies colours, alpha and names in one pass', () => {
    const doc = gradientDoc();
    const edits: ThemeEdits = {
      version: 1,
      byHex: { '#FFFFFF': '#17181D' },
      alpha: { 'layers.0.shapes.0.g.k.k': [{ position: 0, alpha: 1 }, { position: 1, alpha: 0.5 }] },
      names: { 'layers.0': 'Card background' },
    };
    const r = applyEdits(doc, edits);
    expect(r.colorsChanged).toBe(1);
    expect(r.rampsChanged).toBe(1);
    expect(r.namesChanged).toBe(1);

    const out = r.doc as ReturnType<typeof gradientDoc>;
    expect(collectSlots(out).map((s) => s.hex)).toEqual(['#17181D', '#000000']);
    expect(readAlphaStops(out, ['layers', 0, 'shapes', 0, 'g', 'k', 'k']))
      .toEqual([{ position: 0, alpha: 1 }, { position: 1, alpha: 0.5 }]);
    expect(buildLayerTree(out, [])[0]!.name).toBe('Card background');
  });

  it('leaves the source document untouched', () => {
    const doc = gradientDoc();
    const snapshot = JSON.stringify(doc);
    applyEdits(doc, { version: 1, byHex: { '#FFFFFF': '#000000' }, names: { 'layers.0': 'x' } });
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('an empty edit set changes nothing at all', () => {
    for (const f of corpus()) {
      const doc = load(f);
      const before = JSON.stringify(doc);
      const r = applyEdits(doc, emptyEdits());
      expect(JSON.stringify(r.doc)).toBe(before);
      expect(r.colorsChanged + r.rampsChanged + r.namesChanged).toBe(0);
    }
  });

  it.skipIf(!hasCorpus)('renaming does not shift slot indices', () => {
    const doc = load(corpus()[0]!);
    const before = collectSlots(doc);
    const tree = buildLayerTree(doc, before);
    const names = Object.fromEntries(tree.slice(0, 5).map((n, i) => [n.path.join('.'), `Layer ${i}`]));
    const { doc: out } = applyEdits(doc, { version: 1, names });
    const after = collectSlots(out);
    expect(after.map((s) => s.hex)).toEqual(before.map((s) => s.hex));
    expect(after.map((s) => s.renderKey)).toEqual(before.map((s) => s.renderKey));
  });

  it('reports entries that matched nothing rather than failing silently', () => {
    const r = applyEdits(gradientDoc(), {
      version: 1,
      byHex: { '#123456': '#FFFFFF' },
      byIndex: { 99: '#FFFFFF' },
      alpha: { 'layers.9.nope': [] },
      names: { 'layers.9': 'ghost' },
    });
    expect(r.unusedHex).toEqual(['#123456']);
    expect(r.unusedIndex).toEqual([99]);
    expect(r.unusedPaths.sort()).toEqual(['layers.9', 'layers.9.nope']);
  });

  it('mutates in place when asked', () => {
    const doc = gradientDoc();
    applyEditsInPlace(doc, { version: 1, byHex: { '#FFFFFF': '#FF00FF' } });
    expect(collectSlots(doc)[0]!.hex).toBe('#FF00FF');
  });
});

describe('embedded metadata', () => {
  it('round-trips through the document', () => {
    const doc = gradientDoc() as Record<string, unknown>;
    const edits: ThemeEdits = {
      version: 1,
      byHex: { '#FFFFFF': '#17181D' },
      names: { 'layers.0': 'Card' },
      groups: { surface: [0, 1] },
    };
    embedEdits(doc, edits);
    expect(readEmbeddedEdits(doc)).toEqual(edits);

    // and the animation is untouched — a player just ignores the extra field
    expect(collectSlots(doc).map((s) => s.hex)).toEqual(['#FFFFFF', '#000000']);
  });

  it('survives a colour map being applied on top', () => {
    const doc = gradientDoc() as Record<string, unknown>;
    embedEdits(doc, { version: 1, groups: { surface: [0] } });
    const { doc: out } = applyEdits(doc, { version: 1, byHex: { '#FFFFFF': '#000000' } });
    expect(readEmbeddedEdits(out)?.groups).toEqual({ surface: [0] });
  });

  it('ignores metadata from an unknown version', () => {
    const doc = { meta: { themeStudio: { version: 99, byHex: {} } } };
    expect(readEmbeddedEdits(doc)).toBeNull();
  });

  it('ignores a document with no metadata', () => {
    expect(readEmbeddedEdits(gradientDoc())).toBeNull();
    expect(readEmbeddedEdits(null)).toBeNull();
  });

  it('strips cleanly for a sidecar export', () => {
    const doc = gradientDoc() as Record<string, unknown>;
    embedEdits(doc, { version: 1, groups: { a: [0] } });
    stripEmbeddedEdits(doc);
    expect(doc.meta).toBeUndefined();
    expect(readEmbeddedEdits(doc)).toBeNull();
  });

  it('keeps other meta fields when stripping', () => {
    const doc = { meta: { g: 'Bodymovin', themeStudio: { version: 1 } }, layers: [] };
    stripEmbeddedEdits(doc);
    expect(doc.meta).toEqual({ g: 'Bodymovin' });
  });
});

describe('merging edit sets', () => {
  it('lets later entries win per key without disturbing the other categories', () => {
    const base = {
      version: 1 as const,
      byIndex: { 0: '#FFFFFF', 1: '#000000' },
      names: { '0': 'card' },
      groups: { surface: [0] },
    };
    const merged = mergeEdits(base, { version: 1, byIndex: { 1: '#111111' } });

    expect(merged.byIndex).toEqual({ 0: '#FFFFFF', 1: '#111111' });
    // A colour map arriving on its own must not take the layer names with it.
    expect(merged.names).toEqual({ '0': 'card' });
    expect(merged.groups).toEqual({ surface: [0] });
  });

  it('leaves the set it was given alone', () => {
    const base = { version: 1 as const, byHex: { '#000000': '#FFFFFF' } };
    mergeEdits(base, { version: 1, byHex: { '#000000': '#111111' } });
    expect(base.byHex).toEqual({ '#000000': '#FFFFFF' });
  });

  it('counts what a set actually asks for', () => {
    expect(countEdits(emptyEdits())).toBe(0);
    expect(countEdits({ version: 1, byIndex: { 0: '#FFF', 1: '#000' }, names: { '2': 'x' } })).toBe(3);
  });
});

describe('gradients as one thing', () => {
  /** A two-stop linear gradient fill with an alpha ramp that fades out. */
  const gradientDoc = () => ({
    v: '5.7.0', fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [
      {
        ty: 4, nm: 'badge', ip: 0, op: 30, ind: 1,
        shapes: [
          {
            ty: 'gf', t: 1, nm: 'grad',
            g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0] } },
          },
        ],
      },
    ],
  });

  it('reads a ramp as stops rather than as a flat array of numbers', () => {
    const doc = gradientDoc();
    const ramps = listGradients(doc, collectSlots(doc));
    expect(ramps).toHaveLength(1);
    expect(ramps[0]!.type).toBe('linear');
    expect(ramps[0]!.layer).toBe('badge');
    expect(ramps[0]!.stops.map((s) => s.hex)).toEqual(['#FF0000', '#0000FF']);
    expect(ramps[0]!.alpha.map((a) => a.alpha)).toEqual([1, 0]);
  });

  it('moves a stop along the ramp without disturbing its colour', () => {
    const doc = gradientDoc();
    const path = listGradients(doc, collectSlots(doc))[0]!.path;
    const { doc: out } = applyEdits(doc, { version: 1, positions: { [path]: [0, 0.35] } });
    const ramps = listGradients(out, collectSlots(out));
    expect(ramps[0]!.stops.map((s) => s.position)).toEqual([0, 0.35]);
    expect(ramps[0]!.stops.map((s) => s.hex)).toEqual(['#FF0000', '#0000FF']);
    // the alpha ramp still sits in the tail, untouched
    expect(ramps[0]!.alpha.map((a) => a.alpha)).toEqual([1, 0]);
  });

  it('keeps a colour edit and a position edit on the same stop independent', () => {
    const doc = gradientDoc();
    const ramp = listGradients(doc, collectSlots(doc))[0]!;
    const { doc: out } = applyEdits(doc, {
      version: 1,
      byIndex: { [ramp.stops[1]!.slot]: '#00FF00' },
      positions: { [ramp.path]: [0.2, 0.8] },
    });
    const after = listGradients(out, collectSlots(out))[0]!;
    expect(after.stops.map((s) => [s.position, s.hex])).toEqual([[0.2, '#FF0000'], [0.8, '#00FF00']]);
  });

  it('sorts positions rather than trusting them — an out-of-order ramp renders as an edge', () => {
    const doc = gradientDoc();
    const path = listGradients(doc, collectSlots(doc))[0]!.path;
    const { doc: out } = applyEdits(doc, { version: 1, positions: { [path]: [0.9, 0.1] } });
    expect(listGradients(out, collectSlots(out))[0]!.stops.map((s) => s.position)).toEqual([0.1, 0.9]);
  });

  it('reports a ramp it cannot find instead of throwing', () => {
    const result = applyEdits(gradientDoc(), { version: 1, positions: { 'layers.9.no.such.ramp': [0, 1] } });
    expect(result.unusedPaths).toContain('layers.9.no.such.ramp');
  });
});

describe('reading a gradient out of an edited document', () => {
  it('reports the colours and positions the document has now, not the ones it shipped with', () => {
    const doc = {
      v: '5.7.0', fr: 30, ip: 0, op: 30, w: 100, h: 100,
      layers: [
        {
          ty: 4, nm: 'badge', ip: 0, op: 30, ind: 1,
          shapes: [{ ty: 'gf', t: 1, nm: 'grad', g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } } }],
        },
      ],
    };
    // The slots are collected once, from the file as it shipped — which is what the editor
    // holds — and then the same list is used to read a document that has been edited.
    const slots = collectSlots(doc);
    const path = listGradients(doc, slots)[0]!.path;
    const { doc: edited } = applyEdits(doc, {
      version: 1,
      byIndex: { 0: '#00FF00' },
      positions: { [path]: [0.3, 1] },
    });
    const ramp = listGradients(edited, slots)[0]!;
    expect(ramp.stops.map((s) => [s.position, s.hex])).toEqual([[0.3, '#00FF00'], [1, '#0000FF']]);
  });
});

describe('colour that lives on an effect', () => {
  /** A layer whose only colour is a drop shadow — nothing in its shapes mentions it. */
  const withShadow = () => ({
    v: '5.7.0', fr: 30, ip: 0, op: 30, w: 100, h: 100,
    layers: [
      {
        ty: 4, nm: 'badge', ip: 0, op: 30, ind: 1,
        shapes: [{ ty: 'fl', c: { a: 0, k: [0, 1, 1, 1] } }],
        ef: [
          {
            ty: 25, nm: 'Drop Shadow',
            ef: [
              { ty: 2, nm: 'Shadow Color', v: { a: 0, k: [0.678, 0.408, 0.988] } },
              { ty: 0, nm: 'Opacity', v: { a: 0, k: 127.5 } },
            ],
          },
        ],
      },
    ],
  });

  it('finds a colour no palette can see', () => {
    const found = listEffectColors(withShadow());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      path: 'layers.0.ef.0.ef.0.v.k',
      layer: 'badge',
      effect: 'Drop Shadow',
      param: 'Shadow Color',
      hex: '#AD68FC',
      opacity: 127.5,
    });
  });

  it('does not touch the slot numbering — files already converted keep their indices', () => {
    const doc = withShadow();
    expect(collectSlots(doc).map((s) => s.hex)).toEqual(['#00FFFF']);
  });

  it('recolours it through an ordinary edit set', () => {
    const doc = withShadow();
    const result = applyEdits(doc, { version: 1, effects: { 'layers.0.ef.0.ef.0.v.k': '#28DFDF' } });
    expect(result.effectsChanged).toBe(1);
    expect(listEffectColors(result.doc)[0]!.hex).toBe('#28DFDF');
    // and the original is untouched, like every other edit
    expect(listEffectColors(doc)[0]!.hex).toBe('#AD68FC');
  });

  it('reports a path it cannot find instead of throwing', () => {
    const result = applyEdits(withShadow(), { version: 1, effects: { 'layers.9.ef.0.ef.0.v.k': '#FFFFFF' } });
    expect(result.unusedPaths).toContain('layers.9.ef.0.ef.0.v.k');
  });

  it('leaves an animated effect colour alone rather than describing it with one hex', () => {
    const doc = withShadow();
    doc.layers[0]!.ef[0]!.ef[0]!.v = { a: 1, k: [{ t: 0, s: [1, 0, 0] }, { t: 30, s: [0, 0, 1] }] } as never;
    expect(listEffectColors(doc)).toEqual([]);
  });
});

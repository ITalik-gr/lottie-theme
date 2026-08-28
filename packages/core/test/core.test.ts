import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  collectSlots, readSlot, writeSlot, readAlphaStops, alphaAt, fadesToTransparent,
  writeAlphaStops, buildPalette, clusterPalette, recolor, recolorInPlace,
  fromHex, toHex, canonicalHex, rgbToOklch, oklchToRgb, oklchToRgbInGamut, toGamut, isInGamut,
  contrastRatio, deltaEOk, rgbToOklab,
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

describe('colour', () => {
  it('round-trips hex through rgb', () => {
    for (const hex of ['#000000', '#FFFFFF', '#38E887', '#17181D', '#4C6EFC']) {
      expect(toHex(fromHex(hex))).toBe(hex);
    }
  });

  it('accepts shorthand and missing hash', () => {
    expect(canonicalHex('fff')).toBe('#FFFFFF');
    expect(canonicalHex('#38e887')).toBe('#38E887');
  });

  it('rejects junk instead of silently returning black', () => {
    expect(() => fromHex('not a colour')).toThrow();
    expect(() => fromHex('#12345')).toThrow();
  });

  it('normalises 0..255 channels that sloppy exporters emit', () => {
    expect(toHex([255, 128, 0])).toBe(toHex([1, 128 / 255, 0]));
  });

  it('round-trips through OKLCH', () => {
    for (const hex of ['#38E887', '#4C6EFC', '#808080', '#17181D']) {
      expect(toHex(oklchToRgb(rgbToOklch(fromHex(hex))))).toBe(hex);
    }
  });

  it('keeps hue through a lightness flip when the result is gamut-mapped', () => {
    // `L -> 1 - L` at unchanged chroma lands outside sRGB for a saturated colour.
    // Clamping the channels there swings the hue; lowering chroma instead does not.
    const [L, C, h] = rgbToOklch(fromHex('#38E887'));
    expect(isInGamut([1 - L, C, h])).toBe(false);

    const clamped = rgbToOklch(oklchToRgb([1 - L, C, h]));
    expect(Math.abs(clamped[2] - h)).toBeGreaterThan(5); // the bug we are avoiding

    const mapped = rgbToOklch(oklchToRgbInGamut([1 - L, C, h]));
    expect(Math.abs(mapped[2] - h)).toBeLessThan(1);
    expect(mapped[0]).toBeCloseTo(1 - L, 2);
    expect(mapped[1]).toBeLessThan(C);
  });

  it('leaves in-gamut colours alone', () => {
    for (const hex of ['#808080', '#17181D', '#4C6EFC', '#FFFFFF', '#000000']) {
      const lch = rgbToOklch(fromHex(hex));
      expect(toGamut(lch)).toEqual(lch);
      expect(toHex(oklchToRgbInGamut(lch))).toBe(hex);
    }
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio(fromHex('#FFFFFF'), fromHex('#000000'))).toBeCloseTo(21, 5);
    expect(contrastRatio(fromHex('#777777'), fromHex('#777777'))).toBeCloseTo(1, 5);
  });
});

describe('slots', () => {
  const files = corpus();

  it.skipIf(!hasCorpus)('finds the corpus', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((f) => [f.slice(repoRoot.length + 1), f]))('%s', (_name, file) => {
    const doc = load(file);
    const slots = collectSlots(doc);

    // every slot's path resolves and reads back the hex it reported
    for (const s of slots) {
      expect(readSlot(doc, s)).toBe(s.hex);
      expect(s.layerTrail.length).toBeGreaterThan(0);
    }

    // indices are dense and in order
    expect(slots.map((s) => s.index)).toEqual(slots.map((_, i) => i));
  });

  it.skipIf(!hasCorpus)('writes a colour back through the slot address', () => {
    const doc = load(files[0]!);
    const slots = collectSlots(doc);
    const target = slots[0]!;
    writeSlot(doc, target, '#FF00FF');
    expect(readSlot(doc, target)).toBe('#FF00FF');
    // re-collecting sees the new value at the same index
    expect(collectSlots(doc)[target.index]!.hex).toBe('#FF00FF');
  });

  it('picks up solid layers, which live outside the shape tree', () => {
    const doc = {
      layers: [
        { ty: 1, nm: 'BG', sc: '#17181d', sw: 100, sh: 100, ip: 0, op: 60, ind: 1, ks: { o: { k: 100 } } },
      ],
    };
    const slots = collectSlots(doc);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ kind: 'solid-layer', encoding: 'hexString', hex: '#17181D' });

    writeSlot(doc, slots[0]!, '#FFFFFF');
    expect(doc.layers[0]!.sc).toBe('#ffffff');
  });

  it('picks up text fill and stroke colours', () => {
    const doc = {
      layers: [
        {
          ty: 5, nm: 'Label', ip: 0, op: 60, ind: 1,
          t: { d: { k: [{ s: { t: 'Hello', fc: [1, 1, 1], sc: [0, 0, 0], f: 'Inter', s: 14 } }] } },
        },
      ],
    };
    const slots = collectSlots(doc);
    expect(slots.map((s) => [s.kind, s.hex])).toEqual([
      ['text-fill', '#FFFFFF'],
      ['text-stroke', '#000000'],
    ]);
  });

  it('descends into precomp assets in z-order', () => {
    const doc = {
      layers: [{ ty: 0, refId: 'pc', nm: 'Precomp', ip: 0, op: 60, ind: 1 }],
      assets: [
        {
          id: 'pc',
          layers: [
            { ty: 4, nm: 'A', ip: 0, op: 60, ind: 1, shapes: [{ ty: 'fl', nm: 'F', c: { k: [1, 0, 0] }, o: { k: 100 } }] },
            { ty: 4, nm: 'B', ip: 0, op: 60, ind: 2, shapes: [{ ty: 'fl', nm: 'F', c: { k: [0, 1, 0] }, o: { k: 100 } }] },
          ],
        },
      ],
    };
    const slots = collectSlots(doc);
    expect(slots.map((s) => s.hex)).toEqual(['#FF0000', '#00FF00']);
    expect(slots[0]!.layerTrail.map((l) => l.name)).toEqual(['Precomp', 'A']);
  });

  it('survives a precomp that references itself', () => {
    const doc = {
      layers: [{ ty: 0, refId: 'loop', nm: 'Root', ip: 0, op: 60, ind: 1 }],
      assets: [
        {
          id: 'loop',
          layers: [
            { ty: 4, nm: 'S', ip: 0, op: 60, ind: 1, shapes: [{ ty: 'fl', nm: 'F', c: { k: [1, 1, 1] }, o: { k: 100 } }] },
            { ty: 0, refId: 'loop', nm: 'Self', ip: 0, op: 60, ind: 2 },
          ],
        },
      ],
    };
    expect(collectSlots(doc).map((s) => s.hex)).toEqual(['#FFFFFF']);
  });
});

describe('gradient alpha ramps', () => {
  it('reads the stops that sit after the colour stops', () => {
    // 2 colour stops, then 2 alpha stops
    const doc = {
      layers: [{
        ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
        shapes: [{
          ty: 'gf', nm: 'G', o: { k: 100 },
          g: { p: 2, k: { k: [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0] } },
        }],
      }],
    };
    const path = ['layers', 0, 'shapes', 0, 'g', 'k', 'k'];
    expect(readAlphaStops(doc, path)).toEqual([
      { position: 0, alpha: 1 },
      { position: 1, alpha: 0 },
    ]);
    expect(collectSlots(doc).map((s) => s.hex)).toEqual(['#FFFFFF', '#000000']);
  });

  it('detects the fade-into-background pattern', () => {
    expect(fadesToTransparent([{ position: 0, alpha: 1 }, { position: 1, alpha: 0 }])).toBe(true);
    expect(fadesToTransparent([{ position: 0, alpha: 1 }, { position: 1, alpha: 1 }])).toBe(false);
    expect(fadesToTransparent([])).toBe(false);
  });

  it('interpolates alpha along the ramp', () => {
    const stops = [{ position: 0, alpha: 1 }, { position: 1, alpha: 0 }];
    expect(alphaAt(stops, 0)).toBe(1);
    expect(alphaAt(stops, 0.5)).toBeCloseTo(0.5, 6);
    expect(alphaAt(stops, 1)).toBe(0);
    expect(alphaAt([], 0.5)).toBe(1); // no ramp means opaque
  });

  it('rewrites the ramp without disturbing the colour stops', () => {
    const doc = {
      layers: [{
        ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
        shapes: [{ ty: 'gf', nm: 'G', o: { k: 100 }, g: { p: 2, k: { k: [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0] } } }],
      }],
    };
    const path = ['layers', 0, 'shapes', 0, 'g', 'k', 'k'];
    writeAlphaStops(doc, path, [{ position: 0, alpha: 1 }, { position: 0.5, alpha: 0.4 }, { position: 1, alpha: 0 }]);
    expect(doc.layers[0]!.shapes[0]!.g.k.k).toEqual([0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0.5, 0.4, 1, 0]);
    expect(collectSlots(doc).map((s) => s.hex)).toEqual(['#FFFFFF', '#000000']);
  });

  it.skipIf(!hasCorpus)('reads ramps from real files that have them', () => {
    const withGradients = corpus()
      .map((f) => ({ f, doc: load(f) }))
      .filter(({ doc }) => collectSlots(doc).some((s) => s.stop !== undefined));
    expect(withGradients.length).toBeGreaterThan(0);
    for (const { doc } of withGradients) {
      for (const s of collectSlots(doc)) {
        if (!s.stop) continue;
        const stops = readAlphaStops(doc, s.path);
        for (const a of stops) {
          expect(a.alpha).toBeGreaterThanOrEqual(0);
          expect(a.alpha).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('palette', () => {
  it.skipIf(!hasCorpus)('counts and groups by colour', () => {
    const slots = collectSlots(load(corpus()[0]!));
    const palette = buildPalette(slots);
    expect(palette.reduce((n, e) => n + e.count, 0)).toBe(slots.length);
    // sorted by usage
    expect(palette.map((e) => e.count)).toEqual([...palette.map((e) => e.count)].sort((a, b) => b - a));
    for (const e of palette) expect(e.slots).toHaveLength(e.count);
  });

  it('records which kinds of slot use a colour', () => {
    const doc = {
      layers: [
        { ty: 1, nm: 'BG', sc: '#ffffff', ip: 0, op: 60, ind: 1, ks: { o: { k: 100 } } },
        { ty: 4, nm: 'T', ip: 0, op: 60, ind: 2, shapes: [{ ty: 'fl', nm: 'F', c: { k: [1, 1, 1] }, o: { k: 100 } }] },
      ],
    };
    const entry = buildPalette(collectSlots(doc)).find((e) => e.hex === '#FFFFFF')!;
    expect(entry.kinds.sort()).toEqual(['fill', 'solid-layer']);
  });

  it('clusters near-identical colours that exporters split apart', () => {
    const palette = buildPalette([
      { hex: '#17181D', index: 0 }, { hex: '#17181D', index: 1 }, { hex: '#17181E', index: 2 },
      { hex: '#FFFFFF', index: 3 },
    ].map((s) => ({ ...s, kind: 'fill', encoding: 'rgb01', path: [], offset: 0, layerTrail: [], shapeTrail: [], opacity: null }) as never));
    const clusters = clusterPalette(palette);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.representative.hex).toBe('#17181D');
    expect(clusters[0]!.count).toBe(3);
  });
});

describe('recolor', () => {
  const file = corpus().find((f) => f.includes('Low Fidelity_anim(dark)'))!;

  it.skipIf(!hasCorpus)('maps by hex across every occurrence', () => {
    const doc = load(file);
    const before = buildPalette(collectSlots(doc));
    const top = before[0]!;
    const { doc: out, changed } = recolor(doc, { byHex: { [top.hex]: '#FF00FF' } });
    expect(changed).toBe(top.count);
    const after = buildPalette(collectSlots(out));
    expect(after.find((e) => e.hex === top.hex)).toBeUndefined();
    expect(after.find((e) => e.hex === '#FF00FF')!.count).toBe(top.count);
  });

  it.skipIf(!hasCorpus)('leaves the source document untouched', () => {
    const doc = load(file);
    const snapshot = JSON.stringify(doc);
    recolor(doc, { byHex: { [collectSlots(doc)[0]!.hex]: '#FF00FF' } });
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it.skipIf(!hasCorpus)('targets a single slot by index, and index beats hex', () => {
    const doc = load(file);
    const slots = collectSlots(doc);
    const target = slots[3]!;
    const twins = slots.filter((s) => s.hex === target.hex).length;
    expect(twins).toBeGreaterThan(1); // otherwise the test proves nothing

    const { doc: out } = recolor(doc, {
      byHex: { [target.hex]: '#00FF00' },
      byIndex: { [target.index]: '#FF00FF' },
    });
    const after = collectSlots(out);
    expect(after[target.index]!.hex).toBe('#FF00FF');
    expect(after.filter((s) => s.hex === '#00FF00')).toHaveLength(twins - 1);
  });

  it.skipIf(!hasCorpus)('reports map entries that matched nothing', () => {
    const doc = load(file);
    const r = recolor(doc, { byHex: { '#123456': '#FFFFFF' }, byIndex: { 999999: '#FFFFFF' } });
    expect(r.unusedHex).toEqual(['#123456']);
    expect(r.unusedIndex).toEqual([999999]);
    expect(r.changed).toBe(0);
  });

  it.skipIf(!hasCorpus)('accepts sloppy hex spellings in a map', () => {
    const doc = load(file);
    const top = buildPalette(collectSlots(doc))[0]!;
    const r = recolor(doc, { byHex: { [top.hex.toLowerCase().slice(1)]: 'f0f' } });
    expect(r.changed).toBe(top.count);
    expect(collectSlots(r.doc).some((s) => s.hex === '#FF00FF')).toBe(true);
  });

  it.skipIf(!hasCorpus)('preserves unknown document fields, so metadata survives a round-trip', () => {
    const doc = load(file);
    doc.meta = { themeStudio: { version: 1, groups: { surface: [0, 1] } } };
    const { doc: out } = recolor(doc, { byHex: {} }) as { doc: typeof doc };
    expect(out.meta).toEqual({ themeStudio: { version: 1, groups: { surface: [0, 1] } } });
  });

  it('recolours the whole corpus without losing or gaining a slot', () => {
    for (const f of corpus()) {
      const doc = load(f);
      const n = collectSlots(doc).length;
      const { doc: out } = recolor(doc, { byHex: { '#FFFFFF': '#17181D', '#000000': '#FFFFFF' } });
      expect(collectSlots(out)).toHaveLength(n);
    }
  });

  it.skipIf(!hasCorpus)('mutates in place when asked', () => {
    const doc = load(file);
    const target = collectSlots(doc)[0]!;
    recolorInPlace(doc, { byIndex: { 0: '#FF00FF' } });
    expect(collectSlots(doc)[target.index]!.hex).toBe('#FF00FF');
  });
});

describe('deltaE', () => {
  it('ranks a near-identical colour closer than a different one', () => {
    const base = rgbToOklab(fromHex('#17181D'));
    const near = deltaEOk(base, rgbToOklab(fromHex('#17181E')));
    const far = deltaEOk(base, rgbToOklab(fromHex('#FFFFFF')));
    expect(near).toBeLessThan(far);
    expect(near).toBeLessThan(0.02);
  });
});

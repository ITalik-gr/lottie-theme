import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  applyEdits, classifyRoles, collectProperties, collectSlots, contrastRatio, estimateAreas,
  fromHex, rgbToOklch, suggestTheme,
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
/** Some checks below need real animations. The corpus is a client's and is not in the
 *  repository; without it they are skipped rather than failing on an empty list. */
const hasCorpus = corpus().length > 0;

const load = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const analyse = (doc: unknown) => {
  const slots = collectSlots(doc);
  return { doc, slots, properties: collectProperties(slots) };
};

const shape = (fills: { hex: string; ty?: string }[]) => ({
  layers: fills.map((f, i) => ({
    ty: 4, nm: `L${i}`, ip: 0, op: 60, ind: i + 1,
    shapes: [{
      ty: f.ty ?? 'fl', nm: 'F', o: { k: 100 },
      c: { k: [...fromHex(f.hex)] },
    }],
  })),
});

describe('role classification', () => {
  it('calls a stroke a border', () => {
    const { doc, slots, properties } = analyse(shape([{ hex: '#9E9EA1', ty: 'st' }]));
    expect(classifyRoles(doc, slots, properties)[0]!.role).toBe('border');
  });

  it('calls a saturated colour an accent, with the chroma as the reason', () => {
    const { doc, slots, properties } = analyse(shape([{ hex: '#38E887' }]));
    const guess = classifyRoles(doc, slots, properties)[0]!;
    expect(guess.role).toBe('accent');
    expect(guess.reason).toMatch(/chroma/);
  });

  it('calls a gradient that fades to nothing a fade, whatever colour it is', () => {
    const doc = {
      layers: [{
        ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
        shapes: [{ ty: 'gf', nm: 'G', o: { k: 100 }, g: { p: 2, k: { k: [0, 0.09, 0.09, 0.11, 1, 0.09, 0.09, 0.11, 0, 1, 1, 0] } } }],
      }],
    };
    const { slots, properties } = analyse(doc);
    const roles = classifyRoles(doc, slots, properties);
    expect(roles.map((r) => r.role)).toEqual(['fade', 'fade']);
  });

  it('calls the dominant low-chroma colour a surface', () => {
    const doc = shape(Array.from({ length: 10 }, (_, i) => ({ hex: i === 0 ? '#FFFFFF' : '#17181D' })));
    const { slots, properties } = analyse(doc);
    const roles = classifyRoles(doc, slots, properties);
    const dominant = roles.find((r) => properties.find((p) => p.key === r.key)!.hex === '#17181D')!;
    expect(dominant.role).toBe('surface');
  });

  it('gives every guess a confidence and a reason', () => {
    for (const f of corpus().slice(0, 10)) {
      const { doc, slots, properties } = analyse(load(f));
      for (const g of classifyRoles(doc, slots, properties)) {
        expect(g.confidence).toBeGreaterThan(0);
        expect(g.confidence).toBeLessThanOrEqual(1);
        expect(g.reason).not.toBe('');
      }
    }
  });

  it('covers every property exactly once', () => {
    for (const f of corpus()) {
      const { doc, slots, properties } = analyse(load(f));
      const roles = classifyRoles(doc, slots, properties);
      expect(roles.map((r) => r.key)).toEqual(properties.map((p) => p.key));
    }
  });
});

describe('suggestTheme', () => {
  it('flips a dark surface to a light one', () => {
    const { doc, slots, properties } = analyse(shape(Array(6).fill({ hex: '#17181D' })));
    const { edits } = suggestTheme(doc, slots, properties, { target: 'light' });
    const out = collectSlots(applyEdits(doc, edits).doc);
    expect(rgbToOklch(fromHex(out[0]!.hex))[0]).toBeGreaterThan(0.7);
  });

  it('keeps an accent recognisable instead of inverting it into another colour', () => {
    // The roadmap's own example: #38E887 must not become magenta.
    const { doc, slots, properties } = analyse(shape([{ hex: '#38E887' }]));
    const { edits } = suggestTheme(doc, slots, properties, { target: 'light' });
    const after = collectSlots(applyEdits(doc, edits).doc)[0]!.hex;

    const hueBefore = rgbToOklch(fromHex('#38E887'))[2];
    const hueAfter = rgbToOklch(fromHex(after))[2];
    expect(Math.abs(hueAfter - hueBefore)).toBeLessThan(15);
    // and it now stands out against white, which the original does not
    expect(contrastRatio(fromHex(after), fromHex('#FFFFFF'))).toBeGreaterThanOrEqual(2.9);
    expect(contrastRatio(fromHex('#38E887'), fromHex('#FFFFFF'))).toBeLessThan(2);
  });

  it('sends a fading gradient to the new backdrop instead of inverting it', () => {
    const doc = {
      layers: [{
        ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
        shapes: [{ ty: 'gf', nm: 'G', o: { k: 100 }, g: { p: 2, k: { k: [0, 0.09, 0.09, 0.11, 1, 0.09, 0.09, 0.11, 0, 1, 1, 0] } } }],
      }],
    };
    const { slots, properties } = analyse(doc);
    const { edits } = suggestTheme(doc, slots, properties, { target: 'light', backdrop: '#F6F8FF' });
    const out = collectSlots(applyEdits(doc, edits).doc);
    expect(out.map((s) => s.hex)).toEqual(['#F6F8FF', '#F6F8FF']);
  });

  it('lifts text to a readable contrast against the new backdrop', () => {
    const doc = {
      layers: [{
        ty: 5, nm: 'T', ip: 0, op: 60, ind: 1,
        t: { d: { k: [{ s: { t: 'hi', fc: [0.62, 0.62, 0.63], f: 'Inter', s: 14 } }] } },
      }],
    };
    const { slots, properties } = analyse(doc);
    const { edits, audit } = suggestTheme(doc, slots, properties, { target: 'light', backdrop: '#FFFFFF' });
    const after = collectSlots(applyEdits(doc, edits).doc)[0]!.hex;
    expect(contrastRatio(fromHex(after), fromHex('#FFFFFF'))).toBeGreaterThanOrEqual(4.4);
    expect(audit).toEqual([]);
  });

  it('reports text it could not make readable rather than shipping it silently', () => {
    // Nothing reaches 10:1 against mid grey — black manages about 5.3 — so this is a
    // demand that cannot be met, and it has to be surfaced rather than quietly dropped.
    const { doc, slots, properties } = analyse({
      layers: [{
        ty: 5, nm: 'T', ip: 0, op: 60, ind: 1,
        t: { d: { k: [{ s: { t: 'hi', fc: [1, 1, 0], f: 'Inter', s: 14 } }] } },
      }],
    });
    const { audit } = suggestTheme(doc, slots, properties, { target: 'light', backdrop: '#808080', minTextContrast: 10 });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.required).toBe(10);
    expect(audit[0]!.ratio).toBeLessThan(10);
    expect(audit[0]!.against).toBe('#808080');
  });

  it('honours a role the user corrected by hand', () => {
    const { doc, slots, properties } = analyse(shape([{ hex: '#38E887' }]));
    const key = properties[0]!.key;
    const { roles, edits } = suggestTheme(doc, slots, properties, {
      target: 'light',
      overrides: { [key]: 'surface' },
    });
    expect(roles[0]!.role).toBe('surface');
    expect(roles[0]!.reason).toBe('set by hand');
    // treated as a surface now: lightness flipped rather than protected
    const after = collectSlots(applyEdits(doc, edits).doc)[0]!.hex;
    expect(rgbToOklch(fromHex(after))[0]).toBeLessThan(rgbToOklch(fromHex('#38E887'))[0]);
  });

  it('produces a valid, appliable edit set for every file in the corpus', () => {
    for (const f of corpus()) {
      const { doc, slots, properties } = analyse(load(f));
      const { edits } = suggestTheme(doc, slots, properties, { target: 'light' });
      const r = applyEdits(doc, edits);
      expect(r.unusedIndex).toEqual([]);
      expect(collectSlots(r.doc)).toHaveLength(slots.length);
    }
  });

  it.skipIf(!hasCorpus)('actually lightens the dark files it is pointed at', () => {
    const meanL = (slots: { hex: string }[]) =>
      slots.reduce((n, s) => n + rgbToOklch(fromHex(s.hex))[0], 0) / Math.max(1, slots.length);

    const dark = corpus().filter((f) => meanL(collectSlots(load(f))) < 0.4);
    expect(dark.length).toBeGreaterThan(2);
    for (const f of dark) {
      const { doc, slots, properties } = analyse(load(f));
      const { edits } = suggestTheme(doc, slots, properties, { target: 'light' });
      const after = collectSlots(applyEdits(doc, edits).doc);
      expect(meanL(after)).toBeGreaterThan(meanL(slots));
    }
  });
});

describe('role distribution over the corpus', () => {
  it.skipIf(!hasCorpus)('does not label everything a surface', () => {
    // The signal for "surface" has to be how much of the picture a colour covers.
    // Counting a property's own occurrences instead measures precomp reuse, which made
    // every colour in every file come out as a surface.
    const counts: Record<string, number> = {};
    for (const f of corpus()) {
      const { doc, slots, properties } = analyse(load(f));
      for (const g of classifyRoles(doc, slots, properties)) {
        counts[g.role] = (counts[g.role] ?? 0) + 1;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(1000);
    expect((counts.surface ?? 0) / total).toBeLessThan(0.6);
    // and the other roles are genuinely in use
    for (const role of ['accent', 'border', 'text']) {
      expect(counts[role] ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('contrast audit', () => {
  it('reports a mark that disappears into the surface, not only real text layers', () => {
    // Most "text" in an exported Lottie is converted to paths and is never classified as
    // text, so auditing text layers alone reported a clean result while leaving marks that
    // vanish into the new background. This is the real shape of that failure: a dark
    // near-neutral that flips to a light grey nobody can see on white.
    const doc = {
      w: 100, h: 100,
      layers: [
        {
          ty: 4, nm: 'BG', ip: 0, op: 60, ind: 1,
          shapes: [
            { ty: 'rc', nm: 'R', s: { k: [100, 100] }, p: { k: [50, 50] } },
            { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [...fromHex('#000000')] } },
          ],
        },
        ...Array.from({ length: 6 }, (_, i) => ({
          ty: 4, nm: `Chip${i}`, ip: 0, op: 60, ind: i + 2,
          shapes: [
            { ty: 'rc', nm: 'R', s: { k: [20, 8] }, p: { k: [50, 20 + i * 5] } },
            { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [...fromHex('#24252A')] } },
          ],
        })),
      ],
    };
    const { slots, properties } = analyse(doc);
    const { audit } = suggestTheme(doc, slots, properties, { target: 'light' });

    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]!.role).not.toBe('surface');
    expect(audit[0]!.ratio).toBeLessThan(audit[0]!.required);
    // audited against the new ground, not against the raw backdrop option
    expect(audit[0]!.against).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('says nothing when everything is readable', () => {
    const doc = {
      w: 100, h: 100,
      layers: [
        {
          ty: 4, nm: 'Card', ip: 0, op: 60, ind: 1,
          shapes: [
            { ty: 'rc', nm: 'R', s: { k: [100, 100] }, p: { k: [50, 50] } },
            { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [...fromHex('#000000')] } },
          ],
        },
        {
          ty: 4, nm: 'Mark', ip: 0, op: 60, ind: 2,
          shapes: [
            { ty: 'rc', nm: 'R', s: { k: [4, 4] }, p: { k: [50, 50] } },
            { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [...fromHex('#FFFFFF')] } },
          ],
        },
      ],
    };
    const { slots, properties } = analyse(doc);
    expect(suggestTheme(doc, slots, properties, { target: 'light' }).audit).toEqual([]);
  });
});

describe('painted area', () => {
  it('treats a full-frame rectangle as the backplate, whatever its slot count', () => {
    // Counting slots ranks a hundred small glyph paths above the one rectangle behind
    // them, which turned a near-black background into a mid grey.
    const doc = {
      w: 200, h: 200,
      layers: [
        {
          ty: 4, nm: 'BG', ip: 0, op: 60, ind: 1,
          shapes: [
            { ty: 'rc', nm: 'R', s: { k: [200, 200] }, p: { k: [100, 100] } },
            { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [...fromHex('#17181D')] } },
          ],
        },
        ...Array.from({ length: 20 }, (_, i) => ({
          ty: 4, nm: `T${i}`, ip: 0, op: 60, ind: i + 2,
          shapes: [
            { ty: 'rc', nm: 'R', s: { k: [3, 3] }, p: { k: [10, 10] } },
            { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [...fromHex('#9E9EA1')] } },
          ],
        })),
      ],
    };
    const { slots, properties } = analyse(doc);
    const roles = classifyRoles(doc, slots, properties);
    const background = roles.find((r) => properties.find((p) => p.key === r.key)!.hex === '#17181D')!;
    expect(background.role).toBe('surface');
    expect(background.reason).toMatch(/covers 100%/);

    // and it becomes the page it will sit on, not a flipped grey
    const { edits } = suggestTheme(doc, slots, properties, { target: 'light', backdrop: '#FFFFFF' });
    expect(collectSlots(applyEdits(doc, edits).doc)[0]!.hex).toBe('#FFFFFF');
  });

  it('measures against the composition a shape lives in, not the root', () => {
    // A rectangle filling a 100×100 precomp is a background, even inside a 1000×1000 root.
    const doc = {
      w: 1000, h: 1000,
      layers: [{ ty: 0, refId: 'pc', nm: 'P', ip: 0, op: 60, ind: 1 }],
      assets: [{
        id: 'pc', w: 100, h: 100,
        layers: [{
          ty: 4, nm: 'BG', ip: 0, op: 60, ind: 1,
          shapes: [
            { ty: 'rc', nm: 'R', s: { k: [100, 100] }, p: { k: [50, 50] } },
            { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [...fromHex('#17181D')] } },
          ],
        }],
      }],
    };
    const { slots, properties } = analyse(doc);
    expect(classifyRoles(doc, slots, properties)[0]!.reason).toMatch(/covers 100%/);
  });

  it('reports nothing for geometry it cannot measure, instead of guessing', () => {
    const doc = {
      w: 100, h: 100,
      layers: [{
        ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
        shapes: [{ ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [1, 0, 0] } }],
      }],
    };
    expect(estimateAreas(doc, collectSlots(doc))).toEqual([0]);
  });

  it('measures a path from its vertices', () => {
    const doc = {
      w: 100, h: 100,
      layers: [{
        ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
        shapes: [
          { ty: 'sh', nm: 'P', ks: { k: { v: [[0, 0], [50, 0], [50, 50], [0, 50]] } } },
          { ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [1, 0, 0] } },
        ],
      }],
    };
    expect(estimateAreas(doc, collectSlots(doc))[0]).toBeCloseTo(0.25, 5);
  });

  it('measures a solid layer from its own width and height', () => {
    const doc = {
      w: 100, h: 100,
      layers: [{ ty: 1, nm: 'S', sc: '#17181d', sw: 100, sh: 50, ip: 0, op: 60, ind: 1, ks: { o: { k: 100 } } }],
    };
    expect(estimateAreas(doc, collectSlots(doc))[0]).toBeCloseTo(0.5, 5);
  });
});

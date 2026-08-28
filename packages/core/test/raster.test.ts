import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  invertPixelLightness, isMappable, listImageAssets, quantize, recolorPixels,
  setImageAsset, toHex, fromHex, rgbToOklch, type Pixels,
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

/** Build RGBA pixels from a list of hex colours (alpha 255 unless given). */
function px(colors: [string, number?][]): Pixels {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([hex, a], i) => {
    const [r, g, b] = fromHex(hex);
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = a ?? 255;
  });
  return { data, width: colors.length, height: 1 };
}
const at = (p: Pixels, i: number) => toHex([p.data[i * 4]! / 255, p.data[i * 4 + 1]! / 255, p.data[i * 4 + 2]! / 255]);

describe('image assets', () => {
  it.skipIf(!hasCorpus)('finds the embedded bitmaps in the corpus', () => {
    const total = corpus().reduce((n, f) => n + listImageAssets(load(f)).length, 0);
    expect(total).toBe(25);
  });

  it.skipIf(!hasCorpus)('reads mime and size, and never mistakes a precomp for an image', () => {
    const file = corpus().find((f) => listImageAssets(load(f)).length > 0)!;
    const assets = listImageAssets(load(file));
    for (const a of assets) {
      expect(a.embedded).toBe(true);
      expect(a.mime).toMatch(/^image\//);
      expect(a.w * a.h).toBeGreaterThan(0);
    }
  });

  it('writes replacement pixels back into the same slot', () => {
    const doc = { assets: [{ id: 'img', w: 10, h: 10, p: 'data:image/png;base64,AAA', e: 1 }] };
    setImageAsset(doc, 0, 'data:image/png;base64,BBB', { w: 20, h: 20 });
    const [asset] = listImageAssets(doc);
    expect(asset).toMatchObject({ id: 'img', w: 20, h: 20, source: 'data:image/png;base64,BBB' });
  });

  it('refuses an index that is not an image asset', () => {
    expect(() => setImageAsset({ assets: [] }, 0, 'x')).toThrow();
  });
});

describe('quantize', () => {
  it('reports colours by usage and ignores transparent pixels', () => {
    const p = px([['#FF0000'], ['#FF0000'], ['#00FF00'], ['#0000FF', 0]]);
    const q = quantize(p);
    expect(q).toHaveLength(2);
    expect(q[0]!.count).toBe(2);
    expect(q[0]!.share).toBeCloseTo(2 / 3, 5);
  });

  it('caps the list so a photo does not produce thousands of rows', () => {
    const many: [string, number?][] = Array.from({ length: 500 }, (_, i) => [
      `#${(i % 256).toString(16).padStart(2, '0')}${(255 - (i % 256)).toString(16).padStart(2, '0')}80`,
    ]);
    expect(quantize(px(many)).length).toBeLessThanOrEqual(32);
  });

  it('decides whether per-colour mapping is meaningful at all', () => {
    expect(isMappable(quantize(px([['#FF0000'], ['#00FF00']])))).toBe(true);
    expect(isMappable([])).toBe(false);
  });
});

describe('recolorPixels', () => {
  it('maps an exact colour exactly', () => {
    const p = px([['#17181D'], ['#FFFFFF']]);
    recolorPixels(p, [{ from: '#17181D', to: '#FFFFFF' }, { from: '#FFFFFF', to: '#17181D' }]);
    expect(at(p, 0)).toBe('#FFFFFF');
    expect(at(p, 1)).toBe('#17181D');
  });

  it('never touches alpha, so soft edges and shadows survive', () => {
    const p = px([['#17181D', 0], ['#17181D', 40], ['#17181D', 255]]);
    const before = [p.data[3], p.data[7], p.data[11]];
    recolorPixels(p, [{ from: '#17181D', to: '#FFFFFF' }]);
    expect([p.data[3], p.data[7], p.data[11]]).toEqual(before);
  });

  it('blends an antialiased edge between the two targets, with no hard step', () => {
    // a ramp from black to white, mapped to the inverse
    const ramp: [string, number?][] = Array.from({ length: 21 }, (_, i) => {
      const v = Math.round((i / 20) * 255).toString(16).padStart(2, '0');
      return [`#${v}${v}${v}`];
    });
    const p = px(ramp);
    recolorPixels(p, [{ from: '#000000', to: '#FFFFFF' }, { from: '#FFFFFF', to: '#000000' }]);

    const lums = Array.from({ length: 21 }, (_, i) => p.data[i * 4]!);
    // monotonic: the mapping reversed the ramp without introducing a jump
    for (let i = 1; i < lums.length; i++) expect(lums[i]!).toBeLessThanOrEqual(lums[i - 1]!);
    const steps = lums.slice(1).map((v, i) => lums[i]! - v);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(60);
  });

  it('leaves a colour far from every source nearly alone in a two-way map', () => {
    // yellow is far from both greys; it should not be dragged to either target hard
    const p = px([['#FFD640']]);
    recolorPixels(p, [{ from: '#000000', to: '#FFFFFF' }, { from: '#FFFFFF', to: '#000000' }], 0.2);
    const [, , hue] = rgbToOklch(fromHex(at(p, 0)));
    expect(Math.abs(hue - rgbToOklch(fromHex('#FFD640'))[2])).toBeLessThan(25);
  });

  it('scales with strength, and does nothing at zero', () => {
    const zero = px([['#000000']]);
    recolorPixels(zero, [{ from: '#000000', to: '#FFFFFF' }], 0);
    expect(at(zero, 0)).toBe('#000000');

    const half = px([['#000000']]);
    recolorPixels(half, [{ from: '#000000', to: '#FFFFFF' }], 0.5);
    expect(half.data[0]).toBeGreaterThan(100);
    expect(half.data[0]).toBeLessThan(200);
  });

  it('does nothing without a mapping', () => {
    const p = px([['#123456']]);
    recolorPixels(p, []);
    expect(at(p, 0)).toBe('#123456');
  });
});

describe('invertPixelLightness', () => {
  it('flips light and dark', () => {
    const p = px([['#000000'], ['#FFFFFF']]);
    invertPixelLightness(p);
    expect(at(p, 0)).toBe('#FFFFFF');
    expect(at(p, 1)).toBe('#000000');
  });

  it('keeps hue, which clamped RGB inversion does not', () => {
    const p = px([['#38E887']]);
    const hueBefore = rgbToOklch(fromHex('#38E887'))[2];
    invertPixelLightness(p);
    expect(Math.abs(rgbToOklch(fromHex(at(p, 0)))[2] - hueBefore)).toBeLessThan(5);
  });

  it('leaves alpha alone', () => {
    const p = px([['#000000', 77]]);
    invertPixelLightness(p);
    expect(p.data[3]).toBe(77);
  });
});

import { describe, it, expect } from 'vitest';
import {
  deltaEOk, extractPalette, fromHex, matchPalettes, rgbToOklab, samplePoint, toHex, type Pixels,
} from '../src/index.ts';

/** Build an image from a flat list of hex colours. */
function image(colors: string[], width = colors.length): Pixels {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((hex, i) => {
    const [r, g, b] = fromHex(hex);
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  });
  return { data, width, height: colors.length / width };
}

const repeat = (hex: string, n: number) => Array.from({ length: n }, () => hex);
/** Perceptually indistinguishable, which is the only accuracy a dominant-colour
 *  extractor can promise: bucketing moves a colour by a pixel value or two. */
const near = (a: string, b: string, tolerance = 0.02) =>
  deltaEOk(rgbToOklab(fromHex(a)), rgbToOklab(fromHex(b))) < tolerance;

describe('extractPalette', () => {
  it('collapses antialiasing back into the colours a designer chose', () => {
    // one white and one blue region, plus a smear of intermediate edge pixels
    const edges = Array.from({ length: 40 }, (_, i) => {
      const t = i / 39;
      const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
      return toHex([mix(255, 76) / 255, mix(255, 110) / 255, mix(255, 252) / 255]);
    });
    const palette = extractPalette(image([...repeat('#FFFFFF', 300), ...repeat('#4C6EFC', 300), ...edges], 1), 2);
    expect(palette).toHaveLength(2);
    expect(palette.some((c) => near(c.hex, '#FFFFFF'))).toBe(true);
    expect(palette.some((c) => near(c.hex, '#4C6EFC'))).toBe(true);
  });

  it('orders by how much of the image a colour covers', () => {
    const palette = extractPalette(image([...repeat('#17181D', 900), ...repeat('#38E887', 100)], 1), 2);
    expect(near(palette[0]!.hex, '#17181D')).toBe(true);
    expect(palette[0]!.share).toBeGreaterThan(palette[1]!.share);
    expect(palette.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1, 5);
  });

  it('is deterministic — the same image gives the same palette twice', () => {
    const pixels = image([...repeat('#17181D', 200), ...repeat('#FFFFFF', 200), ...repeat('#38E887', 100)], 1);
    expect(extractPalette(pixels, 3)).toEqual(extractPalette(pixels, 3));
  });

  it('returns the colours as they are when there are fewer than asked for', () => {
    const palette = extractPalette(image([...repeat('#000000', 10), ...repeat('#FFFFFF', 10)], 1), 8);
    expect(palette).toHaveLength(2);
  });

  it('reports a colour the image really contains, not the average of a cluster', () => {
    // A flat blue region with antialiased edges around it: the mean of that cluster is
    // near #4C6EFC but not equal to it, and a near-miss is what shows on the page.
    const edges = Array.from({ length: 30 }, (_, i) => {
      const t = (i + 1) / 40;
      const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
      return toHex([mix(76, 255) / 255, mix(110, 255) / 255, mix(252, 255) / 255]);
    });
    const palette = extractPalette(image([...repeat('#4C6EFC', 200), ...edges, ...repeat('#FFFFFF', 300)], 1), 2);
    const blue = palette.find((c) => near(c.hex, '#4C6EFC'))!;
    expect(blue.hex).toBe('#4C6EFC');
    expect(palette.find((c) => near(c.hex, '#FFFFFF'))!.hex).toBe('#FFFFFF');
  });

  it('handles an empty image without throwing', () => {
    expect(extractPalette({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toEqual([]);
  });
});

describe('samplePoint', () => {
  const pixels = image(['#FF0000', '#00FF00', '#0000FF', '#FFFFFF'], 2);

  it('reads a pixel', () => {
    expect(samplePoint(pixels, 0, 0, 0)).toBe('#FF0000');
    expect(samplePoint(pixels, 1, 1, 0)).toBe('#FFFFFF');
  });

  it('averages a small neighbourhood, so one stray pixel does not decide it', () => {
    const averaged = samplePoint(pixels, 0, 0, 1)!;
    expect(averaged).not.toBe('#FF0000');
    expect(averaged).not.toBeNull();
  });

  it('answers a flat area with its exact colour, stray pixel and all', () => {
    // 5×5 of one colour with a single different pixel in the corner: the eyedropper is
    // being asked what this area is painted with, and the answer is not an average.
    const flat = repeat('#1E2029', 25);
    flat[0] = '#FFFFFF';
    expect(samplePoint(image(flat, 5), 2, 2, 2)).toBe('#1E2029');
  });

  it('returns null where there is nothing opaque', () => {
    expect(samplePoint({ data: new Uint8ClampedArray(4), width: 1, height: 1 }, 0, 0, 0)).toBeNull();
    expect(samplePoint(pixels, 99, 99, 0)).toBeNull();
  });
});

describe('matchPalettes', () => {
  it('pairs by prominence, so a dark theme maps onto a light reference', () => {
    // dark UI: mostly background, some secondary text, a little white
    const source = [
      { hex: '#17181D', weight: 600 },
      { hex: '#9E9EA1', weight: 200 },
      { hex: '#FFFFFF', weight: 50 },
    ];
    // the same UI in light: mostly white, some grey, a little near-black
    const reference = [
      { hex: '#FFFFFF', share: 0.7 },
      { hex: '#B2B5C1', share: 0.2 },
      { hex: '#17181D', share: 0.05 },
    ];
    const map = Object.fromEntries(matchPalettes(source, reference).map((p) => [p.from, p.to]));
    expect(map['#17181D']).toBe('#FFFFFF');
    expect(map['#9E9EA1']).toBe('#B2B5C1');
    expect(map['#FFFFFF']).toBe('#17181D');
  });

  it('does not pair by lightness, which would keep the theme it is trying to change', () => {
    const source = [{ hex: '#17181D', weight: 900 }, { hex: '#FFFFFF', weight: 100 }];
    const reference = [{ hex: '#FFFFFF', share: 0.9 }, { hex: '#17181D', share: 0.1 }];
    const map = Object.fromEntries(matchPalettes(source, reference).map((p) => [p.from, p.to]));
    expect(map['#17181D']).not.toBe('#17181D');
  });

  it('keeps a hue rather than snapping to a grey of similar prominence', () => {
    const source = [{ hex: '#FFFFFF', weight: 900 }, { hex: '#38E887', weight: 100 }];
    const reference = [
      { hex: '#17181D', share: 0.8 },
      { hex: '#3A3A3A', share: 0.15 },
      { hex: '#008934', share: 0.05 },
    ];
    const map = Object.fromEntries(matchPalettes(source, reference).map((p) => [p.from, p.to]));
    expect(map['#38E887']).toBe('#008934');
  });

  it('does not drop a rare accent onto a rare grey', () => {
    // The real failure: an investment card's animation against a screenshot of the page it
    // had to sit on. Green, blue and teal were the least-used colours of the animation and
    // black was the least-used of the screenshot, so prominence alone paired all three
    // with black — three accents deleted in one click.
    const source = [
      { hex: '#1B1C21', weight: 400 },
      { hex: '#FFFFFF', weight: 300 },
      { hex: '#9FA3B0', weight: 120 },
      { hex: '#11E598', weight: 20 },
      { hex: '#4C6EFC', weight: 14 },
      { hex: '#4CC7BA', weight: 8 },
    ];
    const reference = [
      { hex: '#FFFFFF', share: 0.62 },
      { hex: '#E6E6E6', share: 0.18 },
      { hex: '#C0CDFF', share: 0.1 },
      { hex: '#0024FF', share: 0.07 },
      { hex: '#000000', share: 0.03 },
    ];
    const pairs = matchPalettes(source, reference);
    const map = Object.fromEntries(pairs.map((p) => [p.from, p.to]));

    for (const accent of ['#11E598', '#4C6EFC', '#4CC7BA']) {
      expect(map[accent]).not.toBe('#000000');
      // and not onto any of the greys either
      expect(['#FFFFFF', '#E6E6E6', '#000000']).not.toContain(map[accent]);
    }
  });

  it('lets the colour with a real match claim it first', () => {
    // Reuse is discouraged, so whoever is settled first takes the good target. Going in
    // prominence order, a green with no counterpart anywhere claimed the reference's only
    // blue — and the animation's actual blue was left with a pale lavender.
    const source = [
      { hex: '#1B1C21', weight: 1 }, { hex: '#FFFFFF', weight: 1 }, { hex: '#9FA3B0', weight: 1 },
      { hex: '#11E598', weight: 1 }, { hex: '#4C6EFC', weight: 1 }, { hex: '#4CC7BA', weight: 1 },
    ];
    const reference = [
      { hex: '#FFFFFF', share: 0.6 }, { hex: '#E6E6E6', share: 0.2 },
      { hex: '#0024FF', share: 0.12 }, { hex: '#C0CDFF', share: 0.09 },
      { hex: '#000000', share: 0.02 },
    ];
    const pairs = matchPalettes(source, reference);
    const map = Object.fromEntries(pairs.map((p) => [p.from, p.to]));

    // The blue is the only source with a true counterpart, so it gets it.
    expect(map['#4C6EFC']).toBe('#0024FF');
    expect(pairs.find((p) => p.from === '#4C6EFC')!.weak).toBe(false);
    // The green has none, and says so rather than taking the blue's place.
    expect(pairs.find((p) => p.from === '#11E598')!.weak).toBe(true);
  });

  it('marks a pair weak when the reference has nothing like the colour', () => {
    // A green with only blues to land on: answered, but not to be applied unseen.
    const pairs = matchPalettes(
      [{ hex: '#FFFFFF', weight: 900 }, { hex: '#11E598', weight: 10 }],
      [{ hex: '#0A0A0A', share: 0.9 }, { hex: '#0024FF', share: 0.1 }],
    );
    expect(pairs.find((p) => p.from === '#11E598')!.weak).toBe(true);
    expect(pairs.find((p) => p.from === '#FFFFFF')!.weak).toBe(false);
  });

  it('still answers when the reference is all greys', () => {
    const pairs = matchPalettes(
      [{ hex: '#11E598', weight: 10 }],
      [{ hex: '#FFFFFF', share: 0.9 }, { hex: '#222222', share: 0.1 }],
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.to).toBeTruthy();
  });

  it('does not collapse a whole palette onto one reference colour', () => {
    const source = [
      { hex: '#111111', weight: 4 }, { hex: '#333333', weight: 3 },
      { hex: '#777777', weight: 2 }, { hex: '#DDDDDD', weight: 1 },
    ];
    const reference = [
      { hex: '#FFFFFF', share: 0.4 }, { hex: '#DDDDDD', share: 0.3 },
      { hex: '#888888', share: 0.2 }, { hex: '#222222', share: 0.1 },
    ];
    const targets = new Set(matchPalettes(source, reference).map((p) => p.to));
    expect(targets.size).toBeGreaterThan(2);
  });

  it('maps every source colour exactly once', () => {
    const source = [{ hex: '#111111' }, { hex: '#777777' }, { hex: '#EEEEEE' }];
    const pairs = matchPalettes(source, [{ hex: '#FFFFFF' }, { hex: '#000000' }]);
    expect(pairs.map((p) => p.from).sort()).toEqual(source.map((s) => s.hex).sort());
  });

  it('scores a good match above a poor one', () => {
    const pairs = matchPalettes(
      [{ hex: '#000000' }, { hex: '#FFFFFF' }],
      [{ hex: '#FFFFFF' }, { hex: '#000000' }],
    );
    expect(pairs[0]!.confidence).toBeGreaterThan(0.8);
  });

  it('returns nothing when either side is empty', () => {
    expect(matchPalettes([], [{ hex: '#FFFFFF' }])).toEqual([]);
    expect(matchPalettes([{ hex: '#FFFFFF' }], [])).toEqual([]);
  });
});

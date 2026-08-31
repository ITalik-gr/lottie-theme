import type { Pixels } from './raster.ts';
import { deltaEOk, fromHex, oklabToRgb, rgbToOklab, rgbToOklch, toHex, type OKLab } from './color.ts';

export interface DominantColor {
  /** A colour the image actually contains — the most common exact pixel value in the
   *  cluster, not the cluster's average. */
  hex: string;
  /** Share of the sampled pixels, 0..1. */
  share: number;
  /** What the cluster averages to. Kept because it is what `hex` was snapped from, and
   *  a large gap between the two says the cluster spans a gradient rather than a flat
   *  colour — which is worth knowing before mapping onto it. */
  mean: string;
}

/**
 * The colours a reference image is actually built from.
 *
 * k-means in OKLab rather than a histogram: a screenshot of a real page is full of
 * antialiasing and subtle gradients, so raw bucket counts return dozens of near-identical
 * greys instead of the handful of colours a designer chose. Clustering perceptually
 * collapses those back into the intended palette.
 *
 * Seeded from the quantised histogram so the result is deterministic — a random seed
 * would give a different palette on every run, which is useless for comparing.
 *
 * Each cluster then reports the *exact* colour most of its pixels have, not the average
 * of the cluster. A designer picked #4C6EFC; the mean of the region reads #4B6DFB, which
 * is indistinguishable to the eye and wrong on the page next to the real thing. Anyone
 * reading this palette wants the value that was chosen, not one near it.
 */
export function extractPalette(pixels: Pixels, k = 8, iterations = 12): DominantColor[] {
  // A histogram of its own rather than `quantize`: that one caps the number of colours
  // it returns, and clustering needs to see the whole distribution — including the rare
  // colours that get dropped — or the cluster centres land off the real colours.
  const buckets = histogram(pixels, 6);
  if (!buckets.length) return [];

  const total = buckets.reduce((n, b) => n + b.weight, 0);
  if (buckets.length <= k) {
    return buckets
      .map((b) => ({
        hex: modalHex([b]),
        mean: toHex([b.r / 255, b.g / 255, b.b / 255]),
        share: b.weight / total,
      }))
      .sort((a, b) => b.share - a.share);
  }

  const points = buckets
    .sort((a, b) => b.weight - a.weight)
    .map((b) => ({ lab: rgbToOklab([b.r / 255, b.g / 255, b.b / 255]), weight: b.weight, bucket: b }));
  // Seed with the most-used buckets, spread out so two seeds are not the same colour.
  const centres: OKLab[] = [];
  for (const point of points) {
    if (centres.length >= k) break;
    if (centres.every((c) => deltaEOk(c, point.lab) > 0.08)) centres.push([...point.lab] as OKLab);
  }
  while (centres.length < k) centres.push([...points[centres.length % points.length]!.lab] as OKLab);

  const assignment = new Array<number>(points.length).fill(0);
  for (let step = 0; step < iterations; step++) {
    let moved = false;
    points.forEach((point, i) => {
      let best = 0;
      let bestDistance = Infinity;
      centres.forEach((centre, c) => {
        const d = deltaEOk(centre, point.lab);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      });
      if (assignment[i] !== best) {
        assignment[i] = best;
        moved = true;
      }
    });
    if (!moved && step > 0) break;

    const sums = centres.map(() => [0, 0, 0, 0]);
    points.forEach((point, i) => {
      const s = sums[assignment[i]!]!;
      s[0]! += point.lab[0] * point.weight;
      s[1]! += point.lab[1] * point.weight;
      s[2]! += point.lab[2] * point.weight;
      s[3]! += point.weight;
    });
    sums.forEach((s, c) => {
      if (s[3]! > 0) centres[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
  }

  const weights = centres.map(() => 0);
  const members: Bucket[][] = centres.map(() => []);
  points.forEach((point, i) => {
    weights[assignment[i]!]! += point.weight;
    members[assignment[i]!]!.push(point.bucket);
  });
  const clustered = weights.reduce((a, b) => a + b, 0) || 1;

  return centres
    .map((centre, i) => ({
      hex: modalHex(members[i]!),
      mean: toHex(oklabToRgb(centre)),
      share: weights[i]! / clustered,
    }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

interface Bucket {
  r: number;
  g: number;
  b: number;
  weight: number;
  /** Packed 0xRRGGBB → how many pixels have exactly that value. */
  exact: Map<number, number>;
}

/** How many distinct exact colours are worth remembering. A screenshot of a design has a
 *  few hundred; a photograph has hundreds of thousands and none of them repeat, so past
 *  this point the tally has stopped answering the question it was built for. */
const EXACT_LIMIT = 1 << 18;

/** The exact colour most of these buckets' pixels have. Falls back to the bucket mean only
 *  where the tally hit its limit and holds nothing for this cluster. */
function modalHex(buckets: readonly Bucket[]): string {
  let best = -1;
  let bestCount = 0;
  for (const bucket of buckets) {
    for (const [packed, count] of bucket.exact) {
      if (count > bestCount) {
        bestCount = count;
        best = packed;
      }
    }
  }
  if (best < 0) {
    const fallback = buckets[0];
    return fallback ? toHex([fallback.r / 255, fallback.g / 255, fallback.b / 255]) : '#000000';
  }
  return toHex([((best >> 16) & 255) / 255, ((best >> 8) & 255) / 255, (best & 255) / 255]);
}

/** Colour histogram with per-bucket means, so a bucket reports the colour actually in
 *  the image rather than the midpoint of its range. */
function histogram(pixels: Pixels, bits: number): Bucket[] {
  const shift = 8 - bits;
  const sums = new Map<number, { r: number; g: number; b: number; n: number; exact: Map<number, number> }>();
  const { data } = pixels;
  let distinct = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 8) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> shift) << (bits * 2)) | ((g >> shift) << bits) | (b >> shift);
    let entry = sums.get(key);
    if (!entry) {
      entry = { r: 0, g: 0, b: 0, n: 0, exact: new Map() };
      sums.set(key, entry);
    }
    entry.r += r;
    entry.g += g;
    entry.b += b;
    entry.n += 1;
    const packed = (r << 16) | (g << 8) | b;
    const seen = entry.exact.get(packed);
    if (seen !== undefined) entry.exact.set(packed, seen + 1);
    else if (distinct < EXACT_LIMIT) {
      entry.exact.set(packed, 1);
      distinct++;
    }
  }
  return [...sums.values()].map((e) => ({
    r: e.r / e.n,
    g: e.g / e.n,
    b: e.b / e.n,
    weight: e.n,
    exact: e.exact,
  }));
}

/**
 * The colour at a point.
 *
 * A flat area answers with the exact colour it is painted with, which is what an
 * eyedropper is for: averaging a neighbourhood of one colour with a couple of edge pixels
 * returns a value the design does not contain. Only where no single colour holds the
 * neighbourhood — an edge, a gradient — does it fall back to the average, so a stray pixel
 * or a JPEG artefact still cannot decide the answer on its own.
 */
export function samplePoint(pixels: Pixels, x: number, y: number, radius = 2): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const exact = new Map<number, number>();
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue;
      const i = (py * pixels.width + px) * 4;
      if (pixels.data[i + 3]! < 8) continue;
      r += pixels.data[i]!;
      g += pixels.data[i + 1]!;
      b += pixels.data[i + 2]!;
      n++;
      const packed = (pixels.data[i]! << 16) | (pixels.data[i + 1]! << 8) | pixels.data[i + 2]!;
      exact.set(packed, (exact.get(packed) ?? 0) + 1);
    }
  }
  if (!n) return null;

  let top = -1;
  let topCount = 0;
  for (const [packed, count] of exact) {
    if (count > topCount) {
      topCount = count;
      top = packed;
    }
  }
  if (top >= 0 && topCount / n >= 0.5) {
    return toHex([((top >> 16) & 255) / 255, ((top >> 8) & 255) / 255, (top & 255) / 255]);
  }
  return toHex([r / n / 255, g / n / 255, b / n / 255]);
}

export interface MatchedPair {
  from: string;
  to: string;
  /** 0..1: how well the two matched. Low means the reference had nothing like it. */
  confidence: number;
  /** The reference had nothing close. The pair is still returned — every source colour is
   *  accounted for — but it is a guess, and applying it unseen is how a palette ends up
   *  worse than it started. */
  weak: boolean;
}

/** Below this chroma a colour is a grey, and its hue is noise rather than information. */
const NEUTRAL_CHROMA = 0.04;

/** Confidence under which a pair is marked `weak`. Set where an accent with no counterpart
 *  in the reference lands: those score around 0.3–0.45, and a correct pairing of colours
 *  that genuinely correspond scores well above it. */
const WEAK_BELOW = 0.55;

/**
 * Pair a document's palette with a reference image's palette.
 *
 * Matched by *prominence*, not by lightness. Lightness is the obvious signal and the
 * wrong one: the whole point of a reference is usually that it is the opposite theme, so
 * pairing dark with dark reproduces exactly what the user is trying to get away from.
 * What survives a theme flip is how much of the picture a colour covers — the background
 * is the biggest area in both, the body text is the second, and so on. Hue then refines
 * the choice so a green maps to the reference's green instead of to whatever grey has a
 * similar share.
 *
 * A reference colour is discouraged, but not forbidden, from being reused, so a palette
 * cannot collapse onto a single colour.
 *
 * Greys and colours are ranked *separately*, and a colour looks for its match among the
 * reference's colours rather than its greys. Prominence alone put an accent that was rare
 * in the animation onto whatever was rarest in the reference — a vivid green, blue and
 * teal all landed on black, because black was the least of the screenshot and they were
 * the least of the animation. Ranking within each group keeps prominence as the ordering
 * principle without letting it pair things that have nothing to do with each other.
 */
export function matchPalettes(
  source: readonly { hex: string; weight?: number }[],
  reference: readonly { hex: string; share?: number }[],
): MatchedPair[] {
  if (!source.length || !reference.length) return [];

  /** Position in the palette ordered by how much of the image the colour covers, 0..1. */
  const byProminence = <T extends { hex: string }>(list: readonly T[], amount: (item: T) => number) =>
    [...list]
      .map((item) => ({ item, amount: amount(item) }))
      .sort((a, b) => b.amount - a.amount)
      .map((entry, i, all) => ({ ...entry, rank: all.length === 1 ? 0 : i / (all.length - 1) }));

  const chromaOf = (hex: string) => rgbToOklch(fromHex(hex))[1];
  const isColour = (hex: string) => chromaOf(hex) > NEUTRAL_CHROMA;

  /** Rank within a group, so "the biggest area" means the biggest of the greys or the
   *  biggest of the colours — never the biggest of a pile that mixes both. */
  const ranked = <T extends { hex: string }>(list: readonly T[], amount: (item: T) => number) => {
    const colours = byProminence(list.filter((x) => isColour(x.hex)), amount);
    const greys = byProminence(list.filter((x) => !isColour(x.hex)), amount);
    return { colours, greys, all: [...colours, ...greys] };
  };

  const sourceRanked = ranked(source, (s) => s.weight ?? 1);
  const referenceRanked = ranked(reference, (r) => r.share ?? 1);

  /** What it would cost to pair these two, before any reuse penalty. */
  const baseCost = (
    sourceHex: string,
    sourceRank: number,
    candidate: { item: { hex: string }; rank: number },
    crossing: boolean,
  ) => {
    const [, sourceC, sourceH] = rgbToOklch(fromHex(sourceHex));
    const [, candidateC, candidateH] = rgbToOklch(fromHex(candidate.item.hex));
    const rankCost = Math.abs(candidate.rank - sourceRank);
    // Hue only matters when both colours are actually coloured; comparing the hue of two
    // greys is comparing noise.
    const comparable = Math.min(sourceC, candidateC) > NEUTRAL_CHROMA;
    // Saturating at a quarter turn, not spread over a half turn. Green against blue is not
    // "60% wrong", it is simply a different colour, and a linear scale to 180° meant a hue
    // could never cost enough to make a pair read as the guess it is.
    const hueCost = comparable
      ? Math.min(1, Math.min(Math.abs(candidateH - sourceH), 360 - Math.abs(candidateH - sourceH)) / 90)
      : 0;
    // Within a group this separates a vivid accent from a muted one.
    const chromaCost = Math.abs(candidateC - sourceC) * 2;
    return rankCost * 0.35 + hueCost * 0.5 + chromaCost * 0.2 + (crossing ? 0.35 : 0);
  };

  /** Each source with the pool it may draw from and the best it could hope for. */
  const wanting = sourceRanked.all.map(({ item, rank }) => {
    const wantsColour = rgbToOklch(fromHex(item.hex))[1] > NEUTRAL_CHROMA;
    // Its own kind first. Crossing over is allowed only when the reference has none of
    // that kind at all — a screenshot with no colour in it can still theme an animation,
    // and refusing to answer would be worse than answering with the nearest grey.
    const preferred = wantsColour ? referenceRanked.colours : referenceRanked.greys;
    const crossing = preferred.length === 0;
    const pool = crossing ? referenceRanked.all : preferred;
    const costs = pool.map((candidate) => ({ candidate, cost: baseCost(item.hex, rank, candidate, crossing) }));
    return { item, rank, costs, floor: Math.min(...costs.map((c) => c.cost)) };
  });

  // Settled in order of how well each source can possibly do, not in order of prominence.
  // Reuse is discouraged, so whoever chooses first takes the good target — and going by
  // prominence meant a green with no counterpart could claim the reference's only blue,
  // leaving the animation's actual blue to a pale lavender. The colour with a real match
  // states its claim first, and the one with nothing to match takes what is left.
  const used = new Map<string, number>();

  return wanting
    .slice()
    .sort((a, b) => a.floor - b.floor)
    .map(({ item, costs }) => {
      let best = costs[0]!;
      let bestCost = Infinity;
      for (const entry of costs) {
        const cost = entry.cost + (used.get(entry.candidate.item.hex) ?? 0) * 0.2;
        if (cost < bestCost) {
          bestCost = cost;
          best = entry;
        }
      }
      used.set(best.candidate.item.hex, (used.get(best.candidate.item.hex) ?? 0) + 1);
      const confidence = Math.max(0, Math.min(1, 1 - bestCost));
      return { from: item.hex, to: best.candidate.item.hex, confidence, weak: confidence < WEAK_BELOW };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

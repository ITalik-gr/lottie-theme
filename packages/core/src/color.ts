/** Colour conversions. sRGB channels are 0..1 throughout, matching Lottie's own encoding. */

export type RGB = [number, number, number];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Lottie exporters are inconsistent: most write 0..1, some write 0..255. */
export function normalizeChannel(v: number): number {
  return clamp01(v > 1 ? v / 255 : v);
}

export function toHex(rgb: readonly number[]): string {
  let s = '#';
  for (let i = 0; i < 3; i++) {
    const v = Math.round(normalizeChannel(rgb[i] ?? 0) * 255);
    s += v.toString(16).padStart(2, '0');
  }
  return s.toUpperCase();
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHex(s: string): boolean {
  return HEX_RE.test(s.trim());
}

/** Accepts `#rgb`, `#rrggbb`, with or without the hash. Throws on anything else. */
export function fromHex(hex: string): RGB {
  const m = HEX_RE.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${JSON.stringify(hex)}`);
  let h = m[1]!;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Normalise any accepted spelling to the canonical `#RRGGBB` we compare against. */
export function canonicalHex(hex: string): string {
  return toHex(fromHex(hex));
}

// --- sRGB <-> OKLab -------------------------------------------------------
// Björn Ottosson's OKLab. Perceptual lightness makes `L -> 1 - L` a usable
// dark/light inversion, which naive RGB inversion is not.

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export type OKLab = [number, number, number];
export type OKLCH = [number, number, number];

export function rgbToOklab([r, g, b]: RGB): OKLab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Unclamped — channels may fall outside 0..1 when the colour is out of sRGB gamut. */
export function oklabToRgbRaw([L, a, b]: OKLab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function oklabToRgb(lab: OKLab): RGB {
  const [r, g, b] = oklabToRgbRaw(lab);
  return [clamp01(r), clamp01(g), clamp01(b)];
}

export function oklabToOklch([L, a, b]: OKLab): OKLCH {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

export function oklchToOklab([L, C, h]: OKLCH): OKLab {
  const rad = (h * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

export const rgbToOklch = (rgb: RGB): OKLCH => oklabToOklch(rgbToOklab(rgb));
export const oklchToRgb = (lch: OKLCH): RGB => oklabToRgb(oklchToOklab(lch));

const EPS = 1e-4;

export function isInGamut([L, C, h]: OKLCH): boolean {
  const rgb = oklabToRgbRaw(oklchToOklab([L, C, h]));
  return rgb.every((c) => c >= -EPS && c <= 1 + EPS);
}

/**
 * Bring an OKLCH colour into sRGB by lowering chroma only, keeping lightness and hue.
 *
 * This matters for theme inversion: `L -> 1 - L` at unchanged chroma routinely lands
 * outside the gamut, and clamping the RGB channels there swings the hue by ~10 degrees —
 * a bright green comes back visibly yellow. Trading chroma for a correct hue is the
 * lesser evil, and it is what CSS Color 4 gamut mapping does too.
 */
export function toGamut([L, C, h]: OKLCH): OKLCH {
  if (isInGamut([L, C, h])) return [L, C, h];
  if (L <= 0) return [0, 0, h];
  if (L >= 1) return [1, 0, h];
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (isInGamut([L, mid, h])) lo = mid;
    else hi = mid;
  }
  return [L, lo, h];
}

/** `oklchToRgb`, but chroma-reduced into gamut first so the hue is preserved. */
export const oklchToRgbInGamut = (lch: OKLCH): RGB => oklchToRgb(toGamut(lch));

/** Perceptual distance. Used for raster recolouring, clustering and nearest-colour matching. */
export function deltaEOk(a: OKLab, b: OKLab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// --- WCAG contrast --------------------------------------------------------

export function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.1 contrast ratio, 1..21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

import { readFile, writeFile } from 'node:fs/promises';
import { decodePng, encodePng } from './image.ts';
import { resolve, sep } from 'node:path';
import {
  applyEdits, buildLayerTree, buildPalette, canonicalHex, collectProperties, collectSlots,
  deltaEOk, describeSlot, embedEdits, extractPalette, fromHex, invertPixelLightness,
  isMappable, listEffectColors, listGradients, listImageAssets, matchPalettes, quantize,
  readEmbeddedEdits,
  recolorPixels, rgbToOklab, samplePoint, setImageAsset, suggestTheme,
  type ThemeEdits, type TreeNode,
} from '@lottie-theme/core';

/**
 * The operations an agent can perform, as plain functions.
 *
 * They are the same core calls the web app and the CLI make. An agent and a person have
 * to change a file identically or their results drift apart, and then neither can trust
 * what the other did.
 */

/** Everything is confined to a root directory: an agent should not be able to read or
 *  overwrite arbitrary files because a prompt told it to. */
export class Workspace {
  readonly root: string;

  // Written out rather than as a constructor parameter property: Node runs these files
  // by stripping types, and a parameter property is syntax that has to be *compiled*,
  // not erased. `erasableSyntaxOnly` in tsconfig keeps that from creeping back in.
  constructor(root: string) {
    this.root = root;
  }

  resolve(path: string): string {
    const full = resolve(this.root, path);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`${path} is outside the workspace`);
    }
    return full;
  }

  async readDoc(path: string): Promise<unknown> {
    return JSON.parse(await readFile(this.resolve(path), 'utf8'));
  }

  async writeDoc(path: string, doc: unknown): Promise<void> {
    await writeFile(this.resolve(path), JSON.stringify(doc));
  }
}

/**
 * Every tool result is a bill in tokens.
 *
 * A whole-file dump of slots or layers ran to seventy thousand characters — twenty
 * thousand tokens for one call, most of it never used. The defaults below are what the
 * job actually needs; the full form is still there behind a flag for when it is.
 */
const SLOT_LIMIT = 60;

export function listSlots(
  doc: unknown,
  filter?: { hex?: string; kind?: string; limit?: number; describe?: boolean },
) {
  const slots = collectSlots(doc);
  const filtered = slots.filter(
    (s) => (!filter?.hex || s.hex.toUpperCase() === filter.hex.toUpperCase()) && (!filter?.kind || s.kind === filter.kind),
  );
  const limit = filter?.limit ?? SLOT_LIMIT;
  return {
    total: slots.length,
    matched: filtered.length,
    ...(filtered.length > limit ? { shown: limit, hint: 'raise limit, or filter by hex/kind' } : {}),
    slots: filtered.slice(0, limit).map((s) => ({
      index: s.index,
      hex: s.hex,
      kind: s.kind,
      renderKey: s.renderKey,
      layer: s.layerTrail[s.layerTrail.length - 1]?.name ?? null,
      // The prose description is the longest field on a slot and repeats what the layer
      // name and kind already say; it is worth its tokens only when asked for.
      ...(filter?.describe ? { description: describeSlot(s) } : {}),
    })),
  };
}

export function readPalette(doc: unknown, options: { slots?: boolean } = {}) {
  const slots = collectSlots(doc);
  const properties = collectProperties(slots);
  const saved = readEmbeddedEdits(doc);
  return {
    slots: slots.length,
    editable: properties.length,
    colors: buildPalette(slots).map((e) => ({
      hex: e.hex,
      count: e.count,
      kinds: e.kinds,
      // A hundred slot indices per colour, for every colour, is most of this result and
      // is only needed when editing by index rather than by hex.
      ...(options.slots ? { slots: e.slots } : {}),
    })),
    gradients: listGradients(doc, slots).length,
    /** What the person working in the UI has already named and grouped, if anything. */
    ...(saved ? { saved } : {}),
  };
}

/**
 * Layer tree, flattened to a depth-marked list so it survives a JSON tool result.
 *
 * Only what is true is emitted: a layer with no mask says nothing about masks. A false
 * flag repeated across four hundred rows is pure cost, and the absent field reads the
 * same way.
 */
export function layerTree(doc: unknown, options: { depth?: number; limit?: number; verbose?: boolean } = {}) {
  const slots = collectSlots(doc);
  const maxDepth = options.depth ?? 3;
  const limit = options.limit ?? 150;
  const rows: Record<string, unknown>[] = [];
  let hidden = 0;

  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      if (depth > maxDepth || rows.length >= limit) {
        hidden += 1 + countDescendants(node.children);
        continue;
      }
      rows.push({
        depth,
        name: node.name,
        type: node.typeName,
        ...(node.slots.length ? { slots: node.slots } : {}),
        ...(node.sharedPrecomp ? { shared: true } : {}),
        ...(node.hasMask ? { mask: true } : {}),
        ...(node.matte !== 'none' ? { matte: node.matte } : {}),
        ...(node.imageAsset !== null ? { image: node.imageAsset } : {}),
        ...(node.truncated ? { truncated: true } : {}),
        ...(options.verbose ? { id: node.id, frames: [node.ip, node.op] } : {}),
      });
      walk(node.children, depth + 1);
    }
  };
  walk(buildLayerTree(doc, slots), 0);

  return {
    layers: rows,
    ...(hidden
      ? { hidden, hint: `${hidden} deeper layers not listed — raise depth or limit to see them` }
      : {}),
  };
}

function countDescendants(nodes: readonly TreeNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countDescendants(node.children), 0);
}

export function suggest(
  doc: unknown,
  target: 'light' | 'dark',
  backdrop?: string,
  options: { explain?: boolean } = {},
) {
  const slots = collectSlots(doc);
  const result = suggestTheme(doc, slots, collectProperties(slots), { target, backdrop });
  // A role per colour with its reasoning is the bulk of this result. The count of each
  // role says as much when the draft is right, which is most of the time; the reasoning
  // is what you ask for when it is not.
  const byRole: Record<string, number> = {};
  for (const r of result.roles) byRole[r.role] = (byRole[r.role] ?? 0) + 1;
  return {
    edits: result.edits,
    roles: byRole,
    ...(options.explain
      ? { explained: result.roles.map((r) => ({ key: r.key, role: r.role, confidence: r.confidence, reason: r.reason })) }
      : {}),
    audit: result.audit,
  };
}

export function applyToDoc(doc: unknown, edits: ThemeEdits, embed: boolean) {
  const result = applyEdits(doc, edits);
  if (embed) embedEdits(result.doc, edits);
  return result;
}

/**
 * Every gradient in a file, as ramps rather than as loose colours.
 *
 * A gradient's stops mean nothing apart: three greens in a layer list are three greens,
 * and the fact that they are one ramp fading into the page is exactly the thing that
 * decides how to recolour them.
 */
export function gradients(doc: unknown) {
  const ramps = listGradients(doc, collectSlots(doc));
  return {
    total: ramps.length,
    gradients: ramps.map((r) => ({
      path: r.path,
      layer: r.layer,
      type: r.type,
      kind: r.kind,
      stops: r.stops.map((s) => ({ at: Number(s.position.toFixed(3)), hex: s.hex, slot: s.slot })),
      ...(r.alpha.length
        ? { alpha: r.alpha.map((a) => [Number(a.position.toFixed(3)), Number(a.alpha.toFixed(3))]) }
        : {}),
      // The one fact that decides how the ramp must be recoloured.
      ...(r.alpha.some((a) => a.alpha <= 0.02) ? { fadesOut: true } : {}),
    })),
  };
}

/** Colours carried by effects — a drop shadow's own colour, which no palette shows. */
export function effects(doc: unknown) {
  const found = listEffectColors(doc);
  return {
    total: found.length,
    effects: found.map((e) => ({
      path: e.path,
      hex: e.hex,
      layer: e.layer,
      effect: e.effect,
      param: e.param,
      ...(e.opacity === null ? {} : { opacity: Number((e.opacity / 255).toFixed(2)) }),
    })),
  };
}

/**
 * The bitmaps inside a file, and what to do about them.
 *
 * A quarter of real animations carry a PNG, and it is dark like everything else around it.
 * Reading one has always been possible here; changing one was a browser-only trick,
 * because encoding a PNG needs a canvas — so an agent could see the problem and not fix it.
 *
 * With no `map` this only reports: the asset's size and the colours it is actually built
 * from. With one, each pixel is moved towards its nearest mapped colour by distance in
 * OKLab — no threshold, so antialiased edges stay smooth — and **alpha is never touched**,
 * which is what keeps a bitmap that doubles as a matte working after it is recoloured.
 */
export async function recolorImage(
  workspace: Workspace,
  path: string,
  options: { index?: number; map?: Record<string, string>; invert?: boolean; strength?: number } = {},
) {
  const doc = await workspace.readDoc(path);
  const assets = listImageAssets(doc);
  if (!assets.length) return { images: [], hint: 'this file has no embedded bitmaps' };

  const wanted = options.index === undefined ? assets : assets.filter((a) => a.index === options.index);
  if (!wanted.length) throw new Error(`no image asset ${options.index}`);

  const report = [];
  for (const asset of wanted) {
    if (!asset.embedded || asset.mime !== 'image/png') {
      report.push({ index: asset.index, id: asset.id, skipped: asset.embedded ? asset.mime : 'not embedded' });
      continue;
    }
    const pixels = await decodeDataUri(asset.source);
    const palette = quantize(pixels);
    const entry: Record<string, unknown> = {
      index: asset.index,
      id: asset.id,
      size: [pixels.width, pixels.height],
      colors: palette.slice(0, 12).map((c) => ({ hex: c.hex, share: Number(c.share.toFixed(3)) })),
      // More than ~32 colours is a photograph: mapping it colour by colour means nothing,
      // and inverting its lightness is the only sane move.
      mappable: isMappable(palette),
    };

    if (options.map || options.invert) {
      const next = options.invert
        ? invertPixelLightness(pixels, options.strength ?? 1)
        : recolorPixels(
            pixels,
            Object.entries(options.map!).map(([from, to]) => ({ from: canonicalHex(from), to: canonicalHex(to) })),
            options.strength ?? 1,
          );
      setImageAsset(doc, asset.index, `data:image/png;base64,${encodePng(next).toString('base64')}`);
      entry.recoloured = true;
    }
    report.push(entry);
  }

  return { images: report, doc };
}

async function decodeDataUri(dataUri: string) {
  const comma = dataUri.indexOf(',');
  const bytes = Buffer.from(dataUri.slice(comma + 1), 'base64');
  return decodePng(bytes);
}

/** How many colours to look through when snapping: wider than what is reported, so an
 *  accent covering one percent of a screenshot is still a candidate. */
const SNAP_DEPTH = 24;

/** Dominant colours of a reference image, and a proposed mapping onto a document. */
export async function sampleScreenshot(
  workspace: Workspace,
  imagePath: string,
  decode: (path: string) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>,
  options: {
    colors?: number;
    point?: { x: number; y: number };
    doc?: unknown;
    snap?: string[];
    /** Check the result of these edits against the image instead of guessing. */
    verify?: ThemeEdits;
  } = {},
) {
  const pixels = await decode(workspace.resolve(imagePath));
  const palette = extractPalette(pixels, options.colors ?? 6);
  const picked = options.point ? samplePoint(pixels, options.point.x, options.point.y) : null;
  const proposal =
    options.doc && !options.verify
      ? matchPalettes(
          buildPalette(collectSlots(options.doc)).map((p) => ({ hex: p.hex, weight: p.count })),
          palette,
        )
      : null;

  // Whatever the agent believes the colours are, checked against what the image holds.
  // A hex read off a picture by eye lands a shade or two away every time, and a shade or
  // two away is exactly what the person notices next to the real design.
  const wanted = options.snap ? [...options.snap] : [];
  if (options.verify && options.doc) {
    // The colours the animation would actually end up with. Verifying the plan beats
    // rendering it and looking: a near-miss is invisible in a picture and obvious here.
    const after = applyEdits(options.doc, options.verify).doc;
    for (const entry of buildPalette(collectSlots(after))) {
      if (!wanted.includes(entry.hex)) wanted.push(entry.hex);
    }
  }
  const snapped = wanted.length
    ? snapToImage(wanted, extractPalette(pixels, Math.max(options.colors ?? 6, SNAP_DEPTH)))
    : null;

  return {
    width: pixels.width,
    height: pixels.height,
    palette,
    ...(picked ? { picked } : {}),
    ...(proposal ? { proposal } : {}),
    ...(snapped ? { snapped } : {}),
  };
}

/** Each requested colour moved onto the nearest colour the image actually contains. */
function snapToImage(wanted: readonly string[], palette: readonly { hex: string; share: number }[]) {
  return wanted.map((hex) => {
    const asked = canonicalHex(hex);
    const lab = rgbToOklab(fromHex(asked));
    let best = palette[0];
    let distance = Infinity;
    for (const candidate of palette) {
      const d = deltaEOk(lab, rgbToOklab(fromHex(candidate.hex)));
      if (d < distance) {
        distance = d;
        best = candidate;
      }
    }
    return {
      asked,
      nearest: best?.hex ?? asked,
      /** OKLab distance. Below ~0.02 the eye cannot tell them apart — which is precisely
       *  when using the image's own value instead costs nothing and is right. */
      deltaE: Number(distance.toFixed(4)),
      share: best?.share ?? 0,
      exact: best?.hex === asked,
    };
  });
}

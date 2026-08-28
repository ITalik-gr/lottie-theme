import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectSlots, readEmbeddedEdits } from '@lottie-theme/core';
import {
  applyToDoc, layerTree, listSlots, readPalette, recolorImage, sampleScreenshot, suggest, Workspace,
} from '../src/tools.ts';
import { decodePng, encodePng } from '../src/image.ts';
import { renderPreview } from '../src/render.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const file = 'lotties/How to invest/Illustration 1.json';

/** These read real animations from `lotties/`, which is a client's corpus and not
 *  necessarily checked out beside the code. Missing corpus is a skip, not a failure. */
const hasCorpus = existsSync(resolve(repoRoot, 'lotties'));
const workspace = new Workspace(repoRoot);
const load = () => workspace.readDoc(file);

describe('workspace', () => {
  it('resolves a path inside the root', () => {
    expect(workspace.resolve(file)).toBe(join(repoRoot, file));
  });

  it('refuses to escape the root, whatever the prompt said', () => {
    expect(() => workspace.resolve('../../etc/passwd')).toThrow(/outside the workspace/);
    expect(() => workspace.resolve('/etc/passwd')).toThrow(/outside the workspace/);
  });
});

describe.skipIf(!hasCorpus)('read tools', () => {
  it('lists slots with stable indices and filters by colour', async () => {
    const doc = await load();
    const all = listSlots(doc);
    expect(all.total).toBe(collectSlots(doc).length);

    const white = listSlots(doc, { hex: '#ffffff' });
    expect(white.matched).toBeGreaterThan(0);
    expect(white.slots.every((s) => s.hex === '#FFFFFF')).toBe(true);
  });

  it('caps how much it returns, so a 250-slot file does not flood the context', async () => {
    expect(listSlots(await load(), { limit: 5 }).slots).toHaveLength(5);
  });

  it('reads the palette and surfaces what a person already saved in the file', async () => {
    const doc = await load();
    // Nothing saved means the field is absent, not present and null: an empty field on
    // every call is a token nobody reads.
    expect(readPalette(doc).saved).toBeUndefined();
    expect(readPalette(doc).colors[0]!.slots).toBeUndefined();
    expect(readPalette(doc, { slots: true }).colors[0]!.slots!.length).toBeGreaterThan(0);

    const withMeta = applyToDoc(doc, { version: 1, groups: { surface: [0, 1] } }, true).doc;
    expect(readPalette(withMeta).saved?.groups).toEqual({ surface: [0, 1] });
  });

  it('flattens the layer tree with depth, so it survives a JSON result', async () => {
    const { layers } = layerTree(await load());
    expect(layers.length).toBeGreaterThan(5);
    expect(layers[0]!.depth).toBe(0);
    expect(layers.some((l) => (l.depth as number) > 0)).toBe(true);
  });
});

describe.skipIf(!hasCorpus)('write tools', () => {
  it('applies an edit set and can embed it for the next reader', async () => {
    const doc = await load();
    const result = applyToDoc(doc, { version: 1, byHex: { '#FFFFFF': '#17181D' } }, true);
    expect(result.colorsChanged).toBeGreaterThan(0);
    expect(readEmbeddedEdits(result.doc)?.byHex).toEqual({ '#FFFFFF': '#17181D' });
  });

  it('writes only inside the workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lottie-mcp-'));
    const sandbox = new Workspace(dir);
    await sandbox.writeDoc('out.json', { layers: [] });
    expect(JSON.parse(await readFile(join(dir, 'out.json'), 'utf8'))).toEqual({ layers: [] });
    await expect(sandbox.writeDoc('../escape.json', {})).rejects.toThrow(/outside the workspace/);
  });

  it('suggests a theme without writing anything', async () => {
    const doc = await load();
    const before = JSON.stringify(doc);
    const result = suggest(doc, 'light');
    expect(Object.keys(result.edits.byIndex ?? {}).length).toBeGreaterThan(0);
    // Roles come back as counts; the reasoning is what `explain` is for, because it is
    // the bulk of the result and is only read when the draft looks wrong.
    expect(Object.values(result.roles).reduce((n, c) => n + c, 0)).toBeGreaterThan(0);
    expect(result.explained).toBeUndefined();
    expect(suggest(doc, 'light', undefined, { explain: true }).explained!.every((r) => r.reason.length > 0)).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('png decoding', () => {
  it('reads a real screenshot without a native dependency', async () => {
    const path = process.env.SMOKE_REFERENCE;
    if (!path) return;
    const pixels = await decodePng(path);
    expect(pixels.width).toBeGreaterThan(0);
    expect(pixels.data).toHaveLength(pixels.width * pixels.height * 4);
    expect(pixels.data.some((v) => v > 0)).toBe(true);
  });

  it('refuses a file that is not a PNG', async () => {
    await expect(decodePng(join(repoRoot, 'package.json'))).rejects.toThrow(/not a PNG/);
  });
});

describe.skipIf(!hasCorpus)('sample_screenshot', () => {
  it('extracts a palette and proposes a mapping', async () => {
    const path = process.env.SMOKE_REFERENCE;
    if (!path) return;
    const result = await sampleScreenshot(new Workspace(resolve(path, '..')), path, decodePng, {
      colors: 5,
      point: { x: 10, y: 10 },
      doc: await load(),
    });
    expect(result.palette.length).toBeGreaterThan(1);
    expect(result.picked).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.proposal?.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasCorpus)('render_preview', () => {
  it('renders the animation to a PNG an agent can look at', async () => {
    const result = await renderPreview(await load(), { progress: 0.5, width: 256, height: 256 });
    expect(result.totalFrames).toBeGreaterThan(0);
    expect(result.frame).toBeGreaterThan(0);

    const pixels = decodeBase64Png(result.base64);
    expect(pixels.width).toBeGreaterThan(0);
  }, 60_000);

  it('composites onto the background it is given, which is what makes a fading gradient readable', async () => {
    const doc = await load();
    const onWhite = await renderPreview(doc, { progress: 0.5, width: 128, height: 128, background: '#FFFFFF' });
    const onBlack = await renderPreview(doc, { progress: 0.5, width: 128, height: 128, background: '#000000' });
    expect(onWhite.base64).not.toBe(onBlack.base64);
  }, 60_000);
});

function decodeBase64Png(base64: string) {
  const buffer = Buffer.from(base64, 'base64');
  expect(buffer.readUInt32BE(0)).toBe(0x89504e47);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('embedded bitmaps', () => {
  it('recolours a bitmap in Node, keeping its alpha — a matte must survive being recoloured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lottie-png-'));
    const sandbox = new Workspace(dir);
    // Four pixels: opaque black, transparent black, and two half-transparent ones. The
    // stripe textures this exists for are exactly this — one colour carried by alpha.
    const data = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 200]);
    const png = encodePng({ data, width: 2, height: 2 });
    await sandbox.writeDoc('in.json', {
      v: '5.7.0', fr: 30, ip: 0, op: 30, w: 10, h: 10,
      assets: [{ id: 'tex', w: 2, h: 2, p: `data:image/png;base64,${png.toString('base64')}` }],
      layers: [],
    });

    const before = await recolorImage(sandbox, 'in.json');
    expect(before.images[0]).toMatchObject({ index: 0, size: [2, 2], mappable: true });

    const after = await recolorImage(sandbox, 'in.json', { map: { '#000000': '#FFFFFF' } });
    await sandbox.writeDoc('out.json', after.doc);
    const written = (await sandbox.readDoc('out.json')) as { assets: { p: string }[] };
    const pixels = await decodePng(Buffer.from(written.assets[0]!.p.split(',')[1]!, 'base64'));
    expect([...pixels.data.slice(0, 3)]).toEqual([255, 255, 255]);
    expect([...pixels.data].filter((_, i) => i % 4 === 3)).toEqual([255, 0, 128, 200]);
  });
});

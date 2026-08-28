import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  buildLayerTree, collectProperties, collectSlots, findNode, setLayerName, slotsInSubtree,
  recolor, type TreeNode,
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

const flatten = (nodes: readonly TreeNode[]): TreeNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children)]);

describe('layer tree', () => {
  it.each(corpus().map((f) => [f.slice(repoRoot.length + 1), f]))('%s', (_n, file) => {
    const doc = load(file);
    const slots = collectSlots(doc);
    const tree = buildLayerTree(doc, slots);
    const nodes = flatten(tree);

    // every slot is attached to exactly one layer node
    const attached = nodes.flatMap((n) => n.slots);
    expect([...attached].sort((a, b) => a - b)).toEqual(slots.map((s) => s.index));

    // node ids are unique, so the UI can key rows by them
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);

    // the subtree of the whole document is every slot
    expect(tree.flatMap(slotsInSubtree).sort((a, b) => a - b)).toEqual(slots.map((s) => s.index));
  });

  it('expands a precomp inline and marks the second reference as shared', () => {
    const doc = {
      layers: [
        { ty: 0, refId: 'pc', nm: 'A', ip: 0, op: 60, ind: 1 },
        { ty: 0, refId: 'pc', nm: 'B', ip: 0, op: 60, ind: 2 },
      ],
      assets: [{
        id: 'pc',
        layers: [{ ty: 4, nm: 'Dot', ip: 0, op: 60, ind: 1, shapes: [{ ty: 'fl', nm: 'F', c: { k: [1, 0, 0] }, o: { k: 100 } }] }],
      }],
    };
    const tree = buildLayerTree(doc, collectSlots(doc));
    expect(tree.map((n) => n.name)).toEqual(['A', 'B']);
    expect(tree[0]!.sharedPrecomp).toBe(false);
    expect(tree[1]!.sharedPrecomp).toBe(true);
    expect(tree[0]!.children[0]!.name).toBe('Dot');
    // both references expand, and the ids differ even though the layer path is the same
    expect(tree[0]!.children[0]!.id).not.toBe(tree[1]!.children[0]!.id);
  });

  it('stops at a precomp cycle instead of hanging', () => {
    const doc = {
      layers: [{ ty: 0, refId: 'loop', nm: 'Root', ip: 0, op: 60, ind: 1 }],
      assets: [{
        id: 'loop',
        layers: [
          { ty: 4, nm: 'S', ip: 0, op: 60, ind: 1, shapes: [{ ty: 'fl', nm: 'F', c: { k: [1, 1, 1] }, o: { k: 100 } }] },
          { ty: 0, refId: 'loop', nm: 'Self', ip: 0, op: 60, ind: 2 },
        ],
      }],
    };
    const tree = buildLayerTree(doc, collectSlots(doc));
    const self = tree[0]!.children[1]!;
    expect(self.truncated).toBe(true);
    expect(self.children).toEqual([]);
  });

  it('names the layer type when the exporter stripped nm', () => {
    const doc = { layers: [{ ty: 4, ip: 0, op: 60, ind: 1, shapes: [] }] };
    const node = buildLayerTree(doc, [])[0]!;
    expect(node.name).toBeNull();
    expect(node.typeName).toBe('shape');
  });

  it('records image layers so the raster step can find them', () => {
    const doc = {
      layers: [{ ty: 2, refId: 'img', nm: 'Photo', ip: 0, op: 60, ind: 1 }],
      assets: [{ id: 'img', w: 10, h: 10, p: 'data:image/png;base64,AAAA', e: 1 }],
    };
    expect(buildLayerTree(doc, [])[0]!.imageAsset).toBe('img');
  });

  it('renames a layer in the document', () => {
    const doc = { layers: [{ ty: 4, ip: 0, op: 60, ind: 1, shapes: [] }] } as Record<string, unknown>;
    const node = buildLayerTree(doc, [])[0]!;
    setLayerName(doc, node.path, '  Card background  ');
    expect(buildLayerTree(doc, [])[0]!.name).toBe('Card background');

    setLayerName(doc, node.path, '   ');
    expect(buildLayerTree(doc, [])[0]!.name).toBeNull();
    expect(Object.hasOwn((doc.layers as Record<string, unknown>[])[0]!, 'nm')).toBe(false);
  });

  it('refuses to rename a path that is not a layer', () => {
    expect(() => setLayerName({ layers: [] }, ['layers', 4], 'x')).toThrow();
  });

  it('finds a node by id', () => {
    const doc = {
      layers: [{ ty: 0, refId: 'pc', nm: 'A', ip: 0, op: 60, ind: 1 }],
      assets: [{ id: 'pc', layers: [{ ty: 4, nm: 'Inner', ip: 0, op: 60, ind: 1, shapes: [] }] }],
    };
    const tree = buildLayerTree(doc, collectSlots(doc));
    const inner = tree[0]!.children[0]!;
    expect(findNode(tree, inner.id)).toBe(inner);
    expect(findNode(tree, 'nope')).toBeNull();
  });
});

describe('colour properties', () => {
  it('collapses the slots of a reused precomp into one editable colour', () => {
    // The real case from lotties/pagination loading/gradient_02.json: one asset,
    // referenced many times, is a single JSON object — so one colour, drawn many times.
    const doc = {
      layers: Array.from({ length: 5 }, (_, i) => ({ ty: 0, refId: 'pc', nm: `I${i}`, ip: 0, op: 60, ind: i + 1 })),
      assets: [{
        id: 'pc',
        layers: [{ ty: 4, nm: 'Dot', ip: 0, op: 60, ind: 1, shapes: [{ ty: 'fl', nm: 'F', c: { k: [1, 0, 0] }, o: { k: 100 } }] }],
      }],
    };
    const slots = collectSlots(doc);
    expect(slots).toHaveLength(5);

    const props = collectProperties(slots);
    expect(props).toHaveLength(1);
    expect(props[0]!.occurrences).toBe(5);
    expect(props[0]!.shared).toBe(true);
    expect(props[0]!.slots).toEqual([0, 1, 2, 3, 4]);

    // and editing one really does change all five
    const { doc: out } = recolor(doc, { byIndex: { 0: '#00FF00' } });
    expect(collectSlots(out).map((s) => s.hex)).toEqual(Array(5).fill('#00FF00'));
  });

  it('collapses the keyframes of an animated colour into one property', () => {
    const doc = {
      layers: [{
        ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
        shapes: [{ ty: 'fl', nm: 'F', o: { k: 100 }, c: { k: [{ s: [1, 0, 0], e: [0, 1, 0], t: 0 }, { s: [0, 1, 0], t: 30 }] } }],
      }],
    };
    const slots = collectSlots(doc);
    expect(slots.length).toBeGreaterThan(1);
    const props = collectProperties(slots);
    expect(props).toHaveLength(1);
    expect(props[0]!.occurrences).toBe(slots.length);
  });

  it('keeps gradient stops separate — each one paints its own SVG stop', () => {
    const doc = {
      layers: [{
        ty: 4, nm: 'L', ip: 0, op: 60, ind: 1,
        shapes: [{ ty: 'gf', nm: 'G', o: { k: 100 }, g: { p: 2, k: { k: [0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0] } } }],
      }],
    };
    const props = collectProperties(collectSlots(doc));
    expect(props).toHaveLength(2);
    expect(props.map((p) => p.stop)).toEqual([0, 1]);
    expect(props.every((p) => p.shared)).toBe(false);
  });

  it.skipIf(!hasCorpus)('reports the corpus collapse honestly', () => {
    const file = corpus().find((f) => f.includes('gradient_02'))!;
    const slots = collectSlots(load(file));
    const props = collectProperties(slots);
    expect(slots.length).toBe(110);
    expect(props.length).toBe(11); // matches what lottie-web actually paints
    expect(props.filter((p) => p.shared).length).toBe(11);
  });

  it('every slot belongs to exactly one property, across the corpus', () => {
    for (const f of corpus()) {
      const slots = collectSlots(load(f));
      const props = collectProperties(slots);
      const covered = props.flatMap((p) => p.slots).sort((a, b) => a - b);
      expect(covered).toEqual(slots.map((s) => s.index));
      for (const p of props) {
        // a shared property must really hold one colour everywhere it appears
        const hexes = new Set(p.slots.map((i) => slots[i]!.hex));
        if (p.kind !== 'fill' && p.kind !== 'stroke') continue;
        if (!slots[p.slots[0]!]!.keyframe) expect(hexes.size).toBe(1);
      }
    }
  });
});

describe('masks and mattes', () => {
  it('flags masked and matted layers, which are clickable but hold no colour', () => {
    const doc = {
      layers: [
        { ty: 4, nm: 'Matte', ip: 0, op: 60, ind: 1, td: 1, shapes: [] },
        { ty: 4, nm: 'Matted', ip: 0, op: 60, ind: 2, tt: 1, shapes: [] },
        { ty: 4, nm: 'Masked', ip: 0, op: 60, ind: 3, masksProperties: [{ mode: 'a' }], shapes: [] },
        { ty: 4, nm: 'Plain', ip: 0, op: 60, ind: 4, shapes: [] },
      ],
    };
    const tree = buildLayerTree(doc, []);
    expect(tree.map((n) => n.matte)).toEqual(['source', 'target', 'none', 'none']);
    expect(tree.map((n) => n.hasMask)).toEqual([false, false, true, false]);
  });

  it('carries the same flags on the slot layer trail, for the hit stack', () => {
    const doc = {
      layers: [{
        ty: 4, nm: 'Masked', ip: 0, op: 60, ind: 1, masksProperties: [{ mode: 'a' }],
        shapes: [{ ty: 'fl', nm: 'F', c: { k: [1, 0, 0] }, o: { k: 100 } }],
      }],
    };
    const slot = collectSlots(doc)[0]!;
    expect(slot.layerTrail[0]!.hasMask).toBe(true);
    expect(slot.layerTrail[0]!.matte).toBe('none');
  });

  it.skipIf(!hasCorpus)('counts masked layers in the corpus, so the flag is not dead code', () => {
    const total = corpus().reduce((n, f) => {
      const doc = load(f);
      return n + flatten(buildLayerTree(doc, [])).filter((x) => x.hasMask || x.matte !== 'none').length;
    }, 0);
    expect(total).toBeGreaterThan(0);
  });
});

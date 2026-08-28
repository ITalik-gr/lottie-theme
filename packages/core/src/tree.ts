import type { LayerRef, Path, Slot } from './types.ts';
import { getAtPath } from './slots.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const LAYER_TYPE_NAMES: Record<number, string> = {
  0: 'precomp',
  1: 'solid',
  2: 'image',
  3: 'null',
  4: 'shape',
  5: 'text',
  6: 'audio',
  13: 'camera',
};

export interface TreeNode extends LayerRef {
  /** Stable id: the layer path, plus the reference chain for a reused precomp. */
  id: string;
  /** `precomp`, `shape`, … — what to show when the exporter stripped `nm`. */
  typeName: string;
  /** Layer opacity `ks.o.k`, when it is a plain number. */
  opacity: number | null;
  /** Slot indices owned by this layer directly (not by its children). */
  slots: number[];
  children: TreeNode[];
  /** Set when this node is a second or later reference to the same precomp asset:
   *  its colours are shared with the other references and cannot be edited apart. */
  sharedPrecomp: boolean;
  /** For an image layer, the asset id its pixels come from. */
  imageAsset: string | null;
  /** True when a cycle stopped the walk here. */
  truncated: boolean;
}

/**
 * The document as a layer tree, in the same z-order as `collectSlots`, with each
 * layer's colour slots attached. Precomp references are expanded inline, because
 * that is how the animation actually reads.
 */
export function buildLayerTree(doc: Any, slots: readonly Slot[]): TreeNode[] {
  const assets = new Map<string, { asset: Any; index: number }>();
  const images = new Map<string, Any>();
  const list: Any[] = Array.isArray(doc?.assets) ? doc.assets : [];
  list.forEach((a, i) => {
    if (!a || typeof a.id !== 'string') return;
    if (Array.isArray(a.layers)) assets.set(a.id, { asset: a, index: i });
    else if (a.p !== undefined) images.set(a.id, a);
  });

  // Slots are emitted in the same traversal order, so they can be reattached without
  // walking the shape tree again. The key has to be the whole reference chain, not the
  // layer path: a precomp referenced twice is one path visited under two different
  // parents, and keying by path alone would hang every slot on both copies.
  const byChain = new Map<string, number[]>();
  for (const s of slots) {
    if (!s.layerTrail.length) continue;
    const key = s.layerTrail.map((l) => l.path.join('.')).join('/');
    const bucket = byChain.get(key);
    if (bucket) bucket.push(s.index);
    else byChain.set(key, [s.index]);
  }

  const refCount = new Map<string, number>();
  const active = new Set<string>();

  function build(layers: Any[], path: Path, idPrefix: string): TreeNode[] {
    const out: TreeNode[] = [];
    layers.forEach((layer, i) => {
      if (!layer || typeof layer !== 'object') return;
      const layerPath = [...path, i];
      const key = layerPath.join('.');
      const ty = typeof layer.ty === 'number' ? layer.ty : -1;
      const refId = typeof layer.refId === 'string' ? layer.refId : null;

      let children: TreeNode[] = [];
      let truncated = false;
      let sharedPrecomp = false;

      if (ty === 0 && refId && assets.has(refId)) {
        const seen = (refCount.get(refId) ?? 0) + 1;
        refCount.set(refId, seen);
        sharedPrecomp = seen > 1;
        if (active.has(refId)) {
          truncated = true;
        } else {
          active.add(refId);
          const entry = assets.get(refId)!;
          children = build(entry.asset.layers, ['assets', entry.index, 'layers'], `${idPrefix}${key}/`);
          active.delete(refId);
        }
      }

      out.push({
        id: `${idPrefix}${key}`,
        path: layerPath,
        name: typeof layer.nm === 'string' ? layer.nm : null,
        typeName: LAYER_TYPE_NAMES[ty] ?? `type ${ty}`,
        ty,
        ip: typeof layer.ip === 'number' ? layer.ip : 0,
        op: typeof layer.op === 'number' ? layer.op : 0,
        ind: typeof layer.ind === 'number' ? layer.ind : null,
        refId,
        hasMask: Array.isArray(layer.masksProperties) && layer.masksProperties.length > 0,
        matte: layer.td ? 'source' : layer.tt ? 'target' : 'none',
        opacity: typeof layer?.ks?.o?.k === 'number' ? layer.ks.o.k : null,
        slots: byChain.get(`${idPrefix}${key}`) ?? [],
        children,
        sharedPrecomp,
        imageAsset: ty === 2 && refId && images.has(refId) ? refId : null,
        truncated,
      });
    });
    return out;
  }

  return build(Array.isArray(doc?.layers) ? doc.layers : [], ['layers'], '');
}

/** Slot indices under a node, including everything in its children. */
export function slotsInSubtree(node: TreeNode): number[] {
  const out = [...node.slots];
  for (const child of node.children) out.push(...slotsInSubtree(child));
  return out;
}

export function findNode(nodes: readonly TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findNode(node.children, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Rename a layer in place, writing `nm` in the document.
 *
 * Exports from AE and Figma routinely strip layer names, which leaves a file nobody can
 * read. Naming a layer once is meant to persist in the file itself, for the next person
 * as much as for this session.
 */
export function setLayerName(doc: Any, path: Path, name: string): void {
  const layer = getAtPath(doc, path);
  if (!layer || typeof layer !== 'object') {
    throw new Error(`no layer at ${path.join('.')}`);
  }
  const trimmed = name.trim();
  if (trimmed) layer.nm = trimmed;
  else delete layer.nm;
}

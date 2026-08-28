import type { AlphaStop, LayerRef, Path, Slot, SlotKind } from './types.ts';
import { toHex, fromHex, isHex } from './color.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** Walk a path from the document root. Returns undefined if any hop is missing. */
export function getAtPath(doc: Any, path: Path): Any {
  let node: Any = doc;
  for (const key of path) {
    if (node == null) return undefined;
    node = node[key as Any];
  }
  return node;
}

/** Current colour of a slot, read live from `doc`. */
export function readSlot(doc: Any, slot: Pick<Slot, 'path' | 'offset' | 'encoding'>): string {
  const container = getAtPath(doc, slot.path);
  if (container == null) throw new Error(`slot path not found: ${slot.path.join('.')}`);
  if (slot.encoding === 'hexString') return isHex(container) ? toHex(fromHex(container)) : '#000000';
  return toHex([container[slot.offset], container[slot.offset + 1], container[slot.offset + 2]]);
}

/** Write a colour into `doc` in place, preserving the slot's own encoding. */
export function writeSlot(
  doc: Any,
  slot: Pick<Slot, 'path' | 'offset' | 'encoding'>,
  hex: string,
): void {
  const rgb = fromHex(hex);
  if (slot.encoding === 'hexString') {
    const parent = getAtPath(doc, slot.path.slice(0, -1));
    if (parent == null) throw new Error(`slot path not found: ${slot.path.join('.')}`);
    parent[slot.path[slot.path.length - 1] as Any] = toHex(rgb).toLowerCase();
    return;
  }
  const arr = getAtPath(doc, slot.path);
  if (arr == null) throw new Error(`slot path not found: ${slot.path.join('.')}`);
  arr[slot.offset] = rgb[0];
  arr[slot.offset + 1] = rgb[1];
  arr[slot.offset + 2] = rgb[2];
}

/** Alpha ramp of a gradient, read from the tail of `g.k.k` after the `p` colour stops.
 *  Without these, a gradient that fades into the background cannot be interpreted. */
export function readAlphaStops(doc: Any, gradientPath: Path): AlphaStop[] {
  const arr = getAtPath(doc, gradientPath);
  if (!Array.isArray(arr)) return [];
  const p = gradientStopCount(doc, gradientPath);
  const out: AlphaStop[] = [];
  for (let i = p * 4; i + 1 < arr.length; i += 2) {
    out.push({ position: arr[i], alpha: arr[i + 1] });
  }
  return out;
}

/** `g.p` — number of colour stops. Falls back to `length / 4` when absent.
 *  The ramp lives at `…g.k.k` when static and at `…g.k.k.<i>.s` when animated,
 *  so `g` is two or four hops up depending on which we were handed. */
function gradientStopCount(doc: Any, gradientPath: Path): number {
  const animated = gradientPath[gradientPath.length - 1] === 's';
  const g = getAtPath(doc, gradientPath.slice(0, animated ? -4 : -2));
  const arr = getAtPath(doc, gradientPath);
  const p = g?.p?.k ?? g?.p;
  return typeof p === 'number' ? p : Math.floor((arr?.length ?? 0) / 4);
}

const asNumber = (v: Any): number | null => (typeof v === 'number' ? v : null);

function layerRef(layer: Any, path: Path): LayerRef {
  return {
    path,
    name: typeof layer?.nm === 'string' ? layer.nm : null,
    ty: typeof layer?.ty === 'number' ? layer.ty : -1,
    ip: asNumber(layer?.ip) ?? 0,
    op: asNumber(layer?.op) ?? 0,
    ind: asNumber(layer?.ind),
    refId: typeof layer?.refId === 'string' ? layer.refId : null,
    hasMask: Array.isArray(layer?.masksProperties) && layer.masksProperties.length > 0,
    matte: layer?.td ? 'source' : layer?.tt ? 'target' : 'none',
  };
}

/**
 * Every colour slot in the document, in layer z-order (topmost layer first),
 * descending into precomp assets where they are referenced.
 *
 * The order is the contract: it is what makes slot indices stable and therefore
 * what makes saved colour maps, groups and presets re-appliable after a re-import.
 * Do not reorder without bumping the metadata version.
 */
export function collectSlots(doc: Any): Slot[] {
  const out: Slot[] = [];
  const assets = new Map<string, { asset: Any; index: number }>();
  const assetList: Any[] = Array.isArray(doc?.assets) ? doc.assets : [];
  assetList.forEach((a, i) => {
    if (a && Array.isArray(a.layers) && typeof a.id === 'string') {
      assets.set(a.id, { asset: a, index: i });
    }
  });

  /** Guards against a precomp that references itself, directly or in a cycle. */
  const active = new Set<string>();

  const push = (s: Omit<Slot, 'index' | 'hex'> & { hex?: string }): void => {
    const hex = s.hex ?? readSlot(doc, s);
    out.push({ ...s, hex, index: out.length } as Slot);
  };

  function colorArray(
    path: Path,
    offset: number,
    kind: SlotKind,
    renderKey: string,
    ctx: { layerTrail: LayerRef[]; shapeTrail: string[]; opacity: number | null },
    extra: Partial<Slot> = {},
  ): void {
    const arr = getAtPath(doc, path);
    if (!Array.isArray(arr) || arr.length < offset + 3) return;
    if (typeof arr[offset] !== 'number') return;
    push({ kind, encoding: 'rgb01', path, offset, renderKey, ...ctx, ...extra });
  }

  function shapes(
    items: Any[],
    path: Path,
    layerTrail: LayerRef[],
    shapeTrail: string[],
  ): void {
    items.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      const itemPath = [...path, i];
      const trail = [...shapeTrail, typeof item.nm === 'string' ? item.nm : String(item.ty)];
      const ty = item.ty;
      const opacity = asNumber(item?.o?.k);
      const ctx = { layerTrail, shapeTrail: trail, opacity };

      if (ty === 'gr') {
        if (Array.isArray(item.it)) shapes(item.it, [...itemPath, 'it'], layerTrail, trail);
        return;
      }

      if (ty === 'fl' || ty === 'st') {
        const kind: SlotKind = ty === 'fl' ? 'fill' : 'stroke';
        const k = item?.c?.k;
        // All keyframes of one property paint a single interpolated colour, so they
        // share a render key even though each keyframe is its own editable slot.
        const key = `${itemPath.join('.')}.c`;
        if (Array.isArray(k) && typeof k[0] === 'number') {
          colorArray([...itemPath, 'c', 'k'], 0, kind, key, ctx);
        } else if (Array.isArray(k)) {
          k.forEach((kf: Any, ki: number) => {
            (['s', 'e'] as const).forEach((field) => {
              if (Array.isArray(kf?.[field]) && kf[field].length >= 3) {
                colorArray([...itemPath, 'c', 'k', ki, field], 0, kind, key, ctx, {
                  keyframe: { i: ki, field },
                });
              }
            });
          });
        }
        return;
      }

      if (ty === 'gf' || ty === 'gs') {
        const kind: SlotKind = ty === 'gf' ? 'gradient-fill' : 'gradient-stroke';
        const gk = item?.g?.k?.k;
        // A gradient ramp can itself be animated: `g.k.k` is then keyframes, not numbers.
        const ramps: { path: Path; arr: Any; kf?: number }[] =
          Array.isArray(gk) && typeof gk[0] === 'number'
            ? [{ path: [...itemPath, 'g', 'k', 'k'], arr: gk }]
            : Array.isArray(gk)
              ? gk.flatMap((kf: Any, ki: number) =>
                  Array.isArray(kf?.s)
                    ? [{ path: [...itemPath, 'g', 'k', 'k', ki, 's'] as Path, arr: kf.s, kf: ki }]
                    : [],
                )
              : [];

        for (const ramp of ramps) {
          const p = gradientStopCount(doc, ramp.path);
          for (let s = 0; s < p; s++) {
            const o = s * 4;
            if (ramp.arr.length < o + 4) break;
            colorArray(ramp.path, o + 1, kind, `${itemPath.join('.')}.g#${s}`, ctx, {
              stop: { i: s, position: ramp.arr[o] },
              ...(ramp.kf === undefined ? {} : { keyframe: { i: ramp.kf, field: 's' as const } }),
            });
          }
        }
        return;
      }
    });
  }

  function textLayer(layer: Any, path: Path, layerTrail: LayerRef[]): void {
    const docs = layer?.t?.d?.k;
    if (!Array.isArray(docs)) return;
    docs.forEach((entry: Any, i: number) => {
      const base = [...path, 't', 'd', 'k', i, 's'];
      const ctx = { layerTrail, shapeTrail: ['text'], opacity: null };
      // Every text document keyframe repaints the same layer, so one key per field.
      const key = `${path.join('.')}.t`;
      if (Array.isArray(entry?.s?.fc)) {
        colorArray([...base, 'fc'], 0, 'text-fill', `${key}#fc`, ctx, { textDoc: { i } });
      }
      if (Array.isArray(entry?.s?.sc)) {
        colorArray([...base, 'sc'], 0, 'text-stroke', `${key}#sc`, ctx, { textDoc: { i } });
      }
    });
  }

  function layers(list: Any[], path: Path, trail: LayerRef[]): void {
    list.forEach((layer, i) => {
      if (!layer || typeof layer !== 'object') return;
      const layerPath = [...path, i];
      const ref = layerRef(layer, layerPath);
      const nextTrail = [...trail, ref];

      // Solid layers keep their colour in `sc` as a hex string, outside the shape tree.
      if (layer.ty === 1 && typeof layer.sc === 'string' && isHex(layer.sc)) {
        push({
          kind: 'solid-layer',
          encoding: 'hexString',
          path: [...layerPath, 'sc'],
          offset: 0,
          renderKey: `${layerPath.join('.')}.sc`,
          layerTrail: nextTrail,
          shapeTrail: [],
          opacity: asNumber(layer?.ks?.o?.k),
        });
      }

      if (layer.ty === 4 && Array.isArray(layer.shapes)) {
        shapes(layer.shapes, [...layerPath, 'shapes'], nextTrail, []);
      }

      if (layer.ty === 5) textLayer(layer, layerPath, nextTrail);

      if (layer.ty === 0 && typeof layer.refId === 'string') {
        const entry = assets.get(layer.refId);
        if (entry && !active.has(layer.refId)) {
          active.add(layer.refId);
          layers(entry.asset.layers, ['assets', entry.index, 'layers'], nextTrail);
          active.delete(layer.refId);
        }
      }
    });
  }

  layers(Array.isArray(doc?.layers) ? doc.layers : [], ['layers'], []);
  return out;
}

/** Short, greppable description of a slot — the CLI's `list` column and the UI's tooltip. */
export function describeSlot(slot: Slot): string {
  const layers = slot.layerTrail.map((l) => l.name ?? `#${l.ind ?? '?'}`).join(' > ');
  const shapes = slot.shapeTrail.join('/');
  const bits: string[] = [slot.kind];
  if (slot.stop) bits.push(`stop${slot.stop.i}@${slot.stop.position.toFixed(2)}`);
  if (slot.keyframe) bits.push(`kf${slot.keyframe.i}.${slot.keyframe.field}`);
  if (slot.opacity !== null) bits.push(`o=${slot.opacity}`);
  return `${bits.join(' ')} ${layers}${shapes ? ' | ' + shapes : ''}`;
}

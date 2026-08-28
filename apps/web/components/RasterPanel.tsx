'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isHex, isMappable, listImageAssets, MAPPABLE_COLOR_LIMIT, type ImageAsset } from '@lottie-theme/core';
import { decodeImage, encodePng, quantize, transform, type Pixels, type QuantizedColor, type RasterMode } from '@/lib/raster';
import { useEditor } from '@/lib/store';
import { AlertCircle, ArrowRight, Check, Undo2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColorField } from './ColorField';
import { Swatch } from './Swatch';

/** A small picture of an asset, for telling six same-sized entries apart. */
function Thumb({ src }: { src: string }) {
  if (!src.startsWith('data:')) return <span className="checker size-5 shrink-0 rounded" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="checker size-5 shrink-0 rounded object-cover" />;
}

function Preview({ pixels, label }: { pixels: Pixels | null; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !pixels) return;
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    canvas.getContext('2d')?.putImageData(pixels as ImageData, 0, 0);
  }, [pixels]);
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-[12px] text-[var(--color-fg-mute)]">{label}</div>
      <canvas
        ref={ref}
        className="checker h-auto w-full rounded border border-[var(--color-line)]" 
      />
    </div>
  );
}

/**
 * Embedded bitmaps.
 *
 * A quarter of this corpus ships PNGs inside the JSON, and they are dark like everything
 * else. Warning about them would just move the problem, so they are recoloured with the
 * same map as the vectors: the image's own colours are listed and mapped by name, and
 * pixels are blended towards the targets by distance rather than by a threshold.
 */
export function RasterPanel() {
  const original = useEditor((s) => s.original);
  const edits = useEditor((s) => s.edits);
  const replaceAsset = useEditor((s) => s.replaceImageAsset);

  const assets = useMemo(() => (original ? listImageAssets(original) : []), [original]);
  const [selected, setSelected] = useState(0);
  const [source, setSource] = useState<Pixels | null>(null);
  const [palette, setPalette] = useState<QuantizedColor[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<RasterMode>('map');
  const [strength, setStrength] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const asset: ImageAsset | undefined = assets[selected];

  /**
   * The bytes this asset currently has, not the ones the file shipped with.
   *
   * `listImageAssets` reads the untouched document, so after a replacement it still
   * points at the old picture — which is why the previews kept showing the photo that
   * had just been swapped out while the animation itself showed the new one.
   */
  const assetSource = asset ? (edits.images?.[asset.index]?.dataUri ?? asset.source) : null;

  useEffect(() => {
    setSource(null);
    setPalette([]);
    setError(null);
    if (!assetSource) return;
    let cancelled = false;
    decodeImage(assetSource)
      .then(({ pixels }) => {
        if (cancelled) return;
        const found = quantize(pixels);
        setSource(pixels);
        setPalette(found);
        // Seed from the vector colour map: the same surface colour usually appears in both.
        // Read at this moment rather than depended on: the edit set gets a new identity on
        // every colour change, and re-seeding then would throw away the mapping being made.
        const byHex = useEditor.getState().edits.byHex ?? {};
        const seeded: Record<string, string> = {};
        for (const c of found) {
          const mapped = byHex[c.hex];
          if (mapped) seeded[c.hex] = mapped;
        }
        setMapping(seeded);
        setMode(isMappable(found) ? 'map' : 'invert');
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'could not decode'));
    return () => {
      cancelled = true;
    };
  }, [assetSource]);

  const mappings = useMemo(
    () => Object.entries(mapping).filter(([from, to]) => isHex(to) && from !== to).map(([from, to]) => ({ from, to })),
    [mapping],
  );

  const result = useMemo(
    () => (source ? transform(source, mode, mappings, strength) : null),
    [source, mode, mappings, strength],
  );

  if (!assets.length) return null;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="shrink-0 text-[12px] text-[var(--color-fg-dim)]">{assets.length} embedded</span>
        <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
          <SelectTrigger size="sm" className="min-w-0 flex-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assets.map((a, i) => (
              <SelectItem key={a.id} value={String(i)}>
                {/* Six entries called 82×82 tell you nothing about which one you are picking. */}
                <Thumb src={edits.images?.[a.index]?.dataUri ?? a.source} />
                <span className="text-[12px]">{a.id}</span>
                <span className="text-[11px] tabular-nums text-[var(--color-fg-mute)]">
                  {a.w}×{a.h}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {error && (
          <p className="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--color-destructive)]">
            <AlertCircle className="size-3.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="mb-2 flex gap-2">
          <Preview pixels={source} label="before" />
          <Preview pixels={result} label="after" />
        </div>

        <div className="mb-2 flex min-w-0 items-center gap-2 text-[13px]">
          <Select value={mode} onValueChange={(v) => setMode(v as RasterMode)}>
            <SelectTrigger size="sm" className="w-[132px] shrink-0 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="map">
                <span className="text-[12px]">map colours</span>
              </SelectItem>
              <SelectItem value="invert">
                <span className="text-[12px]">invert lightness</span>
              </SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[12px] text-[var(--color-fg-mute)]">strength</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            className="min-w-0 flex-1 accent-[var(--color-brand)]"
          />
          <span className="w-8 tabular-nums text-[12px] text-[var(--color-fg-mute)]">
            {Math.round(strength * 100)}%
          </span>
        </div>

        {mode === 'map' && !isMappable(palette) && (
          <p className="mb-2 rounded-md bg-[var(--color-hover)] px-2 py-1.5 text-[11px] text-[var(--color-fg-dim)]">
            More than {MAPPABLE_COLOR_LIMIT} colours — a photo or a complex gradient. Mapping
            them by name is meaningless here; invert the lightness or drop in a replacement.
          </p>
        )}

        {mode === 'map' &&
          palette.map((c) => (
            <div key={c.hex} className="mb-1 flex items-center gap-2">
              <Swatch hex={c.hex} size={22} />
              <span className="w-[58px] shrink-0 font-mono text-[11px] tabular-nums">{c.hex}</span>
              <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-[var(--color-fg-mute)]">
                {(c.share * 100).toFixed(0)}%
              </span>
              <ArrowRight className="size-3 shrink-0 text-[var(--color-fg-mute)]" />
              <ColorField
                value={mapping[c.hex] ?? c.hex}
                onCommit={(hex) => setMapping({ ...mapping, [c.hex]: hex })}
                size={22}
              />
              <button
                onClick={() => {
                  const next = { ...mapping };
                  delete next[c.hex];
                  setMapping(next);
                }}
                aria-label="put this colour back"
                className={`grid size-6 shrink-0 place-content-center rounded-md text-[var(--color-fg-mute)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] ${
                  mapping[c.hex] ? '' : 'invisible'
                }`}
              >
                <Undo2 className="size-3.5" />
              </button>
            </div>
          ))}

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            disabled={!result || !asset}
            onClick={() => result && asset && replaceAsset(asset.index, encodePng(result))}
          >
            <Check />
            apply to asset
          </Button>
          <Button size="sm" variant="outline" onClick={() => picker.current?.click()}>
            <Upload />
            replace file
          </Button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !asset) return;
              const url = URL.createObjectURL(file);
              try {
                const { pixels, width, height } = await decodeImage(url);
                if (width !== asset.w || height !== asset.h) {
                  setError(`replacement is ${width}×${height}, asset is ${asset.w}×${asset.h}`);
                }
                // The edit becomes the asset's new source, so the effect above re-reads it
                // and both previews follow. Nothing to set by hand here.
                replaceAsset(asset.index, encodePng(pixels), { w: width, h: height });
              } finally {
                URL.revokeObjectURL(url);
              }
            }}
          />
          {edits.images?.[asset?.index ?? -1] && (
            <span className="self-center text-[12px] text-[var(--color-brand)]">applied</span>
          )}
        </div>
      </div>
    </div>
  );
}

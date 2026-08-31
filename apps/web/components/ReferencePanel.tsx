'use client';

import { useEffect, useRef, useState } from 'react';
import { extractPalette, matchPalettes, samplePoint, type DominantColor, type MatchedPair } from '@lottie-theme/core';
import { decodeImage, type Pixels } from '@/lib/raster';
import { useEditor } from '@/lib/store';
import { AlertCircle, ArrowRight, ImagePlus, Pipette, Target, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Swatch } from './Swatch';

/**
 * Sample a reference screenshot.
 *
 * This is the eyedropper step done by hand in the original workflow: take a screenshot of
 * the page the animation has to sit on, pull the colours out of it, and map the animation
 * onto them. Doing it by eye is slow and inconsistent; doing it here takes one drop.
 */
export function ReferencePanel() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [palette, setPalette] = useState<DominantColor[]>([]);
  const [count, setCount] = useState(6);
  const [picked, setPicked] = useState<string | null>(null);
  const [pairs, setPairs] = useState<MatchedPair[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const documentPalette = useEditor((s) => s.palette);
  const applyEdits = useEditor((s) => s.applyEdits);
  const setColor = useEditor((s) => s.setColor);
  const setHighlight = useEditor((s) => s.setHighlight);

  useEffect(() => {
    if (!pixels) return;
    setPalette(extractPalette(pixels, count));
    setPairs(null);
  }, [pixels, count]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !pixels) return;
    el.width = pixels.width;
    el.height = pixels.height;
    el.getContext('2d')?.putImageData(pixels as ImageData, 0, 0);
  }, [pixels]);

  const load = async (file: File) => {
    setError(null);
    const url = URL.createObjectURL(file);
    try {
      setPixels((await decodeImage(url)).pixels);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read that image');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /** The pairs "apply all" is willing to apply without being looked at first. */
  const confident = (pairs ?? []).filter((p) => !p.weak);

  const propose = () => {
    if (!palette.length) return;
    setPairs(
      matchPalettes(
        documentPalette.map((p) => ({ hex: p.hex, weight: p.count })),
        palette,
      ),
    );
  };

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void load(file);
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="flex-1 text-[12px] text-[var(--color-fg-dim)]">
          {pixels ? `${palette.length} colours found` : 'no image yet'}
        </span>
        <Button size="xs" variant="secondary" onClick={() => picker.current?.click()}>
          <ImagePlus />
          {pixels ? 'replace' : 'choose image'}
        </Button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
          }}
        />
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {error && (
          <p className="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--color-destructive)]">
            <AlertCircle className="size-3.5 shrink-0" />
            {error}
          </p>
        )}

        {!pixels && (
          <div className="rounded-lg border border-dashed border-[var(--color-line)] px-3 py-6 text-center">
            <Target className="mx-auto mb-2 size-5 text-[var(--color-fg-mute)]" />
            <p className="text-[11px] leading-snug text-[var(--color-fg-mute)]">
              Drop a screenshot of the page this animation has to sit on. Its colours become the
              targets — click the image to pick one, or map the whole palette at once.
            </p>
          </div>
        )}

        {pixels && (
          <>
            <canvas
              ref={canvas}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const x = Math.round(((e.clientX - box.left) / box.width) * pixels.width);
                const y = Math.round(((e.clientY - box.top) / box.height) * pixels.height);
                setPicked(samplePoint(pixels, x, y));
              }}
              className="mb-2 w-full cursor-crosshair rounded-lg border border-[var(--color-line)]"
            />

            {picked && (
              <div className="row mb-2">
                <Swatch hex={picked} size={26} className="rounded-md" />
                <span className="flex-1 font-mono text-[12px] tabular-nums">{picked}</span>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    const target = useEditor.getState().selectedKey;
                    if (target) useEditor.getState().setPropertyColor(target, picked);
                  }}
                  disabled={!useEditor.getState().selectedKey}
                  title="apply to the colour selected on the canvas"
                >
                  <Pipette />
                  use for selection
                </Button>
              </div>
            )}

            <div className="mb-2 flex items-center gap-2 text-[13px]">
              <span className="text-[12px] text-[var(--color-fg-mute)]">colours</span>
              <input
                type="range"
                min={2}
                max={16}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="min-w-0 flex-1 accent-[var(--color-brand)]"
              />
              <span className="w-5 tabular-nums text-[12px] text-[var(--color-fg-mute)]">{count}</span>
            </div>

            <div className="mb-2 flex flex-wrap gap-1">
              {palette.map((c) => (
                <button
                  key={c.hex}
                  data-testid="reference-swatch"
                  onClick={() => setPicked(c.hex)}
                  title={`${c.hex} · ${(c.share * 100).toFixed(0)}%`}
                  className="h-8 rounded-md ring-1 ring-white/10 ring-inset"
                  style={{ background: c.hex, width: `${Math.max(10, c.share * 100)}%` }}
                />
              ))}
            </div>

            <Button size="sm" className="mb-2 w-full" onClick={propose} disabled={!palette.length}>
              <Wand2 />
              propose a mapping
            </Button>

            {pairs?.map((pair) => (
              <div
                key={pair.from}
                onMouseEnter={() => setHighlight(pair.from)}
                onMouseLeave={() => setHighlight(null)}
                className={cn('row mb-1', pair.weak && 'opacity-55')}
                title={pair.weak ? 'the reference has nothing like this colour — look before applying' : undefined}
              >
                <Swatch hex={pair.from} size={22} />
                <ArrowRight className="size-3 shrink-0 text-[var(--color-fg-mute)]" />
                <Swatch hex={pair.to} size={22} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-fg-dim)]">
                  {pair.to}
                </span>
                <span className="text-[12px] tabular-nums text-[var(--color-fg-mute)]" title="match confidence">
                  {Math.round(pair.confidence * 100)}%
                </span>
                <Button size="xs" variant="secondary" onClick={() => setColor(pair.from, pair.to)}>
                  apply
                </Button>
              </div>
            ))}

            {/* "Apply all" applies the ones worth applying. A weak pair is a colour the
                reference had no answer for, and sweeping those in with the rest is how
                three accents became black in one click — they stay for you to decide. */}
            {confident.length > 0 && (
              <Button
                size="sm"
                onClick={() =>
                  applyEdits('reference mapping', {
                    version: 1,
                    byHex: Object.fromEntries(confident.map((p) => [p.from, p.to])),
                  })
                }
                className="mt-1 w-full"
              >
                apply {confident.length} of {pairs!.length}
              </Button>
            )}

            {pairs && confident.length < pairs.length && (
              <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-fg-mute)]">
                {pairs.length - confident.length} faded above had no close match in the
                image. Apply them one at a time if you want them.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

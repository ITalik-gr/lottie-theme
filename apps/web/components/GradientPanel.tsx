'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Blend, MoveHorizontal, PaintBucket } from 'lucide-react';
import { applyEdits, listGradients, type GradientRamp } from '@lottie-theme/core';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlphaRamp } from './AlphaRamp';
import { ColorField } from './ColorField';
import { useEditor } from '@/lib/store';
import { cn } from '@/lib/utils';

const CHECKER = 'repeating-conic-gradient(#3a3d47 0% 25%, #23252c 0% 50%) 0 0 / 8px 8px';

/** Alpha of the ramp at a position, so the preview shows a gradient as it will render
 *  rather than as a row of opaque swatches. */
function alphaAt(ramp: GradientRamp, position: number): number {
  const stops = ramp.alpha;
  if (!stops.length) return 1;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (position <= first.position) return first.alpha;
  if (position >= last.position) return last.alpha;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (position <= b.position) {
      const span = b.position - a.position;
      return span === 0 ? b.alpha : a.alpha + (b.alpha - a.alpha) * ((position - a.position) / span);
    }
  }
  return last.alpha;
}

/** The ramp as a CSS gradient — colour and alpha together, which is the whole point:
 *  a stop at alpha 0 is a mask fading into the page, not a colour anybody chose. */
function rampCss(ramp: GradientRamp): string {
  const stops = ramp.stops
    .map((s) => {
      const a = Math.round(alphaAt(ramp, s.position) * 255).toString(16).padStart(2, '0');
      return `${s.hex}${a} ${(s.position * 100).toFixed(2)}%`;
    })
    .join(', ');
  return `linear-gradient(to right, ${stops})`;
}

function RampPreview({ ramp, className }: { ramp: GradientRamp; className?: string }) {
  return (
    <span className={cn('block overflow-hidden rounded', className)} style={{ background: CHECKER }}>
      <span className="block h-full w-full" style={{ backgroundImage: rampCss(ramp) }} />
    </span>
  );
}

/** The stops of one gradient, on the ramp they belong to. */
function RampEditor({ ramp }: { ramp: GradientRamp }) {
  const setSlotColor = useEditor((s) => s.setSlotColor);
  const setStopPositions = useEditor((s) => s.setStopPositions);
  const setAlphaStops = useEditor((s) => s.setAlphaStops);
  const applyStep = useEditor((s) => s.applyEdits);
  const background = useEditor((s) => s.background);
  const setHighlightKey = useEditor((s) => s.setHighlightKey);
  const properties = useEditor((s) => s.properties);
  const slots = useEditor((s) => s.slots);

  const track = useRef<HTMLDivElement>(null);
  // The stop is remembered by its slot, not by its place in the ramp: moving a stop
  // re-sorts the list, and an index would quietly start pointing at its neighbour.
  const [pickedSlot, setPickedSlot] = useState<number | null>(null);
  /** Which stop is being dragged, in a ref rather than in state: a drag is a stream of
   *  events between two renders, and a state update read one event later has already
   *  missed the first move. */
  const dragging = useRef<number | null>(null);
  /** What is being typed into the position field, before it is a number worth applying. */
  const [draft, setDraft] = useState<string | null>(null);

  const picked = Math.max(0, ramp.stops.findIndex((s) => s.slot === pickedSlot));
  const stop = ramp.stops[picked];

  /** The property a stop belongs to, so hovering it lights up on the canvas. */
  const keyOf = (slotIndex: number) => {
    const renderKey = slots[slotIndex]?.renderKey;
    return properties.find((p) => p.key === renderKey)?.key ?? null;
  };

  const moveRef = useRef<(index: number, position: number) => void>(() => {});

  const move = (index: number, position: number) => {
    // A stop cannot cross its neighbours: the ramp is read in order, and swapping two
    // stops would swap which slot a colour edit lands on.
    const lower = index > 0 ? ramp.stops[index - 1]!.position : 0;
    const upper = index < ramp.stops.length - 1 ? ramp.stops[index + 1]!.position : 1;
    if (!Number.isFinite(position)) return;
    const next = ramp.stops.map((s, i) =>
      i === index ? Math.min(upper, Math.max(lower, position)) : s.position,
    );
    setStopPositions(ramp.path, next);
  };

  moveRef.current = move;

  // Dragging is followed on the window, not on the track: let go of the pointer a little
  // outside the strip — which is what happens when you drag a stop to either end — and a
  // handler bound to the track never sees the last move or the release.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragging.current === null) return;
      const box = track.current?.getBoundingClientRect();
      if (!box) return;
      moveRef.current(dragging.current, Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)));
    };
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const evenly = () =>
    setStopPositions(
      ramp.path,
      ramp.stops.map((_, i) => (ramp.stops.length === 1 ? 0 : i / (ramp.stops.length - 1))),
    );

  /** Reverse the colours along the ramp, leaving the stops where they are — the usual
   *  fix when a converted gradient runs the wrong way round on a light page. */
  const reverse = () =>
    applyStep('reverse gradient', {
      version: 1,
      byIndex: Object.fromEntries(
        ramp.stops.map((s, i) => [s.slot, ramp.stops[ramp.stops.length - 1 - i]!.hex]),
      ),
    });

  const transparentStops = ramp.stops.filter((s) => alphaAt(ramp, s.position) <= 0.02);

  return (
    <div className="space-y-2.5">
      {/* The ramp itself, with a handle per colour stop. */}
      <div ref={track} className="relative h-10 w-full rounded-md" style={{ background: CHECKER }}>
        <div
          className="absolute inset-0 rounded-md"
          style={{ backgroundImage: rampCss(ramp) }}
        />
        {ramp.stops.map((s, i) => (
          <button
            key={s.slot}
            onPointerDown={() => {
              setPickedSlot(s.slot);
              setDraft(null);
              dragging.current = i;
            }}
            onClick={() => setPickedSlot(s.slot)}
            onMouseEnter={() => setHighlightKey(keyOf(s.slot))}
            onMouseLeave={() => setHighlightKey(null)}
            title={`${s.hex} at ${(s.position * 100).toFixed(0)}% — drag to move`}
            aria-label={`gradient stop ${i + 1}`}
            className={cn(
              'absolute top-0 h-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm border-2 transition-colors',
              i === picked ? 'border-[var(--color-brand-bright)]' : 'border-white/70',
            )}
            style={{ left: `${s.position * 100}%`, background: s.hex }}
          />
        ))}
      </div>

      {stop && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-fg-mute)]">
            stop {picked + 1}/{ramp.stops.length}
          </span>
          <ColorField value={stop.hex} onCommit={(hex) => setSlotColor(stop.slot, hex)} size={24} />
          <input
            type="number"
            min={0}
            max={100}
            value={draft ?? Math.round(stop.position * 100)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              // Applied when the typing stops, not per keystroke: "45" passes through "4",
              // and a ramp that jumps to 4% under the pointer is unusable.
              const value = Number(draft);
              if (draft !== null && draft !== '' && Number.isFinite(value)) move(picked, value / 100);
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setDraft(null);
            }}
            aria-label="stop position"
            className="w-14 rounded-md border border-[var(--color-line)] bg-transparent px-1.5 py-1 text-[12px] tabular-nums outline-none focus:border-[var(--color-brand)]"
          />
          <span className="text-[11px] text-[var(--color-fg-mute)]">%</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="ghost" onClick={evenly}>
          <MoveHorizontal />
          space evenly
        </Button>
        <Button size="xs" variant="ghost" onClick={reverse}>
          <ArrowLeftRight />
          reverse
        </Button>
        {transparentStops.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  applyStep('fading stops take the canvas colour', {
                    version: 1,
                    byIndex: Object.fromEntries(transparentStops.map((s) => [s.slot, background])),
                  })
                }
              >
                <PaintBucket />
                fade → canvas
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="block max-w-[220px]">
                {transparentStops.length} stop{transparentStops.length === 1 ? '' : 's'} here fade to
                nothing. A fading stop has to take the colour of the page behind it, or it shows as a
                halo — this sets {background}.
              </span>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {ramp.alpha.length > 0 && stop && (
        <div>
          <p className="mb-1 text-[10px] tracking-wide text-[var(--color-fg-mute)] uppercase">
            Alpha along the same ramp
          </p>
          <AlphaRamp
            stops={ramp.alpha}
            colorHex={stop.hex}
            onChange={(stops) => setAlphaStops(ramp.path, stops)}
          />
        </div>
      )}
    </div>
  );
}

export function GradientPanel() {
  const original = useEditor((s) => s.original);
  const edits = useEditor((s) => s.edits);
  const slots = useEditor((s) => s.slots);
  const selectedRamp = useEditor((s) => s.selectedRamp);
  const selectRamp = useEditor((s) => s.selectRamp);

  // Read from the *edited* document: a gradient panel that shows the colours as they
  // were shipped is a panel you cannot work in.
  const ramps = useMemo(() => {
    if (!original) return [];
    return listGradients(applyEdits(original, edits).doc, slots);
  }, [original, edits, slots]);

  if (!ramps.length) {
    return (
      <p className="p-3 text-[12px] text-[var(--color-fg-mute)]">
        No gradients in this file.
      </p>
    );
  }

  const active = ramps.find((r) => r.path === selectedRamp) ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {active ? (
          <div className="space-y-2.5">
            <button
              onClick={() => selectRamp(null)}
              className="text-[11px] text-[var(--color-fg-mute)] hover:text-[var(--color-fg)]"
            >
              ← all {ramps.length} gradients
            </button>
            <p className="text-[12px] text-[var(--color-fg)]">
              {active.layer ?? 'unnamed layer'}
              <span className="text-[var(--color-fg-mute)]">
                {' · '}
                {active.type} {active.kind === 'gradient-stroke' ? 'stroke' : 'fill'}
                {active.keyframe !== null ? ` · keyframe ${active.keyframe}` : ''}
              </span>
            </p>
            <RampEditor ramp={active} />
          </div>
        ) : (
          <div className="space-y-1">
            <p className="px-1 pb-1 text-[11px] leading-snug text-[var(--color-fg-mute)]">
              Every gradient in the file. Open one to move its stops, recolour them, and see the
              alpha ramp that decides whether it is a shape or a fade.
            </p>
            {ramps.map((ramp) => (
              <button
                key={ramp.path}
                data-testid="gradient-row"
                onClick={() => selectRamp(ramp.path)}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-[var(--color-hover)]"
              >
                <RampPreview ramp={ramp} className="h-7 w-16 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">{ramp.layer ?? 'unnamed layer'}</span>
                  <span className="block text-[10px] text-[var(--color-fg-mute)]">
                    {ramp.type} {ramp.kind === 'gradient-stroke' ? 'stroke' : 'fill'} · {ramp.stops.length} stops
                    {ramp.alpha.some((a) => a.alpha <= 0.02) ? ' · fades out' : ''}
                  </span>
                </span>
                <Blend className="size-3.5 shrink-0 text-[var(--color-fg-mute)]" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

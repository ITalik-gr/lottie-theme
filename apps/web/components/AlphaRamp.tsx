'use client';

import { useCallback, useRef, useState } from 'react';
import { alphaAt, fadesToTransparent, type AlphaStop } from '@lottie-theme/core';

const CHECKER = 'repeating-conic-gradient(#3a3d47 0% 25%, #23252c 0% 50%) 0 0 / 8px 8px';

/**
 * Direct editor for a gradient's alpha ramp.
 *
 * These stops decide whether a gradient is a solid shape or a mask fading into whatever
 * sits behind it, and no other tool shows them at all — which is why a recoloured
 * gradient so often looks wrong for reasons nobody can point at. Drag a stop sideways
 * to move it, up and down to change its alpha.
 */
export function AlphaRamp({
  stops,
  colorHex,
  onChange,
}: {
  stops: AlphaStop[];
  /** The gradient's own colour, so the preview shows the real thing, not a grey bar. */
  colorHex: string;
  onChange: (stops: AlphaStop[]) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);

  const sorted = [...stops].sort((a, b) => a.position - b.position);

  const positionFrom = useCallback((clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width));
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging === null) return;
    const box = track.current?.getBoundingClientRect();
    if (!box) return;
    const next = sorted.map((s, i) =>
      i === dragging
        ? {
            position: positionFrom(e.clientX),
            // dragging up raises alpha; the track is only 40px tall so this stays coarse
            alpha: Math.max(0, Math.min(1, 1 - (e.clientY - box.top) / box.height)),
          }
        : s,
    );
    onChange(next);
  };

  const addStop = (e: React.MouseEvent) => {
    if (e.target !== track.current) return;
    const position = positionFrom(e.clientX);
    onChange([...sorted, { position, alpha: alphaAt(sorted, position) }]);
  };

  const removeStop = (index: number) => {
    if (sorted.length <= 2) return; // a ramp needs at least two ends
    onChange(sorted.filter((_, i) => i !== index));
    setSelected(0);
  };

  const gradientCss = sorted
    .map((s) => `${colorHex}${Math.round(s.alpha * 255).toString(16).padStart(2, '0')} ${(s.position * 100).toFixed(2)}%`)
    .join(', ');

  const current = sorted[selected];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] text-[var(--color-fg-dim)]">
        <span>alpha ramp · {sorted.length} stops</span>
        {fadesToTransparent(sorted) && (
          <span className="text-amber-400" title="this gradient fades into whatever is behind it">
            fades to transparent
          </span>
        )}
      </div>

      <div
        ref={track}
        onMouseDown={addStop}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
        title="click to add a stop · drag sideways to move, up and down for alpha"
        className="relative h-10 cursor-crosshair rounded-md border border-[var(--color-line)]"
        style={{ background: `linear-gradient(90deg, ${gradientCss}), ${CHECKER}` }}
      >
        {sorted.map((stop, i) => (
          <button
            key={i}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDragging(i);
              setSelected(i);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              removeStop(i);
            }}
            title={`${(stop.position * 100).toFixed(0)}% · alpha ${stop.alpha.toFixed(2)} · double-click to remove`}
            className={`absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 ${
              i === selected ? 'border-white bg-[var(--color-brand)]' : 'border-white/70 bg-[var(--color-ink-1)]'
            }`}
            style={{ left: `${stop.position * 100}%`, top: `${(1 - stop.alpha) * 100}%` }}
          />
        ))}
      </div>

      {current && (
        <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[var(--color-fg-dim)]">
          <span className="tabular-nums">
            stop {selected + 1}: {(current.position * 100).toFixed(0)}%
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={current.alpha}
            onChange={(e) =>
              onChange(sorted.map((s, i) => (i === selected ? { ...s, alpha: Number(e.target.value) } : s)))
            }
            className="flex-1 accent-[var(--color-brand)]"
          />
          <span className="w-8 text-right tabular-nums">{current.alpha.toFixed(2)}</span>
          <button
            onClick={() => removeStop(selected)}
            disabled={sorted.length <= 2}
            className="rounded border border-[var(--color-line)] px-1 disabled:opacity-30"
            title="remove this stop"
          >
            −
          </button>
        </div>
      )}
    </div>
  );
}

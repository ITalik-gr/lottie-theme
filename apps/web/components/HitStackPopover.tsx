'use client';

import { useEffect, useRef } from 'react';
import { Layers, Scissors, Square } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Swatch } from './Swatch';
import { describeTarget } from '@/lib/describe';
import type { Hit } from '@/lib/hittest';
import { useEditor } from '@/lib/store';
import { cn } from '@/lib/utils';

const layerOf = (slot: { layerTrail: { hasMask: boolean; matte: string }[] } | undefined) =>
  slot?.layerTrail[slot.layerTrail.length - 1];

const KIND_LABEL: Record<string, string> = {
  fill: 'fill',
  stroke: 'stroke',
  'gradient-fill': 'gradient',
  'gradient-stroke': 'gradient stroke',
  'solid-layer': 'solid layer',
  'text-fill': 'text',
  'text-stroke': 'text stroke',
};

/**
 * Everything under the pointer, in one list.
 *
 * The alternative — one hit and a modifier key to "go deeper" — asks the user to guess
 * how many layers are stacked there. Showing the stack removes the guessing entirely.
 */
export function HitStackPopover({
  hits,
  cursor,
  x,
  y,
  onPick,
  onClose,
}: {
  hits: Hit[];
  /** Where repeated clicks have walked to in the stack. */
  cursor: number;
  x: number;
  y: number;
  onPick: (hit: Hit) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const setHighlightKey = useEditor((s) => s.setHighlightKey);
  useEffect(() => () => setHighlightKey(null), [setHighlightKey]);
  const slots = useEditor((s) => s.slots);
  const includeTransparent = useEditor((s) => s.includeTransparent);
  const toggleTransparent = useEditor((s) => s.toggleIncludeTransparent);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // React commits this popover during the very `pointerdown` that opened it, so the
    // matching `mousedown` still arrives and would close it immediately. Clicks on the
    // canvas are ignored anyway — they open a fresh stack of their own.
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (box.current?.contains(target as Node)) return;
      if (target?.closest?.('[data-canvas-host]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      data-testid="hit-stack"
      className="fixed z-50 w-[320px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] shadow-2xl shadow-black/70"
      style={{ left: Math.min(x + 12, window.innerWidth - 340), top: Math.min(y + 12, window.innerHeight - 300) }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <Layers className="size-3.5 text-[var(--color-fg-mute)]" />
        <span className="panel-title flex-1">
          {cursor + 1} / {hits.length} under pointer
        </span>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-fg-dim)]"
          title="also list masks, hit-boxes and all-but-invisible gradients"
        >
          <Checkbox checked={includeTransparent} onCheckedChange={toggleTransparent} className="size-3.5" />
          incl. transparent
        </label>
      </div>

      <div className="max-h-[280px] overflow-y-auto p-1">
        {hits.map((hit) => {
          const slot = slots[hit.property.slots[0] ?? -1];
          const name = slot ? describeTarget(slot) : 'unnamed';
          const at = layerOf(slot);
          const alpha = hit.effectiveAlpha;
          return (
            <button
              key={`${hit.depth}-${hit.property.key}`}
              onMouseEnter={() => setHighlightKey(hit.property.key)}
              onMouseLeave={() => setHighlightKey(null)}
              onClick={() => onPick(hit)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                hit.depth === cursor
                  ? 'bg-[var(--color-brand)]/15 ring-1 ring-[var(--color-brand)]/40 ring-inset'
                  : 'hover:bg-[var(--color-hover)]',
              )}
            >
              {/* Depth is what repeated clicks walk through, so it is numbered like a stack. */}
              <span
                className={cn(
                  'grid size-5 shrink-0 place-content-center rounded-md text-[10px] tabular-nums',
                  hit.depth === cursor
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'bg-[var(--color-line-soft)] text-[var(--color-fg-mute)]',
                )}
              >
                {hit.depth + 1}
              </span>
              {/* Drawn at its real opacity: a stroke at 10% is a different thing from a solid one. */}
              <Swatch hex={hit.property.hex} alpha={alpha} size={20} className="rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{name}</span>
                <span className="flex items-center gap-1 truncate text-[11px] text-[var(--color-fg-mute)]">
                  {at?.hasMask && <Scissors className="size-2.5 shrink-0" />}
                  {at?.matte !== 'none' && at?.matte && <Square className="size-2.5 shrink-0" />}
                  {KIND_LABEL[hit.property.kind] ?? hit.property.kind}
                  {hit.property.stop !== undefined ? ` · stop ${hit.property.stop}` : ''}
                  {hit.property.shared ? ` · ×${hit.property.occurrences}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[11px] tabular-nums text-[var(--color-fg-dim)]">
                  {hit.property.hex}
                </span>
                {alpha < 0.999 && (
                  <span className="block text-[10px] tabular-nums text-[var(--color-fg-mute)]">
                    {Math.round(alpha * 100)}% opaque
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <p className="border-t border-[var(--color-line)] px-3 py-1.5 text-[11px] text-[var(--color-fg-mute)]">
        Click again to step down · hold to walk · alt-click for the bottom
      </p>
    </div>
  );
}

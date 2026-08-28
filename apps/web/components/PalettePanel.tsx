'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Undo2 } from 'lucide-react';
import { clusterPalette } from '@lottie-theme/core';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ColorField } from './ColorField';
import { Swatch } from './Swatch';
import { mappedHex, propertyHex, useEditor } from '@/lib/store';
import { cn } from '@/lib/utils';

export function PalettePanel() {
  const palette = useEditor((s) => s.palette);
  const properties = useEditor((s) => s.properties);
  const edits = useEditor((s) => s.edits);
  const setColor = useEditor((s) => s.setColor);
  const setFilterHex = useEditor((s) => s.setFilterHex);
  const filterHex = useEditor((s) => s.filterHex);
  const highlightHex = useEditor((s) => s.highlightHex);
  const setHighlight = useEditor((s) => s.setHighlight);
  const [grouped, setGrouped] = useState(false);

  // Exports routinely split one intended colour into `#17181D` / `#17181E`.
  // Grouping recolours them together instead of leaving a visible seam.
  const rows = useMemo(() => {
    if (!grouped) return palette.map((e) => ({ ...e, aliases: [] as string[] }));
    return clusterPalette(palette).map((c) => ({
      ...c.representative,
      count: c.count,
      aliases: c.members.slice(1).map((m) => m.hex),
    }));
  }, [palette, grouped]);

  if (!palette.length) {
    return <p className="p-3 text-[12px] text-[var(--color-fg-mute)]">No colours yet.</p>;
  }

  const changed = rows.filter((r) => mappedHex(edits, r.hex) !== r.hex).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-[12px] text-[var(--color-fg-dim)]">
          {palette.length} colours
          {changed > 0 && <span className="text-[var(--color-brand-bright)]"> · {changed} changed</span>}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-fg-dim)]">
              <Checkbox checked={grouped} onCheckedChange={(v) => setGrouped(v === true)} className="size-3.5" />
              group near-identical
            </label>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="block max-w-[210px]">
              Exports split one intended colour into #17181D and #17181E. Grouped, they recolour
              together instead of leaving a seam.
            </span>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {rows.map((row) => {
          const target = mappedHex(edits, row.hex);
          const isChanged = target !== row.hex;
          // Elements that started at this colour and were then recoloured one at a time.
          // They no longer follow this row, and saying so is the difference between a
          // count that is wrong and a count that explains itself.
          const moved = properties.filter(
            (p) => p.hex === row.hex && propertyHex(edits, p) !== target,
          ).length;
          const commit = (hex: string) => {
            setColor(row.hex, hex);
            for (const alias of row.aliases) setColor(alias, hex);
          };
          return (
            <div
              key={row.hex}
              data-testid="palette-row"
              onMouseEnter={() => setHighlight(row.hex)}
              onMouseLeave={() => setHighlight(null)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5 transition-colors',
                highlightHex === row.hex
                  ? 'border-[var(--color-brand)] bg-[var(--color-hover)]'
                  : 'border-transparent',
                filterHex === row.hex && 'bg-[var(--color-brand)]/10',
                isChanged && 'bg-[var(--color-panel)]',
              )}
            >
              <button
                onClick={() => setFilterHex(filterHex === row.hex ? null : row.hex)}
                title="show only the layers using this colour"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Swatch hex={row.hex} size={26} className="rounded-md" />
                <span className="min-w-0">
                  <span className="block font-mono text-[12px] tabular-nums">{row.hex}</span>
                  <span className="block truncate text-[10px] text-[var(--color-fg-mute)]">
                    {row.count}×{row.aliases.length ? ` +${row.aliases.length}` : ''} · {row.kinds.join(', ')}
                    {moved > 0 && (
                      <span className="text-[var(--color-fg-dim)]"> · {moved} set on its own</span>
                    )}
                  </span>
                </span>
              </button>
              <ArrowRight className="size-3 shrink-0 text-[var(--color-fg-mute)]" />
              <ColorField value={target} onCommit={commit} size={24} />
              <button
                onClick={() => commit(row.hex)}
                title="put this colour back"
                className={cn(
                  'grid size-6 shrink-0 place-content-center rounded-md text-[var(--color-fg-mute)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]',
                  !isChanged && 'invisible',
                )}
              >
                <Undo2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

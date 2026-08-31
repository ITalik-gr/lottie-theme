'use client';

import { AlertCircle, ArrowUpRight, FileJson, Radio } from 'lucide-react';
import { Canvas } from '@/components/Canvas';
import { FileTree } from '@/components/FileTree';
import { LayerTree } from '@/components/LayerTree';
import { RightPanel } from '@/components/RightPanel';
import { Toolbar } from '@/components/Toolbar';
import { useLottieDrop } from '@/lib/drop';
import { useUnloadGuard } from '@/lib/guard';
import { useResizablePanel } from '@/lib/resizable';
import { useEditor } from '@/lib/store';
import { useSync } from '@/lib/sync';
import { cn } from '@/lib/utils';

export default function EditorPage() {
  const currentId = useEditor((s) => s.currentId);
  const original = useEditor((s) => s.original) as { w?: number; h?: number; fr?: number } | null;
  const slots = useEditor((s) => s.slots);
  const properties = useEditor((s) => s.properties);
  // Mounted here rather than in the panel so an agent's edit arrives whether or not the
  // sync section happens to be the one on screen. Outside `next dev` this connects to nothing.
  const sync = useSync();
  // A drop anywhere over the canvas column, not only over the file tree. The middle of the
  // screen is where the animation is, so it is where a file gets dragged.
  const drop = useLottieDrop();
  // The right panel holds the two things that need room — the agent's conversation and the
  // reference mapping — so it is the one worth dragging wider. The bounds keep both ends
  // usable: narrower and the palette rows wrap, wider and the canvas is the one squeezed.
  const rail = useResizablePanel({
    storageKey: 'lottie-theme:right-panel',
    initial: 356,
    min: 280,
    max: 720,
  });
  useUnloadGuard();

  return (
    // The three columns are not equally compressible: the canvas is what the work is
    // looked at on, so the left panel gives up width first on a smaller laptop screen. The
    // right one is whatever the user dragged it to.
    <div
      className="grid h-screen grid-cols-[216px_1fr_var(--rail)] bg-[var(--color-background)] xl:grid-cols-[260px_1fr_var(--rail)] 2xl:grid-cols-[300px_1fr_var(--rail)]"
      style={{ '--rail': `${rail.width}px` } as React.CSSProperties}
    >
      <aside className="grid min-h-0 min-w-0 grid-rows-[minmax(140px,34%)_1fr] overflow-hidden border-r border-[var(--color-line)] bg-[var(--color-panel)]">
        <div className="min-h-0 min-w-0 border-b border-[var(--color-line)]">
          <FileTree />
        </div>
        <div className="min-h-0 min-w-0">
          <LayerTree />
        </div>
      </aside>

      <main className="relative flex min-h-0 min-w-0 flex-col" {...drop.handlers}>
        <Toolbar />
        <div className="min-h-0 flex-1">
          <Canvas />
        </div>

        {drop.dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--color-brand)] bg-[var(--color-background)]/80 text-[var(--color-brand-bright)] backdrop-blur-sm">
            <FileJson className="size-7" />
            <span className="text-[13px]">Drop to open</span>
          </div>
        )}

        {drop.error && (
          <button
            onClick={drop.clearError}
            title="dismiss"
            className="absolute inset-x-3 bottom-11 z-20 flex items-center gap-1.5 rounded-md bg-[var(--color-destructive)]/10 px-2 py-1.5 text-left text-[12px] text-[var(--color-destructive)]"
          >
            <AlertCircle className="size-3.5 shrink-0" />
            {drop.error}
          </button>
        )}
        <footer className="flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t border-[var(--color-line)] px-3 text-[11px] text-[var(--color-fg-mute)]">
          {currentId ? (
            <>
              <span className="min-w-0 truncate text-[var(--color-fg-dim)]" title={currentId}>
                {currentId}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {original?.w}×{original?.h} · {original?.fr}fps
              </span>
              <span className="hidden whitespace-nowrap tabular-nums xl:inline">
                {properties.length} colours in {slots.length} slots
              </span>
            </>
          ) : (
            <span>no file open</span>
          )}
          {sync.connected && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[var(--color-ok)]">
              <Radio className="size-3" />
              agent bridge live
            </span>
          )}
          <a
            href="https://www.italik.dev/?ref=lottie-editor"
            target="_blank"
            rel="noreferrer"
            className={cn(
              'flex shrink-0 items-center gap-1 transition-colors hover:text-[var(--color-fg)]',
              !sync.connected && 'ml-auto',
            )}
          >
            italik.dev
            <ArrowUpRight className="size-3" />
          </a>
        </footer>
      </main>

      <aside className="relative min-h-0 min-w-0 overflow-hidden border-l border-[var(--color-line)] bg-[var(--color-panel)]">
        {/* The grab area is wider than the line it sits on: a 1px border is not a target,
            and the alternative is hunting for the edge. Double-click puts it back. */}
        <div
          {...rail.handle}
          role="separator"
          aria-orientation="vertical"
          aria-label="resize the panel"
          title="drag to resize · double-click to reset"
          className={cn(
            'absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize',
            'after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors',
            rail.dragging ? 'after:bg-[var(--color-brand)]' : 'hover:after:bg-[var(--color-brand)]/50',
          )}
        />
        <RightPanel />
      </aside>
    </div>
  );
}

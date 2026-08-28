'use client';

import { ArrowUpRight, Radio } from 'lucide-react';
import { Canvas } from '@/components/Canvas';
import { FileTree } from '@/components/FileTree';
import { LayerTree } from '@/components/LayerTree';
import { RightPanel } from '@/components/RightPanel';
import { Toolbar } from '@/components/Toolbar';
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

  return (
    // The three columns are not equally compressible: the canvas is what the work is
    // looked at on, so the two panels give up width first on a smaller laptop screen.
    <div className="grid h-screen grid-cols-[216px_1fr_312px] bg-[var(--color-background)] xl:grid-cols-[260px_1fr_356px] 2xl:grid-cols-[300px_1fr_396px]">
      <aside className="grid min-h-0 min-w-0 grid-rows-[minmax(140px,34%)_1fr] overflow-hidden border-r border-[var(--color-line)] bg-[var(--color-panel)]">
        <div className="min-h-0 min-w-0 border-b border-[var(--color-line)]">
          <FileTree />
        </div>
        <div className="min-h-0 min-w-0">
          <LayerTree />
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        <Toolbar />
        <div className="min-h-0 flex-1">
          <Canvas />
        </div>
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
            href="https://www.italik.dev/"
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

      <aside className="min-h-0 min-w-0 overflow-hidden border-l border-[var(--color-line)] bg-[var(--color-panel)]">
        <RightPanel />
      </aside>
    </div>
  );
}

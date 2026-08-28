'use client';

import { useMemo } from 'react';
import { Blend, Bot, Image as ImageIcon, Palette, Radio, Sparkles, Target } from 'lucide-react';
import { listImageAssets, listGradients } from '@lottie-theme/core';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PalettePanel } from './PalettePanel';
import { GradientPanel } from './GradientPanel';
import { AgentPanel } from './AgentPanel';
import { RasterPanel } from './RasterPanel';
import { ReferencePanel } from './ReferencePanel';
import { GroupsBar } from './GroupsBar';
import { SlotPanel } from './SlotPanel';
import { SuggestPanel } from './SuggestPanel';
import { SyncPanel } from './SyncPanel';
import { useEditor } from '@/lib/store';
import { syncEnabled, useSync } from '@/lib/sync';
import { cn } from '@/lib/utils';

/**
 * Sections live on a vertical rail rather than in a row of tabs.
 *
 * Six labelled tabs never fitted across a 380px panel — they wrapped, clipped, and the
 * count badge on `images` pushed the last one off the edge. A rail costs 44px of width
 * once and then holds any number of sections, which is the difference between a layout
 * that works today and one that breaks the next time a section is added.
 */
const SECTIONS = [
  { id: 'palette', label: 'Palette', hint: 'Every colour in the file, and what it maps to', icon: Palette },
  { id: 'gradients', label: 'Gradients', hint: 'Each gradient as one ramp: its stops, where they sit, and its alpha', icon: Blend },
  { id: 'theme', label: 'Theme', hint: 'Generate the opposite theme and correct it', icon: Sparkles },
  { id: 'reference', label: 'Reference', hint: 'Pick colours off a screenshot of the target design', icon: Target },
  { id: 'images', label: 'Images', hint: 'Bitmaps embedded in the animation', icon: ImageIcon },
  { id: 'agent', label: 'Agent', hint: 'Work on this file by describing what you want', icon: Bot },
  { id: 'sync', label: 'Sync', hint: 'Live bridge to an agent running in your terminal', icon: Radio },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function RightPanel() {
  const original = useEditor((s) => s.original);
  const slots = useEditor((s) => s.slots);
  const imageCount = useMemo(() => (original ? listImageAssets(original).length : 0), [original]);
  const gradientCount = useMemo(
    () => (original ? listGradients(original, slots).length : 0),
    [original, slots],
  );
  // Which section is open lives in the store: picking a gradient stop anywhere in the
  // editor offers to open the gradient itself, and that has to be able to switch this.
  const section = useEditor((s) => s.section) as SectionId;
  const setSection = useEditor((s) => s.setSection);
  const sync = useSync();

  // The images section disappears for a document with no bitmaps, gradients for one with
  // no ramps; sync exists only where a local hub can exist at all, which is never in the
  // static build.
  const available = SECTIONS.filter(
    (s) =>
      (s.id !== 'images' || imageCount > 0) &&
      (s.id !== 'gradients' || gradientCount > 0) &&
      (s.id !== 'sync' || syncEnabled),
  );
  const active = available.some((s) => s.id === section) ? section : 'palette';
  const current = available.find((s) => s.id === active)!;

  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_44px] overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--color-line)] px-3">
          <current.icon className="size-3.5 text-[var(--color-fg-mute)]" />
          <h2 className="panel-title flex-1">{current.label}</h2>
        </header>
        <GroupsBar />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {active === 'gradients' ? (
            <GradientPanel />
          ) : active === 'sync' ? (
            <SyncPanel />
          ) : active === 'agent' ? (
            <AgentPanel />
          ) : active === 'images' ? (
            <RasterPanel />
          ) : active === 'theme' ? (
            <SuggestPanel />
          ) : active === 'reference' ? (
            <ReferencePanel />
          ) : (
            <PalettePanel />
          )}
        </div>
        <SlotPanel />
      </div>

      <nav className="flex flex-col items-center gap-1 border-l border-[var(--color-line)] bg-[var(--color-panel)] py-2">
        {available.map(({ id, label, hint, icon: Icon }) => {
          const on = id === active;
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSection(id)}
                  data-section={id}
                  aria-label={label}
                  aria-pressed={on}
                  className={cn(
                    'relative grid size-9 place-content-center rounded-lg transition-colors',
                    on
                      ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand-bright)]'
                      : 'text-[var(--color-fg-mute)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]',
                  )}
                >
                  <Icon className="size-4" />
                  {id === 'gradients' && gradientCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-[var(--color-line-soft)] px-1 text-[9px] leading-4 font-medium tabular-nums text-[var(--color-fg-dim)]">
                      {gradientCount}
                    </span>
                  )}
                  {id === 'images' && imageCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-[var(--color-line-soft)] px-1 text-[9px] leading-4 font-medium tabular-nums text-[var(--color-fg-dim)]">
                      {imageCount}
                    </span>
                  )}
                  {/* A live bridge is worth knowing about from any section, not only from its own. */}
                  {id === 'sync' && sync.connected && (
                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-[var(--color-ok)]" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <span className="font-medium">{label}</span>
                <span className="block max-w-[190px] text-[11px] text-[var(--color-fg-dim)]">{hint}</span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </div>
  );
}

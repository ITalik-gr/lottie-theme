'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Blend, Braces, Copy, MousePointerClick, PaintBucket } from 'lucide-react';
import { readAlphaStops } from '@lottie-theme/core';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlphaRamp } from './AlphaRamp';
import { ColorField } from './ColorField';
import { Swatch } from './Swatch';
import { describeTarget } from '@/lib/describe';
import { mappedHex, useEditor } from '@/lib/store';

const KIND_LABEL: Record<string, string> = {
  fill: 'fill',
  stroke: 'stroke',
  'gradient-fill': 'gradient fill',
  'gradient-stroke': 'gradient stroke',
  'solid-layer': 'solid layer',
  'text-fill': 'text fill',
  'text-stroke': 'text stroke',
};

/**
 * The picked element, in full.
 *
 * The previous version showed `st · stroke · slot 17` and two unlabelled buttons, which
 * told you nothing about *what you had clicked* or what would happen next. This one says
 * which layer it belongs to, what kind of paint it is, and shows the colour going from
 * what it was to what it is now — the edit, not just the current value.
 */
export function SlotPanel() {
  const selectedKey = useEditor((s) => s.selectedKey);
  const properties = useEditor((s) => s.properties);
  const slots = useEditor((s) => s.slots);
  const original = useEditor((s) => s.original);
  const edits = useEditor((s) => s.edits);
  const setPropertyColor = useEditor((s) => s.setPropertyColor);
  const setColor = useEditor((s) => s.setColor);
  const setAlphaStops = useEditor((s) => s.setAlphaStops);
  const selectRamp = useEditor((s) => s.selectRamp);
  const [showJson, setShowJson] = useState(false);

  const property = properties.find((p) => p.key === selectedKey) ?? null;
  const slot = property ? slots[property.slots[0] ?? -1] : null;

  const rampPath = slot && property?.stop !== undefined ? slot.path.join('.') : null;
  const alphaStops = useMemo(() => {
    if (!slot || !original || !rampPath) return [];
    // an edited ramp wins over what the document says
    return edits.alpha?.[rampPath] ?? readAlphaStops(original, slot.path);
  }, [slot, original, rampPath, edits]);

  const json = useMemo(() => {
    if (!slot || !original || !showJson) return '';
    // the shape item or layer that owns the colour, not just the colour array
    const ownerPath = slot.path.slice(0, slot.encoding === 'hexString' ? -1 : -2);
    let node: unknown = original;
    for (const key of ownerPath) node = (node as Record<string, unknown>)[key as string];
    return JSON.stringify(node, null, 2).slice(0, 4000);
  }, [slot, original, showJson]);

  if (!property || !slot) {
    return (
      <div className="flex shrink-0 items-start gap-2 border-t border-[var(--color-line)] px-3 py-2.5">
        <MousePointerClick className="mt-px size-3.5 shrink-0 text-[var(--color-fg-mute)]" />
        <p className="text-[11px] leading-snug text-[var(--color-fg-mute)]">
          Click the canvas to pick a colour. Hold to step down through what is stacked there.
        </p>
      </div>
    );
  }

  const current = edits.byIndex?.[slot.index] ?? mappedHex(edits, property.hex);
  const isChanged = current !== property.hex;
  const name = describeTarget(slot);

  return (
    <div className="shrink-0 border-t border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="panel-title">Selected</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-fg)]" title={name}>
          {name}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Before → after. Which of the two is the edit is the first thing to be able to see. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex shrink-0 items-center gap-1.5">
              <Swatch hex={property.hex} size={26} className="rounded-md" />
              <ArrowRight className="size-3 text-[var(--color-fg-mute)]" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">Original colour: {property.hex}</TooltipContent>
        </Tooltip>
        <ColorField value={current} onCommit={(hex) => setPropertyColor(property.key, hex)} />
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setColor(property.hex, current)}
                aria-label={`apply to every ${property.hex}`}
              >
                <PaintBucket />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Apply this to every {property.hex} in the file</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showJson ? 'secondary' : 'ghost'}
                size="icon-sm"
                onClick={() => setShowJson(!showJson)}
                aria-label="inspect JSON"
              >
                <Braces />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Show the JSON this colour lives in</TooltipContent>
          </Tooltip>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--color-fg-mute)]">
        <span>{KIND_LABEL[property.kind] ?? property.kind}</span>
        {property.stop !== undefined && <span>· gradient stop {property.stop}</span>}
        <span>· slot {slot.index}</span>
        {isChanged && (
          <span className="rounded bg-[var(--color-brand)]/15 px-1.5 py-px text-[10px] tracking-wide text-[var(--color-brand-bright)] uppercase">
            changed
          </span>
        )}
        {property.shared && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 rounded bg-[var(--color-line-soft)] px-1.5 py-px text-[10px] text-[var(--color-fg-dim)]">
                <Copy className="size-2.5" />
                shared ×{property.occurrences}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="block max-w-[220px]">
                One JSON value drawn in {property.occurrences} places — a reused precomp or an
                animated colour. Changing it here changes all of them; it cannot be split.
              </span>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {rampPath && (
        <div className="mt-2 space-y-1.5">
          {/* One stop of a gradient means little on its own — the ramp it belongs to is
              the thing being edited, and it is one click away. */}
          <Button size="xs" variant="secondary" onClick={() => selectRamp(rampPath)}>
            <Blend />
            open this gradient
          </Button>
          {alphaStops.length > 0 && (
            <AlphaRamp stops={alphaStops} colorHex={current} onChange={(stops) => setAlphaStops(rampPath, stops)} />
          )}
        </div>
      )}

      {showJson && (
        <pre className="mt-2 max-h-[180px] overflow-auto rounded-md bg-[var(--color-background)] p-2 font-mono text-[11px] leading-tight text-[var(--color-fg-dim)]">
          {json}
        </pre>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import {
  Bookmark, Check, ChevronDown, Download, Grid2x2, Layers2, Layers3, Redo2, RotateCcw, Save,
  Trash2, Undo2, Upload,
} from 'lucide-react';
import { isEmptyEdits } from '@lottie-theme/core';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { assetId, buildDocument, downloadDotLottie, downloadJson, downloadSidecar, type MetadataMode } from '@/lib/export';
import { deletePreset, exportPresets, importPresets, loadPresets, savePreset, type Preset } from '@/lib/presets';
import { Swatch } from './Swatch';
import { BatchPanel } from './BatchPanel';
import { useEditor } from '@/lib/store';

const BACKGROUNDS: [string, string][] = [
  ['#FFFFFF', 'white'],
  ['#F6F8FF', 'off-white'],
  ['#E3E6EF', 'light grey'],
  ['#0E0F12', 'near-black'],
  ['#181818', 'charcoal'],
];

export function Toolbar() {
  const state = useEditor();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [metadata, setMetadata] = useState<MetadataMode>('embed');
  const [minify, setMinify] = useState(true);
  const [batch, setBatch] = useState(false);

  useEffect(() => setPresets(loadPresets()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      // Undo is left to the browser only while text is being typed. A focused slider or
      // colour well has no edit history of its own, and undo is exactly what you want
      // after dragging one.
      const el = document.activeElement;
      const typing =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && ['text', 'search', 'url', 'email', 'number', ''].includes(el.type));
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) state.redo();
      else state.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  if (!state.original) return null;

  const name = state.currentId?.split('/').pop() ?? 'animation.json';
  const outName = name.replace(/\.json$/, '_light');
  const colours = Object.entries(state.edits.byHex ?? {}).filter(([from, to]) => from !== to);
  const perSlot = Object.keys(state.edits.byIndex ?? {}).length;
  const dirty = !isEmptyEdits(state.edits);

  const exportDoc = () => buildDocument(state.original, state.edits, { metadata, minify });

  return (
    // Nothing here wraps: a toolbar that grows to two rows moves the canvas under the
    // pointer. Below a wide screen the labels go first, then it scrolls sideways.
    <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--color-line)] px-3 xl:gap-2">
      <Select value={state.background} onValueChange={state.setBackground}>
        <SelectTrigger size="sm" className="w-[92px] shrink-0 text-[12px] xl:w-[132px]" aria-label="canvas background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BACKGROUNDS.map(([hex, label]) => (
            <SelectItem key={hex} value={hex}>
              {/* Choosing what the animation sits on is a colour decision, so show the colour. */}
              <Swatch hex={hex} size={13} />
              <span className="text-[12px]">{label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={state.checkerboard ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={state.toggleCheckerboard}
            aria-label="checkerboard"
          >
            <Grid2x2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Checkerboard, to see what is actually transparent</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={state.showOriginal ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={state.toggleShowOriginal}
            aria-label="show original"
          >
            <Layers2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Show the original, unedited animation</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 !h-5" />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="presets" aria-label="presets" title="presets" className="shrink-0 text-[12px]">
            <Bookmark />
            <span className="hidden 2xl:inline">presets</span>
            {presets.length > 0 && (
              <span className="text-[10px] tabular-nums text-[var(--color-fg-mute)]">{presets.length}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px] p-2">
          <div className="panel-title px-1.5 pb-1.5">Apply a preset</div>
          {presets.length === 0 && (
            <p className="px-1.5 pb-1.5 text-[11px] text-[var(--color-fg-mute)]">
              Nothing saved yet. Recolour something, then save the set here.
            </p>
          )}
          {presets.map((preset) => (
            <div key={preset.name} className="group flex items-center gap-1">
              <button
                data-testid="preset"
                onClick={() => state.applyEdits(`preset \u201c${preset.name}\u201d`, preset.edits)}
                title={preset.description}
                className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-[12px] hover:bg-[var(--color-hover)]"
              >
                {preset.name}
              </button>
              {!preset.builtIn && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setPresets(deletePreset(preset.name))}
                  aria-label={`delete preset ${preset.name}`}
                  className="opacity-0 group-hover:opacity-100"
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}

          <Separator className="my-2" />

          <div className="flex flex-wrap gap-1.5">
            <Button
              size="xs"
              variant="secondary"
              disabled={!dirty}
              onClick={() => {
                const label = window.prompt('Save the current edits as a preset named:');
                if (label) setPresets(savePreset(label, state.edits));
              }}
            >
              <Save />
              save current
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => downloadSidecar(JSON.parse(exportPresets()), 'lottie-theme-presets.json')}
            >
              export
            </Button>
            <Button size="xs" variant="ghost" asChild>
              <label className="cursor-pointer">
                <Upload />
                import
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setPresets(importPresets(await file.text()));
                  }}
                />
              </label>
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className="mr-1 hidden whitespace-nowrap text-[11px] lg:inline tabular-nums text-[var(--color-fg-mute)]">
          {colours.length ? `${colours.length} colour${colours.length === 1 ? '' : 's'}` : 'no changes'}
          {perSlot ? ` · ${perSlot} slot${perSlot === 1 ? '' : 's'}` : ''}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={state.undo} disabled={!state.undoStack.length} aria-label="undo">
              <Undo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Undo · ⌘Z</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={state.redo} disabled={!state.redoStack.length} aria-label="redo">
              <Redo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Redo · ⇧⌘Z</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={state.resetEdits} disabled={!dirty} aria-label="reset">
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Drop every edit and start over</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 !h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-sm" data-testid="batch" onClick={() => setBatch(true)} aria-label="batch">
              <Layers3 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Apply these edits to every loaded file</TooltipContent>
        </Tooltip>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="export options">
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[300px] p-3">
            <div className="panel-title mb-2">Settings travel with the file</div>
            {(
              [
                ['embed', 'inside the animation (meta.themeStudio)'],
                ['sidecar', `beside it as ${outName}.theme.json`],
                ['none', 'not at all'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMetadata(value)}
                className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12px] hover:bg-[var(--color-hover)]"
              >
                <Check
                  className={`mt-px size-3.5 shrink-0 ${
                    metadata === value ? 'text-[var(--color-brand-bright)]' : 'text-transparent'
                  }`}
                />
                <span>{label}</span>
              </button>
            ))}
            <p className="mt-1.5 mb-2 text-[11px] leading-snug text-[var(--color-fg-mute)]">
              Players ignore fields they do not know, so an embedded set keeps the animation
              working while carrying its own names, groups and colour map.
            </p>

            <label className="mb-3 flex cursor-pointer items-center gap-2 text-[12px]">
              <Checkbox checked={minify} onCheckedChange={(v) => setMinify(v === true)} className="size-3.5" />
              minify
            </label>

            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" variant="secondary" onClick={() => downloadJson(exportDoc(), `${outName}.json`, minify)}>
                .json
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => downloadDotLottie([{ id: assetId(name), doc: exportDoc() }], `${outName}.lottie`, minify)}
              >
                .lottie
              </Button>
              <Button size="xs" variant="secondary" onClick={() => downloadSidecar(state.edits, `${outName}.theme.json`)}>
                theme.json
              </Button>
            </div>

          </PopoverContent>
        </Popover>

        <Button
          size="sm"
          aria-label="download"
          title={`download ${outName}.json`}
          onClick={() => downloadJson(exportDoc(), `${outName}.json`, minify)}
        >
          <Download />
          <span className="hidden 2xl:inline">Download</span>
        </Button>
      </div>

      {batch && <BatchPanel onClose={() => setBatch(false)} />}
    </div>
  );
}

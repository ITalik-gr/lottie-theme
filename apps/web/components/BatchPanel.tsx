'use client';

import { useEffect, useRef, useState } from 'react';
import lottie from 'lottie-web';
import {
  applyEdits, checkCompatibility, collectSlots, portableEdits, type ThemeEdits,
} from '@lottie-theme/core';
import { loadLocal } from '@/lib/files';
import { assetId, buildDocument, downloadDotLottie, downloadZip } from '@/lib/export';
import { useEditor } from '@/lib/store';
import { CheckCheck, Download, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Entry {
  id: string;
  name: string;
  doc: unknown;
  result: unknown;
  compatible: boolean;
  reason: string;
  changed: number;
  selected: boolean;
}

/** Paused first frame of an animation, small. */
function Thumb({ doc }: { doc: unknown }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const item = lottie.loadAnimation({
      container: host.current,
      renderer: 'svg',
      autoplay: false,
      animationData: structuredClone(doc),
    });
    // Halfway, not frame 0: plenty of these animations start on an empty frame.
    item.addEventListener('DOMLoaded', () => item.goToAndStop(Math.floor(item.totalFrames / 2), true));
    return () => item.destroy();
  }, [doc]);
  return <div ref={host} className="size-full" />;
}

/**
 * Apply the current edits to a whole folder.
 *
 * Colour-by-hex carries anywhere. Per-slot colours, layer names and image replacements
 * are addressed by position, so they are only applied where the slot structure matches —
 * and where it does not, the file is still processed with the parts that travel, and
 * says so, rather than being silently corrupted or silently skipped.
 */
export function BatchPanel({ onClose }: { onClose: () => void }) {
  const files = useEditor((s) => s.files);
  const currentId = useEditor((s) => s.currentId);
  const original = useEditor((s) => s.original);
  const edits = useEditor((s) => s.edits);
  const background = useEditor((s) => s.background);

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!original) return;
      const reference = collectSlots(original);
      const out: Entry[] = [];
      for (const file of files) {
        if (cancelled) return;
        try {
          const doc = file.doc ?? (await loadLocal(file.id));
          const slots = collectSlots(doc);
          const { compatible, reason } = checkCompatibility(reference, slots);
          const usable: ThemeEdits = portableEdits(edits, compatible);
          const applied = applyEdits(doc, usable);
          out.push({
            id: file.id,
            name: file.name,
            doc,
            result: applied.doc,
            compatible,
            reason,
            changed: applied.colorsChanged,
            selected: applied.colorsChanged > 0,
          });
        } catch (e) {
          out.push({
            id: file.id, name: file.name, doc: null, result: null,
            compatible: false, reason: e instanceof Error ? e.message : 'could not read',
            changed: 0, selected: false,
          });
        }
        setProgress(out.length);
      }
      if (!cancelled) setEntries(out);
    };
    run().catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'batch failed'));
    return () => {
      cancelled = true;
    };
  }, [files, original, edits]);

  const chosen = (entries ?? []).filter((e) => e.selected && e.result);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[1000px] flex-col overflow-hidden rounded-2xl border border-[var(--color-ink-4)] bg-[var(--color-ink-1)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="text-[15px] font-medium">Apply to the whole folder</h2>
          <span className="text-[13px] text-[var(--color-fg-mute)]">
            {entries ? `${chosen.length} of ${entries.length} selected` : `reading ${progress}/${files.length}…`}
          </span>
          <button onClick={onClose} className="ml-auto text-[var(--color-fg-mute)] hover:text-[var(--color-fg)]">
            ×
          </button>
        </div>

        {error && <p className="px-4 py-2 text-[13px] text-red-400">{error}</p>}

        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-auto p-4">
          {(entries ?? []).map((entry) => (
            <button
              key={entry.id}
              onClick={() =>
                setEntries((list) =>
                  (list ?? []).map((e) => (e.id === entry.id ? { ...e, selected: !e.selected } : e)),
                )
              }
              disabled={!entry.result}
              className={`rounded-lg border p-1.5 text-left ${
                entry.selected ? 'border-[var(--color-brand)]' : 'border-[var(--color-ink-4)] opacity-60'
              } disabled:opacity-30`}
            >
              <div
                className="mb-1 flex aspect-square items-center justify-center overflow-hidden rounded"
                style={{ background }}
              >
                {entry.result ? <Thumb doc={entry.result} /> : null}
              </div>
              <div className="truncate text-[12px]" title={entry.id}>
                {entry.name}
              </div>
              <div
                className={`truncate text-[11px] ${entry.compatible ? 'text-[var(--color-fg-mute)]' : 'text-amber-400'}`}
                title={entry.reason}
              >
                {entry.id === currentId ? 'current · ' : ''}
                {entry.changed} colour{entry.changed === 1 ? '' : 's'}
                {entry.compatible ? '' : ' · by-hex only'}
              </div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEntries((l) => (l ?? []).map((e) => ({ ...e, selected: !!e.result })))}
          >
            <CheckCheck />
            select all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEntries((l) => (l ?? []).map((e) => ({ ...e, selected: false })))}
          >
            none
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              disabled={!chosen.length}
              onClick={() =>
                downloadDotLottie(
                  chosen.map((e) => ({ id: assetId(e.id), doc: e.result })),
                  'theme.lottie',
                )
              }
              variant="outline"
              size="sm"
            >
              <Package />
              .lottie bundle
            </Button>
            <Button
              size="sm"
              disabled={!chosen.length}
              onClick={() =>
                downloadZip(
                  chosen.map((e) => ({
                    path: e.id.replace(/^lotties(-light)?\//, ''),
                    doc: buildDocument(e.doc, portableEdits(edits, e.compatible), { metadata: 'embed' }),
                  })),
                  'lottie-theme-batch.zip',
                )
              }
            >
              <Download />
              Download ZIP
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

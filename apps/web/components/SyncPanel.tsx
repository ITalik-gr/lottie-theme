'use client';

import { Bot, FileWarning, RotateCw, Save, Undo2, User, X } from 'lucide-react';
import { isEmptyEdits } from '@lottie-theme/core';
import { Button } from '@/components/ui/button';
import { bridge, useSync } from '@/lib/sync';
import { useEditor } from '@/lib/store';

/**
 * The live bridge to an agent working in the same folder, and the record of what it did.
 *
 * The activity list is the undo stack seen from the other side: every step, whoever made
 * it, with the agent's marked — and rolling one back is the same operation as undoing your
 * own, because they really are the same steps.
 */
export function SyncPanel() {
  const status = useSync();
  const undoStack = useEditor((s) => s.undoStack);
  const undoTo = useEditor((s) => s.undoTo);
  const currentId = useEditor((s) => s.currentId);
  const edits = useEditor((s) => s.edits);
  const files = useEditor((s) => s.files);
  const openFile = useEditor((s) => s.openFile);

  const dirty = !isEmptyEdits(edits);
  const isLocal = files.find((f) => f.id === currentId)?.source === 'local';

  async function reload(path: string) {
    const { loadLocal } = await import('@/lib/files');
    openFile(path, await loadLocal(path));
    bridge.dismissChange(path);
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="border-b border-[var(--color-line)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ background: status.connected ? '#4ade80' : 'var(--color-ink-4)' }}
          />
          <span className="text-[13px] text-[var(--color-fg)]">
            {status.connected ? 'agent bridge connected' : 'no agent connected'}
          </span>
        </div>
        {status.connected ? (
          <p className="mt-1 font-mono text-[11px] break-all text-[var(--color-fg-mute)]">{status.root}</p>
        ) : (
          <p className="mt-1 text-[12px] leading-snug text-[var(--color-fg-mute)]">
            Run <code className="font-mono">npx lottie-theme-sync</code> in the folder you are
            working in. An agent with the MCP server pointed at the same folder then sees the
            file you have open, the colour you have selected, and everything you have changed
            but not saved — and its own edits land here as you watch.
          </p>
        )}
      </div>

      {status.connected && (
        <div className="border-b border-[var(--color-line)] px-3 py-2">
          <Button size="xs" variant="secondary" onClick={() => bridge.save()} disabled={!dirty}>
            <Save />
            write changes to the file
          </Button>
          <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-fg-mute)]">
            Nothing is written until you ask. The agent already sees your unsaved work through
            the session; saving is for making it permanent on disk.
          </p>
          {status.lastSaved && (
            <p className="mt-1 text-[11px] text-[var(--color-fg-dim)]">
              saved {status.lastSaved.path} · {status.lastSaved.colorsChanged} colours
            </p>
          )}
          {status.error && <p className="mt-1 text-[11px] text-[#f87171]">{status.error}</p>}
        </div>
      )}

      {status.changedOnDisk.map((path) => (
        <div key={path} className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
          <FileWarning className="size-3.5 shrink-0 text-amber-400" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-fg-dim)]" title={path}>
            changed on disk
          </span>
          {isLocal && (
            <Button size="xs" variant="secondary" onClick={() => void reload(path)}>
              <RotateCw />
              reload
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" onClick={() => bridge.dismissChange(path)} aria-label="ignore">
            <X />
          </Button>
        </div>
      ))}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {undoStack.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-[var(--color-fg-mute)]">Nothing has changed yet.</p>
        ) : (
          <ul className="py-1">
            {undoStack.map((step, index) => (
              <li
                key={index}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[var(--color-hover)]"
              >
                <span
                  className={`grid size-5 shrink-0 place-content-center rounded-md ${
                    step.origin === 'agent'
                      ? 'bg-[var(--color-brand)]/20 text-[var(--color-brand-bright)]'
                      : 'bg-[var(--color-line-soft)] text-[var(--color-fg-mute)]'
                  }`}
                  title={step.origin === 'agent' ? 'the agent did this' : 'you did this'}
                >
                  {step.origin === 'agent' ? <Bot className="size-3" /> : <User className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-fg-dim)]">{step.label}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => undoTo(index)}
                  title="undo back to just before this step"
                  aria-label="revert this step"
                  className="shrink-0"
                >
                  <Undo2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

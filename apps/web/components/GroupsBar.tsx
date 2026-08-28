'use client';

import { FolderPlus, X } from 'lucide-react';
import { listGroups } from '@lottie-theme/core';
import { Button } from '@/components/ui/button';
import { ColorField } from './ColorField';
import { useEditor } from '@/lib/store';

/**
 * Named sets of slots.
 *
 * The alternative is editing 150 identical slots one at a time, which is the thing that
 * makes this work tedious. Because slot indices are stable, a group survives export and
 * re-import — which is what lets one named theme be applied to a whole folder.
 */
export function GroupsBar() {
  const edits = useEditor((s) => s.edits);
  const slots = useEditor((s) => s.slots);
  const properties = useEditor((s) => s.properties);
  const selectedKeys = useEditor((s) => s.selectedKeys);
  const clearSelection = useEditor((s) => s.clearSelection);
  const createGroup = useEditor((s) => s.createGroup);
  const dropGroup = useEditor((s) => s.dropGroup);
  const setGroupColor = useEditor((s) => s.setGroupColor);
  const setHighlightKey = useEditor((s) => s.setHighlightKey);

  const groups = listGroups(edits, slots);
  if (!groups.length && !selectedKeys.length) return null;

  return (
    <div className="shrink-0 border-b border-[var(--color-line)] px-3 py-2">
      {selectedKeys.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-[var(--color-brand)]/10 px-2 py-1.5">
          <span className="flex-1 text-[12px] text-[var(--color-fg-dim)]">
            {selectedKeys.length} colour{selectedKeys.length === 1 ? '' : 's'} selected
          </span>
          <Button
            size="xs"
            data-testid="create-group"
            onClick={() => {
              const name = window.prompt('Group name (surface, text-muted, accent…):');
              if (!name) return;
              const indices = properties.filter((p) => selectedKeys.includes(p.key)).flatMap((p) => p.slots);
              createGroup(name, indices);
              clearSelection();
            }}
          >
            <FolderPlus />
            group
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={clearSelection} aria-label="clear selection">
            <X />
          </Button>
        </div>
      )}

      {groups.map((group) => (
        <div
          key={group.name}
          onMouseEnter={() => {
            const first = properties.find((p) => group.slots.includes(p.slots[0] ?? -1));
            if (first) setHighlightKey(first.key);
          }}
          onMouseLeave={() => setHighlightKey(null)}
          className="group flex items-center gap-2 py-1"
        >
          <ColorField
            value={group.hex ?? '#888888'}
            onCommit={(hex) => setGroupColor(group.name, hex)}
            size={22}
            className="shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-[12px]" title={group.hex ? undefined : 'members currently differ'}>
            {group.name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-fg-mute)]">{group.slots.length}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => dropGroup(group.name)}
            aria-label={`remove group ${group.name}`}
            className="opacity-0 group-hover:opacity-100"
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}

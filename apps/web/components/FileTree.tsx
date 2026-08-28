'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileJson, Folder,
  FolderOpen, Pencil, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEditor } from '@/lib/store';
import { filesFromInput, loadLocal, localCorpus } from '@/lib/files';
import { cn } from '@/lib/utils';

/** The inline field both folders and files rename through. Escape abandons the edit,
 *  Enter and a click elsewhere keep it; an empty value puts the real name back. */
function RenameField({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const abandoned = useRef(false);
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        if (!abandoned.current) onCommit(draft);
        onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          abandoned.current = true;
          e.currentTarget.blur();
        }
      }}
      className="min-w-0 flex-1 rounded border border-[var(--color-brand)] bg-[var(--color-hover)] px-1.5 py-0.5 text-[13px] outline-none"
    />
  );
}

/** One collapsible folder header. Two levels use it, so it is written once. */
function FolderHeader({
  label,
  count,
  expanded,
  marked,
  onToggle,
  onRename,
  strong,
}: {
  label: string;
  count: number;
  expanded: boolean;
  /** The open file is somewhere inside, and this folder is closed. */
  marked: boolean;
  onToggle: () => void;
  onRename: (label: string) => void;
  strong?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="group/row flex w-full items-center gap-1.5 rounded-md pr-1 hover:bg-[var(--color-hover)]">
      {editing ? (
        <>
          <span className="w-4 shrink-0" />
          <RenameField
            value={label}
            onCommit={onRename}
            onCancel={() => setEditing(false)}
          />
        </>
      ) : (
        <>
          <button
            onClick={onToggle}
            onDoubleClick={() => setEditing(true)}
            title={label}
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
          >
            {expanded ? (
              <ChevronDown className="size-3 shrink-0 text-[var(--color-fg-mute)]" />
            ) : (
              <ChevronRight className="size-3 shrink-0 text-[var(--color-fg-mute)]" />
            )}
            {expanded ? (
              <FolderOpen className={cn('size-3 shrink-0', strong ? 'text-[var(--color-fg-dim)]' : 'text-[var(--color-fg-mute)]')} />
            ) : (
              <Folder className={cn('size-3 shrink-0', strong ? 'text-[var(--color-fg-dim)]' : 'text-[var(--color-fg-mute)]')} />
            )}
            <span className={cn('panel-title min-w-0 flex-1 truncate', strong && 'text-[var(--color-fg-dim)]')}>
              {label}
            </span>
            {marked && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-brand)]" />}
          </button>
          <button
            onClick={() => setEditing(true)}
            aria-label={`rename folder ${label}`}
            className="grid size-5 shrink-0 place-content-center rounded text-[var(--color-fg-mute)] opacity-0 group-hover/row:opacity-100 hover:text-[var(--color-fg)]"
          >
            <Pencil className="size-3" />
          </button>
          <span className="shrink-0 pr-1 text-[10px] tabular-nums text-[var(--color-fg-mute)]">{count}</span>
        </>
      )}
    </div>
  );
}

export function FileTree() {
  const files = useEditor((s) => s.files);
  const currentId = useEditor((s) => s.currentId);
  const aliases = useEditor((s) => s.aliases);
  const setFiles = useEditor((s) => s.setFiles);
  const addFiles = useEditor((s) => s.addFiles);
  const openFile = useEditor((s) => s.openFile);
  const hydrate = useEditor((s) => s.hydrate);
  const syncCorpus = useEditor((s) => s.syncCorpus);
  const restoreId = useEditor((s) => s.restoreId);
  const renameFile = useEditor((s) => s.renameFile);
  const renameFolder = useEditor((s) => s.renameFolder);
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Folders the user has closed. Absent means open, so a new folder appears expanded. */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Files that appeared while the page was open — an agent writing into the folder. They
   *  are marked until looked at, because a file silently sliding into a list of seventy is
   *  a file nobody notices. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const toggle = (dir: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  // The corpus is re-listed on a timer, not once: an agent recolouring files in the
  // terminal writes new ones into the folder, and having to reload the page to see them
  // is the difference between watching the work and hunting for it. Polling stops if the
  // listing is not there at all — outside `next dev` the route does not exist, and
  // retrying a 404 every few seconds for the life of the tab helps nobody.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (first: boolean) => {
      if (cancelled) return;
      const list = await localCorpus();
      if (cancelled) return;
      if (!list.length) {
        if (first) return;
      } else if (first) {
        setFiles(list);
      } else {
        const known = new Set(useEditor.getState().files.map((f) => f.id));
        const added = list.filter((f) => !known.has(f.id)).map((f) => f.id);
        syncCorpus(list);
        if (added.length) setFresh((current) => new Set([...current, ...added]));
      }
      timer = setTimeout(() => void poll(false), document.hidden ? 15_000 : 4_000);
    };

    void poll(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [setFiles, syncCorpus]);

  // Names, saved work and the last open file are read after mount, not while the store is
  // created: the page is prerendered, and a value out of localStorage would not match what
  // the server wrote.
  useEffect(() => hydrate(), [hydrate]);

  const open = async (id: string) => {
    setError(null);
    setFresh((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    const file = files.find((f) => f.id === id);
    if (!file) return;
    try {
      openFile(id, file.doc ?? (await loadLocal(id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not open file');
    }
  };

  // Reopen whatever was open when the page was last left — with its edits, which the
  // store restores — and fall back to the first file so a fresh session still lands
  // somewhere useful.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !files.length || currentId) return;
    opened.current = true;
    const wanted = restoreId && files.some((f) => f.id === restoreId) ? restoreId : files[0]!.id;
    void open(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, currentId, restoreId]);

  const roots = files.reduce<Record<string, Record<string, typeof files>>>((acc, f) => {
    const [root, ...rest] = f.dir.split('/');
    const branch = (acc[root ?? ''] ??= {});
    (branch[rest.join('/') || '.'] ??= []).push(f);
    return acc;
  }, {});

  /** Every folder that has a header, so one click can close or open the lot. */
  const folderKeys = Object.entries(roots).flatMap(([root, branches]) => [
    root,
    ...Object.keys(branches).filter((sub) => sub !== '.').map((sub) => `${root}/${sub}`),
  ]);
  const allClosed = folderKeys.length > 0 && folderKeys.every((key) => closed.has(key));

  return (
    <div
      className={cn('flex h-full flex-col overflow-hidden', dragging && 'bg-[var(--color-brand)]/5')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        const loaded = await filesFromInput(e.dataTransfer.files);
        addFiles(loaded);
        if (loaded[0]) openFile(loaded[0].id, loaded[0].doc);
      }}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 px-3">
        <h2 className="panel-title flex-1">Files</h2>
        {files.length > 0 && (
          <span className="text-[11px] tabular-nums text-[var(--color-fg-mute)]">{files.length}</span>
        )}
        {folderKeys.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="files-collapse-all"
                aria-label={allClosed ? 'expand every folder' : 'collapse every folder'}
                onClick={() => setClosed(allClosed ? new Set() : new Set(folderKeys))}
              >
                {allClosed ? <ChevronsUpDown /> : <ChevronsDownUp />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{allClosed ? 'Open every folder' : 'Close every folder'}</TooltipContent>
          </Tooltip>
        )}
        <Button variant="ghost" size="icon-sm" onClick={() => picker.current?.click()} title="add .json files">
          <Plus />
        </Button>
        <input
          ref={picker}
          type="file"
          accept="application/json,.json"
          multiple
          className="hidden"
          onChange={async (e) => {
            if (!e.target.files) return;
            const loaded = await filesFromInput(e.target.files);
            addFiles(loaded);
            if (loaded[0]) openFile(loaded[0].id, loaded[0].doc);
          }}
        />
      </header>

      {error && (
        <p className="mx-2 mb-2 flex items-center gap-1.5 rounded-md bg-[var(--color-destructive)]/10 px-2 py-1.5 text-[12px] text-[var(--color-destructive)]">
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {files.length === 0 && (
          <div className="mx-1 mt-2 rounded-lg border border-dashed border-[var(--color-line)] px-3 py-6 text-center">
            <FileJson className="mx-auto mb-2 size-5 text-[var(--color-fg-mute)]" />
            <p className="text-[12px] leading-snug text-[var(--color-fg-mute)]">
              Drop <span className="font-mono">.json</span> files here.
              <br />
              Nothing is uploaded — it all stays in this browser.
            </p>
          </div>
        )}

        {Object.entries(roots).map(([root, branches]) => {
          const rootOpen = !closed.has(root);
          const total = Object.values(branches).reduce((n, list) => n + list.length, 0);
          const rootHasCurrent = Object.values(branches).some((list) =>
            list.some((f) => f.id === currentId),
          );
          return (
            <section key={root} className="mb-0.5">
              <FolderHeader
                label={aliases.dirs[root] ?? root}
                count={total}
                expanded={rootOpen}
                marked={rootHasCurrent && !rootOpen}
                onToggle={() => toggle(root)}
                onRename={(label) => renameFolder(root, label === root ? '' : label)}
                strong
              />
              {rootOpen &&
                Object.entries(branches).map(([sub, entries]) => {
                  const key = `${root}/${sub}`;
                  const expanded = !closed.has(key);
                  const holdsCurrent = entries.some((f) => f.id === currentId);
                  return (
                    <div key={key} className="pl-3">
                      {sub !== '.' && (
                        <FolderHeader
                          label={aliases.dirs[key] ?? sub}
                          count={entries.length}
                          expanded={expanded}
                          marked={holdsCurrent && !expanded}
                          onToggle={() => toggle(key)}
                          onRename={(label) => renameFolder(key, label === sub ? '' : label)}
                        />
                      )}
                      {(sub === '.' || expanded) &&
                        entries.map((f) => {
                          const active = f.id === currentId;
                          const plain = f.name.replace(/\.json$/, '');
                          const label = aliases.files[f.id] ?? plain;
                          if (editingId === f.id) {
                            return (
                              <div key={f.id} className="flex items-center py-1 pr-2 pl-3">
                                <RenameField
                                  value={label}
                                  onCommit={(next) => renameFile(f.id, next === plain ? '' : next)}
                                  onCancel={() => setEditingId(null)}
                                />
                              </div>
                            );
                          }
                          return (
                            <div
                              key={f.id}
                              className={cn(
                                // The open file is marked with a bar and a tint rather than
                                // a solid fill: a saturated block beside the palette shifts
                                // how the swatches read.
                                'group/file relative flex w-full items-center rounded-md pr-1 transition-colors',
                                active
                                  ? 'bg-[var(--color-brand)]/12 text-[var(--color-fg)]'
                                  : 'text-[var(--color-fg-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]',
                              )}
                            >
                              <span
                                className={cn(
                                  'absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full',
                                  active ? 'bg-[var(--color-brand)]' : 'bg-transparent',
                                )}
                              />
                              <button
                                onClick={() => void open(f.id)}
                                onDoubleClick={() => setEditingId(f.id)}
                                title={f.id}
                                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left"
                              >
                                <FileJson
                                  className={cn(
                                    'size-3.5 shrink-0',
                                    active ? 'text-[var(--color-brand-bright)]' : 'text-[var(--color-fg-mute)]',
                                  )}
                                />
                                <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
                                {fresh.has(f.id) && (
                                  <span
                                    title="added since you opened this page"
                                    className="size-1.5 shrink-0 rounded-full bg-[var(--color-ok)]"
                                  />
                                )}
                              </button>
                              <button
                                onClick={() => setEditingId(f.id)}
                                aria-label={`rename ${plain}`}
                                className="grid size-5 shrink-0 place-content-center rounded text-[var(--color-fg-mute)] opacity-0 group-hover/file:opacity-100 hover:text-[var(--color-fg)]"
                              >
                                <Pencil className="size-3" />
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

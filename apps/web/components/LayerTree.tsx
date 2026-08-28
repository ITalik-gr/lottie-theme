'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  Ban, Box, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Crosshair,
  Image as ImageIcon, Layers, RefreshCw, RotateCcw, Scissors, Square, SquareDashed,
  SquareDashedBottom, Squircle, Type, Video, X,
} from 'lucide-react';
import { slotsInSubtree, type TreeNode } from '@lottie-theme/core';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Swatch } from './Swatch';
import { propertyHex, useEditor } from '@/lib/store';
import { cn } from '@/lib/utils';

/** Layer types that carry no colour of their own but are still worth showing, because
 *  they are clickable on the canvas and explain why something cannot be picked. */
const NO_COLOUR = new Set(['null', 'camera', 'audio']);

/** An icon per layer type. A tree of forty identical rows is a wall of text; the type is
 *  the first thing you are actually looking for. */
const TYPE_ICON: Record<string, typeof Box> = {
  precomp: Layers,
  solid: Square,
  image: ImageIcon,
  null: Ban,
  shape: Squircle,
  text: Type,
  camera: Video,
};

const KIND_LABEL: Record<string, string> = {
  fill: 'fill',
  stroke: 'stroke',
  'gradient-fill': 'gradient',
  'gradient-stroke': 'grad. stroke',
  'solid-layer': 'solid',
  'text-fill': 'text',
  'text-stroke': 'text stroke',
};

/** Which rows are open. It lives above the rows rather than in them so that one button can
 *  fold the whole tree — a row that owned its own state could not be told to close. */
const Expansion = createContext<{
  isOpen: (id: string, depth: number) => boolean;
  toggle: (id: string, depth: number) => void;
}>({ isOpen: (_id, depth) => depth < 1, toggle: () => {} });

/** The flags that explain why a layer behaves oddly on the canvas. */
function LayerFlags({ node }: { node: TreeNode }) {
  const flags: [typeof Box, string][] = [];
  if (node.hasMask) flags.push([Scissors, 'Masked: clickable on the canvas, but holds no colour of its own']);
  if (node.matte === 'source') flags.push([SquareDashedBottom, 'Used as a track matte by the layer below it']);
  if (node.matte === 'target') flags.push([SquareDashed, 'Shaped by the track matte above it']);
  if (node.sharedPrecomp) flags.push([Copy, 'The same precomp drawn more than once — these colours are shared']);
  if (node.truncated) flags.push([RefreshCw, 'Stopped here: this precomp references itself']);
  if (!flags.length) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {flags.map(([Icon, help], i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span className="grid size-4 place-content-center text-[var(--color-fg-mute)]">
              <Icon className="size-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="left">
            <span className="block max-w-[210px]">{help}</span>
          </TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

function LayerRow({ node, depth }: { node: TreeNode; depth: number }) {
  const slots = useEditor((s) => s.slots);
  const properties = useEditor((s) => s.properties);
  const selectedKey = useEditor((s) => s.selectedKey);
  const soloLayerId = useEditor((s) => s.soloLayerId);
  const filterHex = useEditor((s) => s.filterHex);
  const setHighlightKey = useEditor((s) => s.setHighlightKey);
  const selectProperty = useEditor((s) => s.selectProperty);
  const selectedKeys = useEditor((s) => s.selectedKeys);
  const toggleSelected = useEditor((s) => s.toggleSelected);
  const setSoloLayer = useEditor((s) => s.setSoloLayer);
  const renameLayer = useEditor((s) => s.renameLayer);
  const edits = useEditor((s) => s.edits);

  const expansion = useContext(Expansion);
  const open = expansion.isOpen(node.id, depth);
  const setOpen = () => expansion.toggle(node.id, depth);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const subtree = useMemo(() => slotsInSubtree(node), [node]);
  const ownProperties = useMemo(() => {
    const keys = new Set(node.slots.map((i) => slots[i]?.renderKey));
    return properties.filter((p) => keys.has(p.key));
  }, [node, slots, properties]);

  // A filter is about finding a colour, so a layer that neither uses it nor contains
  // anything that does is not worth a row.
  if (filterHex && !subtree.some((i) => slots[i]?.hex === filterHex)) return null;

  const hasChildren = node.children.length > 0 || ownProperties.length > 0;
  const solo = soloLayerId === node.id;
  const Icon = TYPE_ICON[node.typeName] ?? Box;

  return (
    <div>
      <div
        className={cn(
          'group flex h-8 items-center gap-1.5 rounded-md pr-1.5 transition-colors',
          solo ? 'bg-[var(--color-brand)]/12' : 'hover:bg-[var(--color-hover)]',
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          onClick={setOpen}
          className={cn(
            'grid size-4 shrink-0 place-content-center rounded text-[var(--color-fg-mute)] hover:text-[var(--color-fg)]',
            !hasChildren && 'invisible',
          )}
          aria-label={open ? 'collapse' : 'expand'}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>

        <Icon
          className={cn(
            'size-3.5 shrink-0',
            NO_COLOUR.has(node.typeName) ? 'text-[var(--color-fg-mute)]/60' : 'text-[var(--color-fg-mute)]',
          )}
        />

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              renameLayer(node, draft);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="min-w-0 flex-1 rounded border border-[var(--color-brand)] bg-[var(--color-hover)] px-1.5 py-0.5 text-[13px] outline-none"
          />
        ) : (
          <button
            onDoubleClick={() => {
              setDraft(node.name ?? '');
              setEditing(true);
            }}
            onClick={setOpen}
            title={`${node.typeName} · frames ${node.ip}–${node.op}${node.name ? '' : ' · double-click to name it'}`}
            className="min-w-0 flex-1 truncate text-left text-[13px]"
          >
            <span className={node.name ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-dim)] italic'}>
              {node.name ?? `${node.typeName} ${node.ind ?? '?'}`}
            </span>
          </button>
        )}

        <LayerFlags node={node} />

        {subtree.length > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-fg-mute)]">{subtree.length}</span>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSoloLayer(node.id)}
              className={cn(
                'grid size-5 shrink-0 place-content-center rounded transition-opacity',
                solo
                  ? 'text-[var(--color-brand-bright)]'
                  : 'text-[var(--color-fg-mute)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-fg)]',
              )}
            >
              <Crosshair className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{solo ? 'show everything again' : 'show only this layer'}</TooltipContent>
        </Tooltip>
      </div>

      {open && (
        <div>
          {ownProperties.map((p) => {
            const picked = selectedKey === p.key;
            const inSelection = selectedKeys.includes(p.key);
            // The tree shows what the layer is painted with *now*. Showing the shipped
            // value next to a canvas that has already changed is how you end up hunting
            // for a colour that is no longer there.
            const now = propertyHex(edits, p);
            return (
              <button
                key={p.key}
                onMouseEnter={() => setHighlightKey(p.key)}
                onMouseLeave={() => setHighlightKey(null)}
                onClick={(e) =>
                  e.shiftKey || e.metaKey || e.ctrlKey ? toggleSelected(p.key) : selectProperty(p.key)
                }
                title="shift-click to add to a selection"
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left transition-colors',
                  inSelection
                    ? 'bg-[var(--color-brand)]/25'
                    : picked
                      ? 'bg-[var(--color-brand)]/15'
                      : 'hover:bg-[var(--color-hover)]',
                )}
                style={{ paddingLeft: depth * 12 + 26 }}
              >
                <Swatch hex={now} size={13} />
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-fg-dim)]">{now}</span>
                {now !== p.hex && (
                  <span
                    title={`was ${p.hex}`}
                    className="font-mono text-[10px] tabular-nums text-[var(--color-fg-mute)] line-through"
                  >
                    {p.hex}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-fg-mute)]">
                  {KIND_LABEL[p.kind] ?? p.kind}
                  {p.stop !== undefined ? ` ${p.stop}` : ''}
                </span>
                {p.shared && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-[var(--color-fg-mute)]">
                        <Copy className="size-3" />
                        {p.occurrences}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      One value drawn in {p.occurrences} places — it cannot be split
                    </TooltipContent>
                  </Tooltip>
                )}
              </button>
            );
          })}
          {node.children.map((child) => (
            <LayerRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LayerTree() {
  const tree = useEditor((s) => s.tree);
  const currentId = useEditor((s) => s.currentId);
  const palette = useEditor((s) => s.palette);
  const filterHex = useEditor((s) => s.filterHex);
  const setFilterHex = useEditor((s) => s.setFilterHex);
  const soloLayerId = useEditor((s) => s.soloLayerId);
  const setSoloLayer = useEditor((s) => s.setSoloLayer);
  const xrayOn = useEditor((s) => s.xray);
  const toggleXray = useEditor((s) => s.toggleXray);

  /** What a row does when the user has not said otherwise: top level open, the rest closed,
   *  until the fold-all button replaces that baseline for the whole tree. */
  const [baseline, setBaseline] = useState<'auto' | 'closed' | 'open'>('auto');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const folded = baseline === 'closed';

  // A different file is a different tree; its ids mean nothing here.
  useEffect(() => {
    setBaseline('auto');
    setOverrides({});
  }, [currentId]);

  const expansion = useMemo(() => {
    const fallback = (depth: number) => (baseline === 'auto' ? depth < 1 : baseline === 'open');
    return {
      isOpen: (id: string, depth: number) => overrides[id] ?? fallback(depth),
      toggle: (id: string, depth: number) =>
        setOverrides((current) => ({ ...current, [id]: !(current[id] ?? fallback(depth)) })),
    };
  }, [baseline, overrides]);

  const foldAll = () => {
    setBaseline(folded ? 'open' : 'closed');
    setOverrides({});
  };

  if (!tree.length) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-10 shrink-0 items-center gap-2 px-3">
        <h2 className="panel-title flex-1">Layers</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={foldAll}
              data-testid="layers-collapse-all"
              aria-label={folded ? 'expand every layer' : 'collapse every layer'}
              className="grid size-6 shrink-0 place-content-center rounded-md text-[var(--color-fg-mute)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
            >
              {folded ? <ChevronsUpDown className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{folded ? 'Open every layer' : 'Close every layer'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-fg-dim)]">
              <Checkbox checked={xrayOn} onCheckedChange={toggleXray} className="size-3.5" />
              x-ray
            </label>
          </TooltipTrigger>
          <TooltipContent side="bottom">Dim everything except what the pointer is over</TooltipContent>
        </Tooltip>
      </header>

      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
        <Select value={filterHex ?? 'all'} onValueChange={(v) => setFilterHex(v === 'all' ? null : v)}>
          <SelectTrigger size="sm" className="min-w-0 flex-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="text-[var(--color-fg-dim)]">all colours</span>
            </SelectItem>
            {palette.map((p) => (
              <SelectItem key={p.hex} value={p.hex}>
                {/* The point of filtering by colour is the colour, so it is shown, not spelled. */}
                <Swatch hex={p.hex} size={13} />
                <span className="font-mono text-[12px] tabular-nums">{p.hex}</span>
                <span className="text-[11px] text-[var(--color-fg-mute)]">{p.count}×</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filterHex && (
          <button
            onClick={() => setFilterHex(null)}
            title="clear the filter"
            className="grid size-8 shrink-0 place-content-center rounded-md text-[var(--color-fg-mute)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
          >
            <X className="size-3.5" />
          </button>
        )}
        {soloLayerId && (
          <button
            onClick={() => setSoloLayer(soloLayerId)}
            title="show every layer again"
            className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-[var(--color-brand)]/15 px-2 text-[11px] text-[var(--color-brand-bright)]"
          >
            <RotateCcw className="size-3" />
            unsolo
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        <Expansion.Provider value={expansion}>
          {tree.map((node) => (
            <LayerRow key={node.id} node={node} depth={0} />
          ))}
        </Expansion.Provider>
      </div>
    </div>
  );
}

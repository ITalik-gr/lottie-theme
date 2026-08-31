'use client';

import { create } from 'zustand';
import {
  applyEdits, buildLayerTree, buildPalette, canonicalHex, cloneEdits, collectProperties,
  collectSlots, emptyEdits, isEmptyEdits, mergeEdits,
  colorGroup, removeGroup, setGroup, suggestTheme,
  type AlphaStop, type ColorProperty, type ContrastIssue, type PaletteEntry, type Role,
  type RoleGuess, type Slot, type ThemeEdits, type TreeNode,
} from '@lottie-theme/core';

/** Display names the user typed over a file or a folder. Local files are re-listed from
 *  disk on every load and uploads are re-read from the picker, so a rename cannot live on
 *  the file record — it is kept beside it, keyed by the path that does not change. */
export interface Aliases {
  files: Record<string, string>;
  dirs: Record<string, string>;
}

const ALIAS_KEY = 'lottie-theme:names';

function readAliases(): Aliases {
  try {
    const raw = JSON.parse(localStorage.getItem(ALIAS_KEY) ?? '{}') as Partial<Aliases>;
    return { files: raw.files ?? {}, dirs: raw.dirs ?? {} };
  } catch {
    return { files: {}, dirs: {} };
  }
}

function writeAliases(aliases: Aliases) {
  try {
    localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases));
  } catch {
    // Private browsing, or a full quota. A rename that does not outlive the tab is still
    // better than a crash in the middle of one.
  }
}

/** Work in progress, kept so that a reload does not throw away an afternoon. Only the
 *  edit set is stored — it is small, and it is the whole of what was done. The undo stack
 *  is not: it holds two edit sets per step and would grow without a bound worth paying. */
interface SavedWork {
  edits: Record<string, { edits: ThemeEdits; at: number }>;
  open: string | null;
  background: string | null;
}

const WORK_KEY = 'lottie-theme:work';

/** Files whose edits are remembered. Beyond this the oldest is dropped: localStorage is a
 *  few megabytes, and an edit set nobody has opened in weeks is not what it is for. */
const WORK_LIMIT = 40;

function readWork(): SavedWork {
  try {
    const raw = JSON.parse(localStorage.getItem(WORK_KEY) ?? '{}') as Partial<SavedWork>;
    return { edits: raw.edits ?? {}, open: raw.open ?? null, background: raw.background ?? null };
  } catch {
    return { edits: {}, open: null, background: null };
  }
}

function writeWork(work: SavedWork) {
  try {
    const entries = Object.entries(work.edits).sort((a, b) => b[1].at - a[1].at).slice(0, WORK_LIMIT);
    localStorage.setItem(WORK_KEY, JSON.stringify({ ...work, edits: Object.fromEntries(entries) }));
  } catch {
    // Private browsing, or a full quota. Losing the memory of the work is bad; throwing in
    // the middle of it is worse.
  }
}

/** Remember what has been done to a file, under the file's own id. */
function rememberEdits(id: string | null, edits: ThemeEdits) {
  if (!id) return;
  const work = readWork();
  if (isEmptyEdits(edits)) delete work.edits[id];
  else work.edits[id] = { edits, at: Date.now() };
  work.open = id;
  writeWork(work);
}

export interface LoadedFile {
  /** Stable id: the local corpus path, or `upload:<name>` for a dropped file. */
  id: string;
  name: string;
  /** Folder shown as a group header in the file tree. */
  dir: string;
  source: 'local' | 'upload';
  /** Present once the file has been opened at least once. */
  doc?: unknown;
}

/** One undoable step. Kept as a pair of edit sets rather than document copies: the
 *  documents run to megabytes, and the edit set is also what gets persisted into
 *  `meta.themeStudio` or written beside the file. */
interface Step {
  label: string;
  before: ThemeEdits;
  after: ThemeEdits;
  /** Who did it. An agent's change is an ordinary step — same stack, same undo — but the
   *  activity list has to be able to say which ones were not yours. */
  origin: 'you' | 'agent';
  at: number;
}

interface EditorState {
  files: LoadedFile[];
  /** What files and folders are called on screen. Empty until `hydrate` runs, so the
   *  server-rendered tree and the first client render agree. */
  aliases: Aliases;
  /** The file that was open when the page was last left. Null until `hydrate` runs. */
  restoreId: string | null;
  currentId: string | null;
  /** The untouched document as loaded. All rendering derives from this plus `edits`. */
  original: unknown | null;
  slots: Slot[];
  properties: ColorProperty[];
  tree: TreeNode[];
  palette: PaletteEntry[];
  edits: ThemeEdits;

  // view
  background: string;
  checkerboard: boolean;
  showOriginal: boolean;
  /** Colour highlighted from the palette; drives the magenta preview on the canvas. */
  highlightHex: string | null;
  /** Property highlighted from the tree, the popover or a palette row. */
  highlightKey: string | null;
  /** Property the user picked — what the slot panel edits. */
  selectedKey: string | null;
  /** Effect colour path, when the pick is a Drop Shadow (or similar) rather than a slot.
   *  Effects sit outside the slot list on purpose — inserting them would renumber every
   *  saved colour map — so they need their own address. Exclusive with `selectedKey`. */
  selectedEffectPath: string | null;
  /** Multi-selection, for building a group out of several colours at once. */
  selectedKeys: string[];
  /** Dim everything except the highlighted element. */
  xray: boolean;
  /** Show hits that are effectively invisible: masks, hit-boxes, faded gradients. */
  includeTransparent: boolean;
  /** Show only the layers that use this colour. */
  filterHex: string | null;
  soloLayerId: string | null;
  /** Which section of the right-hand rail is open. In the store rather than in the panel
   *  because other parts of the editor send you to one — picking a gradient stop offers
   *  to open the gradient itself. */
  section: string;
  /** Ramp path of the gradient being edited, if any. */
  selectedRamp: string | null;

  /** Result of the last auto-suggestion: a draft the user then corrects. */
  roles: RoleGuess[];
  roleOverrides: Record<string, Role>;
  audit: ContrastIssue[];
  backdrop: string;

  undoStack: Step[];
  redoStack: Step[];

  /** The agent is mid-run. In the store rather than in its panel because two things
   *  outside the panel need it: the guard that asks before the page is closed, and the
   *  file tree, which must not swap the document out from under a request in flight. */
  agentBusy: boolean;

  setFiles: (files: LoadedFile[]) => void;
  /** Replace the local corpus listing while keeping dropped files and loaded documents —
   *  what a poll does when an agent has written new animations into the folder. */
  syncCorpus: (files: LoadedFile[]) => void;
  /** Read names, saved work and the last open file out of localStorage. Called from the
   *  page after mount, never while the store is created: the page is prerendered. */
  hydrate: () => void;
  renameFile: (id: string, label: string) => void;
  renameFolder: (path: string, label: string) => void;
  addFiles: (files: LoadedFile[]) => void;
  openFile: (id: string, doc: unknown) => void;
  setColor: (fromHex: string, toHex: string) => void;
  setSlotColor: (index: number, toHex: string) => void;
  applyPreset: (name: string, entries: Record<string, string>) => void;
  setPropertyColor: (key: string, toHex: string) => void;
  setAlphaStops: (rampPath: string, stops: AlphaStop[]) => void;
  replaceImageAsset: (index: number, dataUri: string, size?: { w: number; h: number }) => void;
  suggest: (target: 'light' | 'dark') => void;
  applyEdits: (label: string, incoming: ThemeEdits) => void;
  /** An edit set arriving over the live bridge, replacing the local set wholesale — the
   *  hub has already merged it, and it is authoritative. */
  applyRemoteEdits: (label: string, edits: ThemeEdits, origin: 'you' | 'agent') => void;
  createGroup: (name: string, slots: number[]) => void;
  dropGroup: (name: string) => void;
  setGroupColor: (name: string, hex: string) => void;
  setRole: (key: string, role: Role) => void;
  renameLayer: (node: TreeNode, name: string) => void;
  resetEdits: () => void;
  undo: () => void;
  redo: () => void;
  /** Roll back to just before step `index` of the undo stack — how a single agent change
   *  gets rejected without unpicking everything done since. */
  undoTo: (index: number) => void;
  setBackground: (bg: string) => void;
  toggleCheckerboard: () => void;
  toggleShowOriginal: () => void;
  setHighlight: (hex: string | null) => void;
  setHighlightKey: (key: string | null) => void;
  selectProperty: (key: string | null) => void;
  selectEffect: (path: string | null) => void;
  /** Recolour one effect parameter. Keyed by path, never by slot index. */
  setEffectColor: (path: string, toHex: string) => void;
  toggleSelected: (key: string) => void;
  clearSelection: () => void;
  toggleXray: () => void;
  toggleIncludeTransparent: () => void;
  setFilterHex: (hex: string | null) => void;
  setSoloLayer: (id: string | null) => void;
  setSection: (section: string) => void;
  /** Open a gradient in the gradient editor. */
  selectRamp: (path: string | null) => void;
  /** Move the colour stops of one ramp. Colours stay with their stops. */
  setStopPositions: (rampPath: string, positions: number[]) => void;
  setAgentBusy: (busy: boolean) => void;
}



export const useEditor = create<EditorState>((set, get) => {
  /** Record a step and apply it, collapsing the boilerplate at each call site. */
  const commit = (label: string, mutate: (draft: ThemeEdits) => void, origin: 'you' | 'agent' = 'you') => {
    const before = cloneEdits(get().edits);
    const draft = cloneEdits(before);
    draft.byHex ??= {};
    draft.byIndex ??= {};
    draft.alpha ??= {};
    draft.names ??= {};
    mutate(draft);
    set({
      edits: draft,
      undoStack: [...get().undoStack, { label, before, after: draft, origin, at: Date.now() }],
      redoStack: [],
    });
    rememberEdits(get().currentId, draft);
  };

  return {
    files: [],
    aliases: { files: {}, dirs: {} },
    restoreId: null,
    currentId: null,
    original: null,
    slots: [],
    properties: [],
    tree: [],
    palette: [],
    edits: emptyEdits(),
    background: '#FFFFFF',
    checkerboard: false,
    showOriginal: false,
    highlightHex: null,
    highlightKey: null,
    selectedKey: null,
    selectedEffectPath: null,
    selectedKeys: [],
    xray: true,
    includeTransparent: false,
    filterHex: null,
    soloLayerId: null,
    section: 'palette',
    selectedRamp: null,
    roles: [],
    roleOverrides: {},
    audit: [],
    backdrop: '#FFFFFF',
    undoStack: [],
    redoStack: [],
    agentBusy: false,

    setFiles: (files) => set({ files }),

    syncCorpus: (incoming) =>
      set((s) => {
        const current = s.files.filter((f) => f.source === 'local');
        // An unchanged listing must leave the array alone. This runs every few seconds,
        // and handing out a new array each time re-renders everything downstream —
        // including the batch grid, which then restarts rendering seventy previews.
        if (
          current.length === incoming.length &&
          current.every((f, i) => f.id === incoming[i]!.id)
        ) {
          return {};
        }
        const known = new Map(s.files.map((f) => [f.id, f]));
        // A file already opened carries its parsed document; re-listing it must not throw
        // that away, or every poll would make the open file reload from disk.
        const local = incoming.map((f) => known.get(f.id) ?? f);
        return { files: [...local, ...s.files.filter((f) => f.source === 'upload')] };
      }),

    hydrate: () => {
      const work = readWork();
      set({
        aliases: readAliases(),
        restoreId: work.open,
        ...(work.background ? { background: work.background } : {}),
      });
    },

    /** An empty label clears the rename and the real filename comes back. */
    renameFile: (id, label) => {
      const next = { ...get().aliases, files: { ...get().aliases.files } };
      const trimmed = label.trim();
      if (trimmed) next.files[id] = trimmed;
      else delete next.files[id];
      writeAliases(next);
      set({ aliases: next });
    },

    renameFolder: (path, label) => {
      const next = { ...get().aliases, dirs: { ...get().aliases.dirs } };
      const trimmed = label.trim();
      if (trimmed) next.dirs[path] = trimmed;
      else delete next.dirs[path];
      writeAliases(next);
      set({ aliases: next });
    },
    addFiles: (incoming) =>
      set((s) => {
        const seen = new Set(s.files.map((f) => f.id));
        return { files: [...s.files, ...incoming.filter((f) => !seen.has(f.id))] };
      }),

    openFile: (id, doc) => {
      const slots = collectSlots(doc);
      // Whatever was done to this file before the page was last closed. It comes back as
      // the starting state rather than as an undo step: it is not a change someone just
      // made, it is where they left off.
      const work = readWork();
      const saved = work.edits[id]?.edits;
      const edits = saved ? cloneEdits(saved) : emptyEdits();
      const shown = saved ? applyEdits(doc, edits).doc : doc;
      writeWork({ ...work, open: id });
      set({
        currentId: id,
        original: doc,
        slots,
        properties: collectProperties(slots),
        tree: buildLayerTree(shown, slots),
        palette: buildPalette(slots),
        edits,
        undoStack: [],
        redoStack: [],
        highlightHex: null,
        highlightKey: null,
        selectedKey: null,
        selectedEffectPath: null,
        selectedKeys: [],
        filterHex: null,
        soloLayerId: null,
        selectedRamp: null,
        roles: [],
        roleOverrides: {},
        audit: [],
        showOriginal: false,
      });
    },

    setColor: (from, to) =>
      commit(`${from} → ${to}`, (d) => {
        d.byHex![canonicalHex(from)] = canonicalHex(to);
      }),

    setSlotColor: (index, to) =>
      commit(`slot ${index} → ${to}`, (d) => {
        d.byIndex![index] = canonicalHex(to);
      }),

    applyPreset: (name, entries) =>
      commit(`preset “${name}”`, (d) => {
        for (const [from, to] of Object.entries(entries)) {
          d.byHex![canonicalHex(from)] = canonicalHex(to);
        }
      }),

    /** Recolour one editable colour — every slot behind it, since they are one value. */
    setPropertyColor: (key, to) => {
      const property = get().properties.find((p) => p.key === key);
      if (!property) return;
      commit(`${property.hex} → ${to}`, (d) => {
        for (const index of property.slots) d.byIndex![index] = canonicalHex(to);
      });
    },

    /** Replace a gradient's alpha ramp. Keyed by the ramp's path, so it round-trips
     *  through `meta.themeStudio` like every other edit. */
    setAlphaStops: (rampPath, stops) =>
      commit('alpha ramp', (d) => {
        d.alpha![rampPath] = [...stops].sort((a, b) => a.position - b.position);
      }),

    /** Generate the opposite theme as a starting point. The role guesses and the WCAG
     *  audit are kept so the user can see why it chose what it chose, and fix it. */
    suggest: (target) => {
      const { original, slots, properties, roleOverrides, background } = get();
      if (!original) return;
      const backdrop = target === 'light' ? background : '#0E0F12';
      const result = suggestTheme(original, slots, properties, {
        target,
        backdrop,
        overrides: roleOverrides,
      });
      set({ roles: result.roles, audit: result.audit, backdrop });
      commit(`suggest ${target} theme`, (d) => {
        d.byIndex = { ...(d.byIndex ?? {}), ...(result.edits.byIndex ?? {}) };
      });
    },

    /** Merge another edit set in — a preset, or a suggestion. */
    applyEdits: (label, incoming) =>
      commit(label, (d) => Object.assign(d, mergeEdits(d, incoming))),

    applyRemoteEdits: (label, edits, origin) =>
      commit(label, (d) => {
        d.byHex = { ...(edits.byHex ?? {}) };
        d.byIndex = { ...(edits.byIndex ?? {}) };
        d.alpha = { ...(edits.alpha ?? {}) };
        d.positions = { ...(edits.positions ?? {}) };
        d.effects = { ...(edits.effects ?? {}) };
        d.names = { ...(edits.names ?? {}) };
        d.groups = edits.groups ? { ...edits.groups } : d.groups;
        d.images = edits.images ? { ...edits.images } : d.images;
      }, origin),

    createGroup: (name, indices) =>
      commit(`group “${name}”`, (d) => Object.assign(d, setGroup(d, name, indices))),

    dropGroup: (name) => commit(`remove group “${name}”`, (d) => Object.assign(d, removeGroup(d, name))),

    setGroupColor: (name, hex) =>
      commit(`${name} → ${hex}`, (d) => Object.assign(d, colorGroup(d, name, hex))),

    /** Correcting a role re-runs the suggestion — the point is to iterate on the draft. */
    setRole: (key, role) => {
      set({ roleOverrides: { ...get().roleOverrides, [key]: role } });
      if (get().roles.length) get().suggest(get().backdrop === '#0E0F12' ? 'dark' : 'light');
    },

    /** Recoloured or replaced bitmap, stored by asset index so it round-trips with
     *  everything else and undoes the same way. */
    replaceImageAsset: (index, dataUri, size) =>
      commit('image asset', (d) => {
        d.images ??= {};
        d.images[index] = { dataUri, ...(size ?? {}) };
      }),

    /** Layer names go into the edit set, not straight into the document, so a rename
     *  is undoable and travels with the colour map. The tree is rebuilt to show it. */
    renameLayer: (node, name) => {
      const key = node.path.join('.');
      commit(`rename ${node.name ?? node.typeName}`, (d) => {
        const trimmed = name.trim();
        if (trimmed) d.names![key] = trimmed;
        else delete d.names![key];
      });
      const doc = get().original;
      if (doc) set({ tree: buildLayerTree(applyEdits(doc, get().edits).doc, get().slots) });
    },

    resetEdits: () => commit('reset', (d) => {
      d.byHex = {};
      d.byIndex = {};
      d.alpha = {};
      d.positions = {};
      d.effects = {};
      d.names = {};
    }),

    undo: () => {
      const stack = get().undoStack;
      const last = stack[stack.length - 1];
      if (!last) return;
      set({
        edits: last.before,
        undoStack: stack.slice(0, -1),
        redoStack: [...get().redoStack, last],
      });
      rememberEdits(get().currentId, last.before);
      const doc = get().original;
      if (doc) set({ tree: buildLayerTree(applyEdits(doc, last.before).doc, get().slots) });
    },

    redo: () => {
      const stack = get().redoStack;
      const last = stack[stack.length - 1];
      if (!last) return;
      set({
        edits: last.after,
        redoStack: stack.slice(0, -1),
        undoStack: [...get().undoStack, last],
      });
      rememberEdits(get().currentId, last.after);
      const doc = get().original;
      if (doc) set({ tree: buildLayerTree(applyEdits(doc, last.after).doc, get().slots) });
    },

    /** Undo back to the state before step `index`, in one move. The steps in between are
     *  discarded rather than kept for redo: they were built on the change being rejected,
     *  so offering to put them back without it would be offering something untested. */
    undoTo: (index) => {
      const stack = get().undoStack;
      const step = stack[index];
      if (!step) return;
      set({ edits: step.before, undoStack: stack.slice(0, index), redoStack: [] });
      rememberEdits(get().currentId, step.before);
      const doc = get().original;
      if (doc) set({ tree: buildLayerTree(applyEdits(doc, step.before).doc, get().slots) });
    },

    setBackground: (background) => {
      set({ background });
      writeWork({ ...readWork(), background });
    },
    toggleCheckerboard: () => set((s) => ({ checkerboard: !s.checkerboard })),
    toggleShowOriginal: () => set((s) => ({ showOriginal: !s.showOriginal })),
    setHighlight: (hex) => set({ highlightHex: hex }),
    setHighlightKey: (key) => set({ highlightKey: key }),
    selectProperty: (key) => set({ selectedKey: key, highlightKey: key, selectedEffectPath: null }),
    selectEffect: (path) => set({ selectedEffectPath: path, selectedKey: null, highlightKey: null }),
    setEffectColor: (path, to) =>
      commit(`effect → ${to}`, (d) => {
        d.effects = { ...(d.effects ?? {}), [path]: canonicalHex(to) };
      }),
    toggleSelected: (key) =>
      set((s) => ({
        selectedKeys: s.selectedKeys.includes(key)
          ? s.selectedKeys.filter((k) => k !== key)
          : [...s.selectedKeys, key],
      })),
    clearSelection: () => set({ selectedKeys: [] }),
    toggleXray: () => set((s) => ({ xray: !s.xray })),
    toggleIncludeTransparent: () => set((s) => ({ includeTransparent: !s.includeTransparent })),
    setFilterHex: (hex) => set({ filterHex: hex }),
    setSection: (section) => set({ section }),
    selectRamp: (path) => set({ selectedRamp: path, section: path ? 'gradients' : get().section }),

    setStopPositions: (rampPath, positions) =>
      commit('gradient stops', (d) => {
        d.positions = { ...(d.positions ?? {}), [rampPath]: [...positions].sort((a, b) => a - b) };
      }),
    setSoloLayer: (id) => set((s) => ({ soloLayerId: s.soloLayerId === id ? null : id })),
    setAgentBusy: (agentBusy) => set({ agentBusy }),
  };
});

/** The document with the edit set applied. Derived, never stored — one source of truth. */
export function currentDoc(state: Pick<EditorState, 'original' | 'edits'>): unknown | null {
  if (!state.original) return null;
  return applyEdits(state.original, state.edits).doc;
}

/** What a palette row currently maps to. */
export function mappedHex(edits: ThemeEdits, hex: string): string {
  return edits.byHex?.[hex] ?? hex;
}

/**
 * The colour a property renders as right now.
 *
 * A per-slot override wins over the by-hex mapping, which wins over what the file says —
 * the same order `applyEdits` writes them in. Anything on screen that shows "the colour
 * of this element" has to ask this, or it goes on displaying the value the element had
 * before it was changed.
 */
export function propertyHex(edits: ThemeEdits, property: ColorProperty): string {
  for (const index of property.slots) {
    const override = edits.byIndex?.[index];
    if (override) return override;
  }
  return mappedHex(edits, property.hex);
}

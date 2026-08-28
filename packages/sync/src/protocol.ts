import type { ThemeEdits } from '@lottie-theme/core';

/**
 * The wire protocol between the browser and a local agent.
 *
 * What travels is the *edit set*, never the document. An animation runs to megabytes and
 * both sides can already read the file from disk themselves; the edit set is small, and
 * it is the thing both sides genuinely share. It also means an agent's change arrives in
 * the browser as an ordinary edit — the same shape a click produces — so it lands in the
 * same undo stack instead of replacing the document under the user's feet.
 */

export const DEFAULT_PORT = 4319;
export const PROTOCOL_VERSION = 1;

/** What the person has picked in the UI, so an agent can be told "make *this* white". */
export interface Selection {
  /** Property key, the web app's address for one editable colour. */
  key: string | null;
  hex: string | null;
  /** Slot indices behind that colour — the addresses an agent edits by. */
  slots: number[];
  /** Human-readable, straight from the UI: layer name and slot kind. */
  description: string | null;
}

export interface ActivityEntry {
  id: number;
  at: number;
  origin: Role;
  /** Client label, e.g. `agent` or `browser`. */
  by: string;
  label: string;
  /** How many addresses the step touched. */
  count: number;
}

export type Role = 'web' | 'agent';

/** Everything both sides agree on. Broadcast whole after every change: it is a few
 *  kilobytes at worst, and a full state removes every question about ordering. */
export interface Session {
  /** Workspace-relative path of the animation currently open in the browser. */
  path: string | null;
  /** Live, unsaved edit set — what the browser is showing right now. */
  edits: ThemeEdits;
  selection: Selection;
  activity: ActivityEntry[];
  /** Bumped on every change, so a client can tell a real update from a re-send. */
  revision: number;
}

export const emptySelection = (): Selection => ({ key: null, hex: null, slots: [], description: null });

export type ClientMessage =
  | { type: 'hello'; role: Role; name?: string }
  /** The browser opened a file; the edit set starts over. */
  | { type: 'open'; path: string; edits?: ThemeEdits }
  /** Merge these edits into the session. `replace` sends the whole set instead — that is
   *  what an undo in the browser produces, and it cannot be expressed as a merge. */
  | { type: 'edits'; label: string; edits: ThemeEdits; replace?: boolean }
  | { type: 'selection'; selection: Selection }
  /** Write the animation with the session's edits applied. */
  | { type: 'save'; out?: string; embed?: boolean }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'welcome'; clientId: string; root: string; protocol: number; session: Session }
  /** `by` is the client that caused it — everyone else acts on it, the author ignores it. */
  | { type: 'session'; session: Session; by: string; origin: Role | null; label: string | null }
  /** The file changed on disk under us: someone edited the JSON by hand, or an agent
   *  wrote it without going through the session. */
  | { type: 'file-changed'; path: string }
  | { type: 'saved'; path: string; colorsChanged: number; rampsChanged: number }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export function parseMessage<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

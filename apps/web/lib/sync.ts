'use client';

import { useEffect, useState } from 'react';
import { describeSlot, isEmptyEdits, type ThemeEdits } from '@lottie-theme/core';
import type { ClientMessage, ServerMessage, Selection } from '@lottie-theme/sync/protocol';
import { useEditor } from './store';

/**
 * The browser's end of the live bridge to a local agent (ROADMAP §6.3).
 *
 * Development only, and entirely optional: the hub is a program the user starts in a
 * folder on their own machine. When it is not there this module connects to nothing and
 * the editor behaves exactly as it does in the shipped static build, where no socket is
 * ever opened at all.
 *
 * What crosses the wire is the edit set, never the animation. An agent's change therefore
 * arrives as an ordinary edit and lands in the same undo stack as a click, which is the
 * only way "undo works the same for both" can be true rather than aspirational.
 */

const HUB = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://127.0.0.1:4319';
const enabled = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SYNC !== 'off';

export interface SyncStatus {
  connected: boolean;
  root: string | null;
  /** Files that changed on disk while we had them open. */
  changedOnDisk: string[];
  lastSaved: { path: string; colorsChanged: number } | null;
  error: string | null;
}

type Listener = (status: SyncStatus) => void;

class SyncBridge {
  private socket: WebSocket | null = null;
  private clientId: string | null = null;
  private listeners = new Set<Listener>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  /** One connect attempt at a time: the hook runs in more than one component, and React
   *  mounts effects twice in development, so four callers would mean four probes. */
  private connecting = false;
  /** Grows while nothing is listening. The hub is something a person starts deliberately;
   *  polling every four seconds forever is a request per second in the network log for a
   *  feature that may never be used. */
  private backoff = 2000;
  private unsubscribe: (() => void) | null = null;
  /** Set while an incoming edit is being written into the store, so the store subscription
   *  it wakes does not send the agent's own change straight back to it. */
  private applying = false;
  status: SyncStatus = { connected: false, root: null, changedOnDisk: [], lastSaved: null, error: null };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }

  /**
   * Open a socket only once something is listening.
   *
   * The browser logs every refused connection itself, so attempting the socket blindly
   * fills a developer's console with errors about a feature they may not be using. The
   * dev server can ask the hub quietly on our behalf; we connect on a yes and poll on a no.
   */
  async connect() {
    if (!enabled || this.socket || this.connecting) return;
    this.connecting = true;
    let running = false;
    try {
      const response = await fetch('/api/local?sync=1');
      running = response.ok && ((await response.json()) as { running: boolean }).running;
    } catch {
      running = false;
    } finally {
      this.connecting = false;
    }
    if (!running) {
      this.scheduleRetry();
      return;
    }
    this.backoff = 2000;

    let socket: WebSocket;
    try {
      socket = new WebSocket(HUB);
    } catch {
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.send({ type: 'hello', role: 'web', name: 'browser' });
      const { currentId, edits } = useEditor.getState();
      if (currentId) this.send({ type: 'open', path: currentId, edits });
      this.watchStore();
    };

    socket.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage);

    socket.onclose = () => {
      this.socket = null;
      this.clientId = null;
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.update({ connected: false, root: null });
      // Retry quietly: the usual reason is that the hub has not been started yet, and the
      // usual fix is starting it — the page should pick that up without a reload.
      this.scheduleRetry();
    };

    // Only interesting as a route to onclose; a failed connection to a program the user
    // may simply not be running is not an error worth reporting.
    socket.onerror = () => {};
  }

  /** Look again later, less and less often, and never while the tab is in the background. */
  private scheduleRetry() {
    if (this.retry) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.retry = setTimeout(() => {
      this.retry = null;
      if (typeof document !== 'undefined' && document.hidden) {
        // Nobody is looking; wait for the tab to come back rather than polling behind it.
        document.addEventListener('visibilitychange', () => void this.connect(), { once: true });
        return;
      }
      void this.connect();
    }, delay);
  }

  private receive(message: ServerMessage) {
    switch (message.type) {
      case 'welcome':
        this.clientId = message.clientId;
        this.update({ connected: true, root: message.root, error: null });
        return;

      case 'session': {
        // Our own changes come back to us; applying them again would be a loop.
        if (message.by === this.clientId) return;
        this.applying = true;
        try {
          // Another browser window on the same session is still the same person; only an
          // agent's step is worth marking as not theirs.
          useEditor
            .getState()
            .applyRemoteEdits(
              message.label ?? 'edit',
              message.session.edits,
              message.origin === 'agent' ? 'agent' : 'you',
            );
        } finally {
          this.applying = false;
        }
        return;
      }

      case 'file-changed': {
        const { currentId } = useEditor.getState();
        if (message.path !== currentId) return;
        if (this.status.changedOnDisk.includes(message.path)) return;
        this.update({ changedOnDisk: [...this.status.changedOnDisk, message.path] });
        return;
      }

      case 'saved':
        this.update({
          lastSaved: { path: message.path, colorsChanged: message.colorsChanged },
          // Saving is what the file on disk was waiting for; the warning has served its purpose.
          changedOnDisk: this.status.changedOnDisk.filter((p) => p !== message.path),
        });
        return;

      case 'error':
        this.update({ error: message.message });
        return;
    }
  }

  /** Mirror local edits, the open file and the selection into the session. */
  private watchStore() {
    let lastId = useEditor.getState().currentId;
    let lastEdits = useEditor.getState().edits;
    let lastKey = useEditor.getState().selectedKey;

    this.unsubscribe = useEditor.subscribe((state) => {
      if (state.currentId !== lastId) {
        lastId = state.currentId;
        lastEdits = state.edits;
        if (state.currentId) this.send({ type: 'open', path: state.currentId, edits: state.edits });
      } else if (state.edits !== lastEdits) {
        lastEdits = state.edits;
        // Always the whole set: an undo is not expressible as a merge, and the set is
        // small enough that distinguishing the two cases would be false economy.
        if (!this.applying) {
          this.send({ type: 'edits', label: describe(state.edits), edits: state.edits, replace: true });
        }
      }
      if (state.selectedKey !== lastKey) {
        lastKey = state.selectedKey;
        this.send({ type: 'selection', selection: selectionOf(state) });
      }
    });
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  save() {
    this.send({ type: 'save' });
  }

  dismissChange(path: string) {
    this.update({ changedOnDisk: this.status.changedOnDisk.filter((p) => p !== path) });
  }
}

/** What the last step did, in the words the activity list will show. */
function describe(edits: ThemeEdits): string {
  if (isEmptyEdits(edits)) return 'cleared';
  const { undoStack } = useEditor.getState();
  return undoStack[undoStack.length - 1]?.label ?? 'edit';
}

function selectionOf(state: ReturnType<typeof useEditor.getState>): Selection {
  const property = state.properties.find((p) => p.key === state.selectedKey);
  if (!property) return { key: null, hex: null, slots: [], description: null };
  // The same sentence the slot panel shows the user, so both sides of the conversation
  // are naming the thing identically.
  const slot = state.slots.find((s) => s.index === property.slots[0]);
  return {
    key: property.key,
    hex: property.hex,
    slots: property.slots,
    description: slot ? describeSlot(slot) : property.kind,
  };
}

export const bridge = new SyncBridge();

export function useSync(): SyncStatus {
  const [status, setStatus] = useState(bridge.status);
  useEffect(() => {
    void bridge.connect();
    return bridge.subscribe(setStatus);
  }, []);
  return status;
}

export const syncEnabled = enabled;

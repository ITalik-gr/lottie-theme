'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A panel the user can widen, within limits.
 *
 * The bounds are not decoration. Below the minimum the palette rows and the agent's
 * conversation stop being readable; above the maximum the canvas — which is what the work
 * is judged on — is squeezed for a panel of controls. So the handle is free to move and
 * the result is always a width the panel actually works at.
 */
export interface Resizable {
  width: number;
  /** Spread onto the drag handle. */
  handle: {
    onPointerDown: (event: React.PointerEvent) => void;
    onDoubleClick: () => void;
  };
  dragging: boolean;
}

export function useResizablePanel({
  storageKey,
  initial,
  min,
  max,
  /** Which way the panel grows: a right-hand panel gets wider as the pointer moves left. */
  edge = 'left',
}: {
  storageKey: string;
  initial: number;
  min: number;
  max: number;
  edge?: 'left' | 'right';
}): Resizable {
  const [width, setWidth] = useState(initial);
  const [dragging, setDragging] = useState(false);
  /** The current width readable from inside a listener, without the listener having to be
   *  rebuilt every time the width changes. */
  const latest = useRef(initial);
  latest.current = width;

  // Read after mount, never while rendering: the page is prerendered, and a width out of
  // localStorage would not match what the server wrote.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) setWidth(Math.min(max, Math.max(min, saved)));
    } catch {
      // private browsing: the panel is simply its default width every time
    }
  }, [storageKey, min, max]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();

      const startX = event.clientX;
      const from = latest.current;

      // Bound here rather than in an effect keyed on a `dragging` flag. An effect only
      // runs after React has committed the render, and a quick drag can be over — down,
      // move, up — before that happens: the moves land with nothing listening and the
      // panel never resizes. Attaching them on the spot has no such window.
      const move = (moved: PointerEvent) => {
        const delta = edge === 'left' ? startX - moved.clientX : moved.clientX - startX;
        setWidth(Math.min(max, Math.max(min, from + delta)));
      };

      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        setDragging(false);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      // Text selects across the whole page during a drag otherwise, which looks like a bug.
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      setDragging(true);
    },
    [edge, min, max],
  );

  // Written when the drag ends rather than on every frame: this is a pointermove handler.
  useEffect(() => {
    if (dragging) return;
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      // as above
    }
  }, [dragging, width, storageKey]);

  return {
    width,
    dragging,
    handle: { onPointerDown, onDoubleClick: () => setWidth(initial) },
  };
}

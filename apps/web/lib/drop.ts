'use client';

import { useCallback, useRef, useState } from 'react';
import { filesFromInput, rejectionMessage } from './files';
import { useEditor } from './store';

/**
 * Taking a dropped animation, wherever it lands.
 *
 * The file tree had this and the canvas did not, which made the canvas's own "drop a Lottie
 * here" a lie. Both use this now, so a drop behaves the same over either.
 *
 * `dragenter`/`dragleave` fire for every child element the pointer crosses, so the flag is
 * kept as a depth count rather than a boolean — otherwise moving over the text inside the
 * drop target reads as having left it, and the highlight flickers.
 */
export function useLottieDrop() {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0);

  const addFiles = useEditor((s) => s.addFiles);
  const openFile = useEditor((s) => s.openFile);

  const reset = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      // Only file drags. A text selection dragged across the canvas is not a file.
      if (!e.dataTransfer.types.includes('Files')) return;
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault();
      reset();
      setError(null);
      const { files, rejected } = await filesFromInput(e.dataTransfer.files);
      setError(rejectionMessage(rejected));
      if (!files.length) return;
      addFiles(files);
      // Opening the first one is the point of the drop. Landing on a file already open is
      // not a reason to skip it — `openFile` restores its saved edits either way.
      openFile(files[0]!.id, files[0]!.doc);
    },
  };

  return { dragging, error, clearError: () => setError(null), handlers };
}

'use client';

import { useEffect } from 'react';
import { useEditor } from './store';

/**
 * Ask before leaving with work that is only in this tab.
 *
 * The edit set survives a reload in localStorage, but the dropped document does not: reload
 * with a file that came from a drop and the edits come back with nothing to apply them to.
 * Until that is fixed the honest thing is to ask. An agent mid-run is worth asking about
 * regardless — the request is already billed and the answer is thrown away.
 *
 * The browser shows its own wording; `preventDefault` is the whole of the API, and the
 * string a page returns has been ignored for years.
 */
export function useUnloadGuard() {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const { undoStack, agentBusy } = useEditor.getState();
      if (!undoStack.length && !agentBusy) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}

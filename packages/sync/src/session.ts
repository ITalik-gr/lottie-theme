import { cloneEdits, countEdits, emptyEdits, mergeEdits, type ThemeEdits } from '@lottie-theme/core';
import { emptySelection, type ActivityEntry, type ClientMessage, type Role, type Session } from './protocol.ts';

/**
 * The shared session as a pure reducer.
 *
 * Kept free of sockets and the filesystem so the interesting part — what happens when two
 * sides edit the same thing — is testable without starting a server.
 */

const ACTIVITY_LIMIT = 100;

export function emptySession(): Session {
  return { path: null, edits: emptyEdits(), selection: emptySelection(), activity: [], revision: 0 };
}

export interface Applied {
  session: Session;
  /** What to tell the other side this was, or null when nothing worth announcing changed. */
  label: string | null;
}

export function reduce(
  session: Session,
  message: ClientMessage,
  from: { role: Role; name: string },
): Applied {
  switch (message.type) {
    case 'open': {
      // A different file is a different session: carrying edits across would silently
      // apply one animation's colour map to another's slot indices.
      if (message.path === session.path && !message.edits) return { session, label: null };
      return {
        session: {
          path: message.path,
          edits: message.edits ? cloneEdits(message.edits) : emptyEdits(),
          selection: emptySelection(),
          activity: [],
          revision: session.revision + 1,
        },
        label: `open ${message.path}`,
      };
    }

    case 'edits': {
      const edits = message.replace
        ? cloneEdits(message.edits)
        : mergeEdits(session.edits, message.edits);
      return {
        session: {
          ...session,
          edits,
          activity: push(session.activity, {
            id: session.revision + 1,
            at: Date.now(),
            origin: from.role,
            by: from.name,
            label: message.label,
            count: countEdits(message.edits),
          }),
          revision: session.revision + 1,
        },
        label: message.label,
      };
    }

    case 'selection':
      return {
        session: { ...session, selection: message.selection, revision: session.revision + 1 },
        label: null,
      };

    default:
      return { session, label: null };
  }
}

function push(activity: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  const next = [...activity, entry];
  return next.length > ACTIVITY_LIMIT ? next.slice(next.length - ACTIVITY_LIMIT) : next;
}

/** The session's edits, for a client that wants them without the bookkeeping. */
export function sessionEdits(session: Session): ThemeEdits {
  return cloneEdits(session.edits);
}

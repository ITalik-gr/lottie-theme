'use client';

import type { LoadedFile } from './store';

/** A file that was handed over but could not be used, and why. Reported rather than
 *  skipped: a drop that appears to do nothing reads as the drop target being broken. */
export interface RejectedFile {
  name: string;
  reason: string;
}

export interface ReadResult {
  files: LoadedFile[];
  rejected: RejectedFile[];
}

/**
 * A short hash of the file's contents, so two files can share a name and still be two files.
 *
 * FNV-1a rather than SubtleCrypto: this has to run for every file of a folder drop, the
 * async API would make the whole read await per file, and the only thing being asked is
 * whether two documents are the same one. Collisions cost a wrongly shared edit set, not a
 * corrupted file.
 */
function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Files the user dropped or picked. They stay in the browser — nothing is uploaded. */
export async function filesFromInput(list: FileList | File[]): Promise<ReadResult> {
  const files: LoadedFile[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of Array.from(list)) {
    if (!file.name.toLowerCase().endsWith('.json')) {
      rejected.push({ name: file.name, reason: 'not a .json file' });
      continue;
    }
    // `webkitRelativePath` is set when the user picked a folder, empty for a plain drop.
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    let doc: unknown;
    let text: string;
    try {
      text = await file.text();
      doc = JSON.parse(text);
    } catch {
      // One unreadable file must not take the rest of the drop down with it.
      rejected.push({ name: file.name, reason: 'not valid JSON' });
      continue;
    }
    files.push({
      // The hash is what lets two `data.json` files coexist. It also means the same file
      // dropped again is the same id, which is how it finds the edits made to it last time
      // instead of coming back blank.
      id: `upload:${rel}#${contentHash(text)}`,
      name: file.name,
      dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : 'dropped files',
      source: 'upload',
      doc,
    });
  }

  return { files, rejected };
}

/** One sentence covering everything a drop refused, for the panel to show. */
export function rejectionMessage(rejected: readonly RejectedFile[]): string | null {
  if (!rejected.length) return null;
  if (rejected.length === 1) return `${rejected[0]!.name}: ${rejected[0]!.reason}`;
  return `${rejected.length} files ignored — ${rejected.map((r) => r.name).join(', ')}`;
}

/** Dev-only listing of the repository's `lotties/` folder. Silently yields nothing
 *  in a production build, where the route does not exist. */
export async function localCorpus(): Promise<LoadedFile[]> {
  try {
    const res = await fetch('/api/local');
    if (!res.ok) return [];
    const { files } = (await res.json()) as { files: string[] };
    return files.map((path) => ({
      id: path,
      name: path.slice(path.lastIndexOf('/') + 1),
      dir: path.slice(0, path.lastIndexOf('/')),
      source: 'local' as const,
    }));
  } catch {
    return [];
  }
}

export async function loadLocal(path: string): Promise<unknown> {
  const res = await fetch(`/api/local?file=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`cannot read ${path}`);
  return res.json();
}

// Downloads live in lib/export.ts — this module only reads files in.

'use client';

import type { LoadedFile } from './store';

/** Files the user dropped or picked. They stay in the browser — nothing is uploaded. */
export async function filesFromInput(list: FileList | File[]): Promise<LoadedFile[]> {
  const out: LoadedFile[] = [];
  for (const file of Array.from(list)) {
    if (!file.name.endsWith('.json')) continue;
    // `webkitRelativePath` is set when the user picked a folder, empty for a plain drop.
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    out.push({
      id: `upload:${rel}`,
      name: file.name,
      dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : 'dropped files',
      source: 'upload',
      doc: JSON.parse(await file.text()),
    });
  }
  return out;
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

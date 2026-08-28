'use client';

import { zipSync, strToU8 } from 'fflate';
import { applyEdits, embedEdits, type ThemeEdits } from '@lottie-theme/core';

/** How the edit set travels with the exported file. */
export type MetadataMode =
  /** Inside the animation, under `meta.themeStudio`. Players ignore unknown fields, so
   *  the file works normally and carries its own names, groups and colour map. */
  | 'embed'
  /** Beside it as `<name>.theme.json`, for when the Lottie is regenerated from AE and
   *  must stay clean. */
  | 'sidecar'
  | 'none';

export interface ExportOptions {
  metadata: MetadataMode;
  /** Drop whitespace. Lottie files are mostly numbers, so this is a real saving. */
  minify?: boolean;
}

export function buildDocument(original: unknown, edits: ThemeEdits, options: ExportOptions): unknown {
  const doc = applyEdits(original, edits).doc;
  if (options.metadata === 'embed') embedEdits(doc, edits);
  return doc;
}

export function serialize(doc: unknown, minify = true): string {
  return minify ? JSON.stringify(doc) : JSON.stringify(doc, null, 2);
}

function download(bytes: string | Uint8Array, filename: string, type: string): void {
  // fflate types its output as Uint8Array<ArrayBufferLike>; Blob wants a plain ArrayBuffer.
  const part: BlobPart = typeof bytes === 'string' ? bytes : new Uint8Array(bytes).slice().buffer;
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // The anchor has to be in the document, and the object URL has to outlive the click:
  // revoking it in the same tick cancels the download before it starts.
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
}

export function downloadJson(doc: unknown, filename: string, minify = true): void {
  download(serialize(doc, minify), filename, 'application/json');
}

export function downloadSidecar(edits: ThemeEdits, filename: string): void {
  download(JSON.stringify(edits, null, 2), filename, 'application/json');
}

/** dotLottie is a ZIP: a manifest plus the animations it names. */
export function buildDotLottie(entries: { id: string; doc: unknown }[], minify = true): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(
      JSON.stringify({
        version: '1.0.0',
        generator: 'lottie-theme-studio',
        animations: entries.map((e) => ({ id: e.id })),
      }),
    ),
  };
  for (const entry of entries) {
    files[`animations/${entry.id}.json`] = strToU8(serialize(entry.doc, minify));
  }
  return zipSync(files, { level: 9 });
}

export function downloadDotLottie(entries: { id: string; doc: unknown }[], filename: string, minify = true): void {
  download(buildDotLottie(entries, minify), filename, 'application/zip');
}

/** A plain ZIP of JSON files, keeping the folder layout the sources came from. */
export function downloadZip(
  entries: { path: string; doc: unknown; edits?: ThemeEdits }[],
  filename: string,
  minify = true,
): void {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    files[entry.path] = strToU8(serialize(entry.doc, minify));
    if (entry.edits) {
      files[entry.path.replace(/\.json$/, '.theme.json')] = strToU8(JSON.stringify(entry.edits, null, 2));
    }
  }
  download(zipSync(files, { level: 9 }), filename, 'application/zip');
}

/** Safe id for a dotLottie entry: the format keys animations by this string. */
export function assetId(path: string): string {
  return (path.split('/').pop() ?? 'animation').replace(/\.json$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

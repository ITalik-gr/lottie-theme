'use client';

import type { ThemeEdits } from '@lottie-theme/core';

/** Named mapping presets. Kept in localStorage: no accounts, no backend, and sharing is
 *  export/import of the same JSON the app uses internally. */
export interface Preset {
  name: string;
  description?: string;
  edits: ThemeEdits;
  /** Absent for the built-ins. */
  builtIn?: boolean;
}

const KEY = 'lottie-theme-studio:presets';

export const BUILT_IN: Preset[] = [
  {
    name: 'dark → light (base)',
    description: 'Derived from the project corpus: surfaces flip, the green accent darkens.',
    builtIn: true,
    edits: {
      version: 1,
      byHex: {
        '#17181D': '#FFFFFF',
        '#08090C': '#E3E6EF',
        '#000000': '#FFFFFF',
        '#24252A': '#F6F8FF',
        '#FFFFFF': '#17181D',
        '#9E9EA1': '#B2B5C1',
        '#BDBDBD': '#B2B5C1',
        '#38E887': '#008934',
        '#4C6EFC': '#4D6DFC',
      },
    },
  },
];

export function loadPresets(): Preset[] {
  if (typeof localStorage === 'undefined') return BUILT_IN;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Preset[];
    return [...BUILT_IN, ...stored.filter((p) => p && typeof p.name === 'string' && p.edits)];
  } catch {
    return BUILT_IN;
  }
}

function saveUserPresets(presets: Preset[]): void {
  localStorage.setItem(KEY, JSON.stringify(presets.filter((p) => !p.builtIn)));
}

export function savePreset(name: string, edits: ThemeEdits): Preset[] {
  const trimmed = name.trim();
  if (!trimmed) return loadPresets();
  const next = loadPresets().filter((p) => p.builtIn || p.name !== trimmed);
  next.push({ name: trimmed, edits });
  saveUserPresets(next);
  return loadPresets();
}

export function deletePreset(name: string): Preset[] {
  saveUserPresets(loadPresets().filter((p) => p.name !== name));
  return loadPresets();
}

export function importPresets(json: string): Preset[] {
  const parsed = JSON.parse(json) as Preset | Preset[];
  const incoming = (Array.isArray(parsed) ? parsed : [parsed]).filter((p) => p?.name && p.edits);
  const next = loadPresets().filter((p) => !incoming.some((i) => i.name === p.name));
  saveUserPresets([...next, ...incoming.map((p) => ({ ...p, builtIn: false }))]);
  return loadPresets();
}

export function exportPresets(): string {
  return JSON.stringify(loadPresets().filter((p) => !p.builtIn), null, 2);
}

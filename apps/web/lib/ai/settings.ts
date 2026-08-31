'use client';

import type Anthropic from '@anthropic-ai/sdk';

/**
 * What the agent runs as, and the key it runs on.
 *
 * All of it is kept in this browser and sent only to the provider, straight from the page.
 * There is no backend to send it to — the whole app is static files — which is also why
 * there is no account and nothing to trust us with.
 */

const KEYS = {
  apiKey: 'lottie-theme-studio:anthropic-key',
  model: 'lottie-theme-studio:model',
  effort: 'lottie-theme-studio:effort',
  baseUrl: 'lottie-theme-studio:base-url',
  ceiling: 'lottie-theme-studio:ceiling',
} as const;

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(key, trimmed);
    else localStorage.removeItem(key);
  } catch {
    // private browsing, or a full quota: the setting simply does not outlive the tab
  }
}

export interface ModelInfo {
  id: string;
  label: string;
  /** Dollars per million tokens. */
  input: number;
  output: number;
  /** Why you would pick this one, in the words the panel shows. */
  note: string;
}

/**
 * The models offered.
 *
 * Prices are per model, which is the whole reason this is a table rather than a constant:
 * the old readout multiplied everything by one hardcoded pair and was wrong the moment the
 * model was not Opus.
 */
export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5', label: 'Opus 5', input: 5, output: 25, note: 'best at the hard cases — gradients, mattes' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', input: 2, output: 10, note: 'most recolouring, at 40% of the price' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', input: 1, output: 5, note: 'simple palette swaps' },
];

export const DEFAULT_MODEL = MODELS[0]!.id;

export function modelInfo(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}

/**
 * How hard the model works before answering.
 *
 * The lever worth reaching for before changing model: routine recolouring does not need
 * the depth that a gradient fading into the backdrop does, and it is billed by the token.
 */
export type Effort = 'low' | 'medium' | 'high';

export const EFFORTS: { id: Effort; label: string; note: string }[] = [
  { id: 'low', label: 'low', note: 'one pass, few tool calls' },
  { id: 'medium', label: 'medium', note: 'checks its own work' },
  { id: 'high', label: 'high', note: 'for animations that fight back' },
];

/** Dollars one instruction may spend before stopping to ask. */
export const DEFAULT_CEILING = 0.5;

export interface Settings {
  apiKey: string;
  model: string;
  effort: Effort;
  /** An alternative endpoint — a gateway or a proxy. Empty means Anthropic directly. */
  baseUrl: string;
  ceiling: number;
}

export function readSettings(): Settings {
  const effort = read(KEYS.effort) as Effort;
  const ceiling = Number(read(KEYS.ceiling));
  return {
    apiKey: read(KEYS.apiKey),
    model: read(KEYS.model) || DEFAULT_MODEL,
    effort: EFFORTS.some((e) => e.id === effort) ? effort : 'medium',
    baseUrl: read(KEYS.baseUrl),
    ceiling: Number.isFinite(ceiling) && ceiling > 0 ? ceiling : DEFAULT_CEILING,
  };
}

export function writeSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  write(KEYS[key], String(value));
}

/** Writing a prefix into the cache costs a quarter more than sending it once; reading it
 *  back costs a tenth. Both are what makes a tool loop affordable, and both were missing
 *  from the old estimate, which is why the number on screen was a fraction of the bill. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface Spend {
  cost: number;
  input: number;
  output: number;
  cached: number;
}

/**
 * What one response cost, counting every class of input token.
 *
 * `usage.input_tokens` is only the *uncached* part. A loop that caches its prefix reports
 * almost nothing there and everything under `cache_read_input_tokens`, so adding up
 * `input_tokens` alone reads as free right up until the invoice.
 */
export function measure(usage: Anthropic.Beta.BetaUsage, model: string): Spend {
  const price = modelInfo(model);
  const perInputToken = price.input / 1e6;
  const written = usage.cache_creation_input_tokens ?? 0;
  const read_ = usage.cache_read_input_tokens ?? 0;
  return {
    cost:
      usage.input_tokens * perInputToken +
      written * perInputToken * CACHE_WRITE_MULTIPLIER +
      read_ * perInputToken * CACHE_READ_MULTIPLIER +
      usage.output_tokens * (price.output / 1e6),
    input: usage.input_tokens + written + read_,
    output: usage.output_tokens,
    cached: read_,
  };
}

'use client';

import type Anthropic from '@anthropic-ai/sdk';

/**
 * The user's own API key.
 *
 * Kept in this browser and sent only to the provider, straight from the page. There is no
 * backend to send it to — the whole app is static files — which is also why there is no
 * account and nothing to trust us with.
 */
const KEY = 'lottie-theme-studio:anthropic-key';

export function readApiKey(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeApiKey(value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(KEY, trimmed);
    else localStorage.removeItem(KEY);
  } catch {
    // private browsing: the key simply does not persist between reloads
  }
}

export interface ModelPricing {
  /** Dollars per million tokens. */
  input: number;
  output: number;
}

/** Prices are per model, so the readout cannot be right with one hardcoded pair. */
export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export const DEFAULT_MODEL = 'claude-opus-5';

/** Writing a prefix into the cache costs a quarter more than sending it once; reading it
 *  back costs a tenth. Both are what makes a tool loop affordable, and both were missing
 *  from the old estimate, which is why the number on screen was a fraction of the bill. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/**
 * What one response cost, counting every class of input token.
 *
 * `usage.input_tokens` is only the *uncached* part. A loop that caches its prefix reports
 * almost nothing there and everything under `cache_read_input_tokens`, so adding up
 * `input_tokens` alone reads as free right up until the invoice.
 */
export function estimateCost(usage: Anthropic.Beta.BetaUsage, model: string): number {
  const price = PRICING[model] ?? PRICING[DEFAULT_MODEL]!;
  const perInputToken = price.input / 1e6;
  return (
    usage.input_tokens * perInputToken +
    (usage.cache_creation_input_tokens ?? 0) * perInputToken * CACHE_WRITE_MULTIPLIER +
    (usage.cache_read_input_tokens ?? 0) * perInputToken * CACHE_READ_MULTIPLIER +
    usage.output_tokens * (price.output / 1e6)
  );
}

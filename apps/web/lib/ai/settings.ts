'use client';

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

/** Rough spend estimate, so a user with their own key can see what a turn cost. */
export const PRICING = { inputPerMTok: 5, outputPerMTok: 25 };

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1e6) * PRICING.inputPerMTok + (outputTokens / 1e6) * PRICING.outputPerMTok;
}

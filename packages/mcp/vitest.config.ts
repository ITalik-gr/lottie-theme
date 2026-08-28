import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Launching Chrome and rendering is slower than a unit test.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

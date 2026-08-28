import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Real sockets and a filesystem watcher: slower than a unit test, still not slow.
    testTimeout: 20_000,
  },
});

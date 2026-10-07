import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
    // vi.stubEnv changes are rolled back after every test.
    unstubEnvs: true,
    coverage: {
      enabled: false,
    },
  },
});

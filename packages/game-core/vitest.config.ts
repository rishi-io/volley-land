import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source, not a possibly stale dist/.
export default defineConfig({
  resolve: { conditions: ['@volleyland/source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['@volleyland/source', ...defaultServerConditions] } },
  test: { include: ['src/**/*.test.ts'] },
});

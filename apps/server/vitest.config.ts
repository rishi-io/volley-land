import swc from 'unplugin-swc';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) so Nest's constructor injection gets decorator metadata in tests.
// Workspace packages resolve to their TypeScript source, not a possibly stale dist/.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: { conditions: ['@volleyland/source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['@volleyland/source', ...defaultServerConditions] } },
  test: { include: ['src/**/*.test.ts'] },
});

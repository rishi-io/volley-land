import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Trace from the monorepo root so the standalone bundle includes workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  reactStrictMode: true,
  transpilePackages: ['@volleyland/contracts', '@volleyland/game-core'],
};

export default nextConfig;

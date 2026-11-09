import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Monorepo: trace files from the workspace root so standalone output includes workspace packages.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // @hilatech/ui is consumed as TypeScript source; @hilatech/contracts ships ESM+CJS.
  transpilePackages: ['@hilatech/ui'],
  // Linting runs through the dedicated `lint` script (ESLint 9 flat config); skip the legacy build-time pass.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ['lucide-react', '@hilatech/ui'],
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ],
};

export default nextConfig;

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Content-Security-Policy for every page.
 *
 * Scripts and styles still allow 'unsafe-inline': Next.js injects inline bootstrap/hydration scripts
 * and the theme script, and a nonce-based policy would force every page to render dynamically. The
 * policy therefore does NOT stop inline-script XSS on its own; it restricts where code, frames,
 * forms and network calls can go (no third-party script hosts, no framing, no plugin content).
 * 'unsafe-eval' is only present in development (React refresh).
 */
function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV === 'development';
  const apiOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_API_URL ?? '').origin;
    } catch {
      return '';
    }
  })();
  const connect = ["'self'", apiOrigin, isDev ? 'ws:' : ''].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Avatars and organization logos are user-supplied https URLs.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

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
        { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ],
};

export default nextConfig;

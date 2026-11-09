import next from '@hilatech/config/eslint/next.js';
import nextPlugin from '@next/eslint-plugin-next';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '.next/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'next.config.ts',
      'postcss.config.mjs',
      'vitest.config.ts',
      'vitest.setup.ts',
      'playwright.config.ts',
    ],
  },
  ...next,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
];

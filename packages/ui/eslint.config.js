import next from '@hilatech/config/eslint/next.js';

/** @type {import('eslint').Linter.Config[]} */
export default [...next, { ignores: ['vitest.config.ts', 'vitest.setup.ts'] }];

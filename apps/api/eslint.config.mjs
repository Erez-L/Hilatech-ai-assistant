import nest from '@hilatech/config/eslint/nest.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...nest,
  {
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

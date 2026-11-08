import nest from '@hilatech/config/eslint/nest.js';

/** @type {import('eslint').Linter.Config[]} */
export default [...nest, { ignores: ['jest.config.cjs', 'jest.integration.config.cjs'] }];

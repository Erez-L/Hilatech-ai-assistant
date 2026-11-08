/** Integration tests: test/**\/*.int-spec.ts — need Redis and the hilatech_test database. */
const base = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.int-spec.ts'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 60_000,
  collectCoverageFrom: undefined,
};

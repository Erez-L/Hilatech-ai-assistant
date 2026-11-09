import type { Config } from 'jest';

const config: Config = {
  displayName: 'api:integration',
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
  transform: { '^.+\\.ts$': ['@swc/jest', {}] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  testTimeout: 30_000,
  maxWorkers: 1,
  clearMocks: true,
  coverageDirectory: 'coverage/integration',
};

export default config;

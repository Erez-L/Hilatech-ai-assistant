import type { Config } from 'jest';

const config: Config = {
  displayName: 'api:unit',
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['@swc/jest', {}] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  coverageDirectory: 'coverage/unit',
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts', '!src/**/index.ts'],
};

export default config;

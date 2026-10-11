/**
 * HTTP integration checks (`npm run test:integration`): the production Next app (`next build` + `next start`) against
 * the synthetic data agent in __tests__/integration. Separate from `npm test`, whose config matches only *.test.ts(x).
 */
const base = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testMatch: ['<rootDir>/__tests__/integration/**/*.integration.ts'],
  globalSetup: '<rootDir>/__tests__/integration/global-setup.ts',
  // Covers a server start plus the app's 3 s upstream deadline; each step has its own tighter bound.
  testTimeout: 90_000,
};

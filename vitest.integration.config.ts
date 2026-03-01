import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['tests/**/*.int.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
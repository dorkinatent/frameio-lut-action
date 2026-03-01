import { vi } from 'vitest';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY = 'false';

// Mock timers if needed
// vi.useFakeTimers();

// Global test utilities
global.testUtils = {
  generateUUID: () => '123e4567-e89b-12d3-a456-426614174000',
  generateTimestamp: () => Math.floor(Date.now() / 1000),
};

// Cleanup after all tests
afterAll(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
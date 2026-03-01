import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config();

const envSchema = z.object({
  // Server Configuration
  PORT: z.string().default('8080').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // File Processing
  TMP_DIR: z.string().default('/tmp/archon-lut'),
  MAX_INPUT_GB: z.string().default('25').transform((val) => parseInt(val, 10)),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  
  // Processing Mode - 'local' downloads files locally, 'remote' uses Frame.io CDN URLs
  PROCESSING_MODE: z.enum(['local', 'remote']).default('local'),

  // Frame.io API Configuration
  FRAMEIO_BASE_URL: z.string().url().default('https://api.frame.io/v4'),
  
  // Direct Access Token (for custom actions in Railway)
  FRAMEIO_ACCESS_TOKEN: z.string().optional(),

  // User OAuth Configuration (optional)
  FRAMEIO_CLIENT_ID: z.string().optional(),
  FRAMEIO_CLIENT_SECRET: z.string().optional(),

  // Server-to-Server OAuth Configuration (optional)
  FRAMEIO_S2S_CLIENT_ID: z.string().optional(),
  FRAMEIO_S2S_CLIENT_SECRET: z.string().optional(),
  FRAMEIO_S2S_ORG_ID: z.string().optional(),

  // Webhook Security
  FRAMEIO_WEBHOOK_SECRET: z.string().min(32),

  // Storage Configuration
  STORAGE_MODE: z.enum(['local', 's3', 'gcs']).default('local'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  GCS_BUCKET: z.string().optional(),

  // Authentication
  JWT_SECRET: z.string().min(32).default('default-jwt-secret-change-in-production'),

  // Logging
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  LOG_PRETTY: z
    .string()
    .default('true')
    .transform((val) => val === 'true'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .default('900000')
    .transform((val) => parseInt(val, 10)),
  RATE_LIMIT_MAX_REQUESTS: z
    .string()
    .default('100')
    .transform((val) => parseInt(val, 10)),
});

// Validate and export configuration
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parseResult.error.format());
  process.exit(1);
}

export const config = parseResult.data;

// Validate storage configuration
if (config.STORAGE_MODE === 's3') {
  if (!config.S3_BUCKET || !config.S3_REGION || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error('S3 storage mode requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY');
  }
}

if (config.STORAGE_MODE === 'gcs') {
  if (!config.GCS_BUCKET) {
    throw new Error('GCS storage mode requires GCS_BUCKET');
  }
}

// Validate OAuth configuration (at least one mode must be configured)
const hasUserOAuth = config.FRAMEIO_CLIENT_ID && config.FRAMEIO_CLIENT_SECRET;
const hasS2SOAuth = config.FRAMEIO_S2S_CLIENT_ID && config.FRAMEIO_S2S_CLIENT_SECRET && config.FRAMEIO_S2S_ORG_ID;

if (!hasUserOAuth && !hasS2SOAuth) {
  throw new Error('At least one OAuth mode must be configured (User OAuth or S2S OAuth)');
}

export const isUserOAuthConfigured = !!hasUserOAuth;
export const isS2SOAuthConfigured = !!hasS2SOAuth;

// Export derived configuration
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

// File size limits
export const MAX_FILE_SIZE_BYTES = config.MAX_INPUT_GB * 1024 * 1024 * 1024;

// Paths
export const TEMP_UPLOAD_DIR = resolve(config.TMP_DIR, 'uploads');
export const TEMP_PROCESSING_DIR = resolve(config.TMP_DIR, 'processing');
export const LUT_STORAGE_DIR = resolve(config.TMP_DIR, 'luts');

// Export type for use in other modules
export type Config = z.infer<typeof envSchema>;
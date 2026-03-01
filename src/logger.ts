import pino from 'pino';
import { config, isDevelopment } from './config.js';

// Base logger configuration
const baseOptions: pino.LoggerOptions = {
  level: config.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-archon-signature"]',
      'accessToken',
      'refreshToken',
      'clientSecret',
      '*.password',
      '*.secret',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
};

// Development-specific configuration
const devTransport = config.LOG_PRETTY
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
        errorLikeObjectKeys: ['err', 'error'],
      },
    }
  : undefined;

// Create the base logger
export const logger = pino(
  baseOptions,
  devTransport && isDevelopment ? pino.transport(devTransport) : undefined,
);

// Create child loggers for different components
export const createLogger = (component: string) => {
  return logger.child({ component });
};

// Specialized loggers for major components
export const serverLogger = createLogger('server');
export const queueLogger = createLogger('queue');
export const ffmpegLogger = createLogger('ffmpeg');
export const frameioLogger = createLogger('frameio');
export const lutLogger = createLogger('lut');
export const webhookLogger = createLogger('webhook');
export const storageLogger = createLogger('storage');

// Helper functions for structured logging
export const logJobStart = (jobId: string, data: Record<string, unknown>) => {
  queueLogger.info({ jobId, data }, `Starting job ${jobId}`);
};

export const logJobComplete = (jobId: string, duration: number, result?: unknown) => {
  queueLogger.info({ jobId, duration, result }, `Job ${jobId} completed in ${duration}ms`);
};

export const logJobError = (jobId: string, error: Error, data?: unknown) => {
  queueLogger.error({ jobId, err: error, data }, `Job ${jobId} failed`);
};

export const logApiCall = (
  service: string,
  method: string,
  url: string,
  duration?: number,
  status?: number,
) => {
  const log = createLogger(`api:${service}`);
  log.info(
    {
      method,
      url,
      duration,
      status,
    },
    `API call to ${service}`,
  );
};

export const logFFmpegProgress = (jobId: string, percent: number, fps?: number, time?: string) => {
  ffmpegLogger.debug(
    {
      jobId,
      percent,
      fps,
      time,
    },
    `FFmpeg progress: ${percent.toFixed(1)}%`,
  );
};

// Request ID middleware helper
export const generateRequestId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// Error logging with context
export const logError = (
  error: Error | unknown,
  context: Record<string, unknown> = {},
): void => {
  if (error instanceof Error) {
    logger.error(
      {
        err: error,
        ...context,
      },
      error.message,
    );
  } else {
    logger.error(
      {
        error,
        ...context,
      },
      'Unknown error occurred',
    );
  }
};

// Audit logging for important operations
export const auditLog = (
  action: string,
  userId: string,
  resource: string,
  details: Record<string, unknown> = {},
): void => {
  logger.info(
    {
      audit: true,
      action,
      userId,
      resource,
      timestamp: new Date().toISOString(),
      ...details,
    },
    `Audit: ${action} on ${resource} by ${userId}`,
  );
};

export default logger;
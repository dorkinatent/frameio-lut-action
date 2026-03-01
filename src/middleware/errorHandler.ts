import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logError, serverLogger as logger } from '../logger.js';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

/**
 * Create an application error
 */
export function createError(message: string, statusCode = 500, code?: string, details?: any): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

/**
 * Global error handler middleware
 */
export function errorHandler(
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Log the error
  logError(error, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: error.errors,
    });
    return;
  }

  // Handle known application errors
  if ('statusCode' in error && error.statusCode) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code || 'APP_ERROR',
      details: error.details,
    });
    return;
  }

  // Handle axios errors
  if (error.name === 'AxiosError') {
    const axiosError = error as any;
    res.status(axiosError.response?.status || 500).json({
      error: 'External API error',
      code: 'EXTERNAL_API_ERROR',
      details: {
        message: axiosError.message,
        url: axiosError.config?.url,
        status: axiosError.response?.status,
      },
    });
    return;
  }

  // Default error response
  const isDev = process.env.NODE_ENV === 'development';
  res.status(500).json({
    error: isDev ? error.message : 'Internal server error',
    code: 'INTERNAL_ERROR',
    stack: isDev ? error.stack : undefined,
  });
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  logger.warn({ method: req.method, url: req.url }, 'Route not found');
  res.status(404).json({
    error: 'Route not found',
    code: 'NOT_FOUND',
    path: req.url,
  });
}
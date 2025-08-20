import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { WebhookError } from '../types';

export const errorHandler = (
  err: WebhookError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log the error
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    statusCode: err.statusCode,
    code: err.code,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    ampSender: req.get('AMP-Email-Sender')
  });

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Prepare error response
  const errorResponse = {
    success: false,
    message: err.message || 'Internal server error',
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: err.details
    })
  };

  // Send error response
  res.status(statusCode).json(errorResponse);
};

// Async error wrapper
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Create custom error
export const createError = (
  message: string,
  statusCode: number = 500,
  code?: string,
  details?: any
): WebhookError => {
  const error = new Error(message) as WebhookError;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
};
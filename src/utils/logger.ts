import winston from 'winston';
import path from 'path';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'amp-webhook' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // Write all logs to console in development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      )
    })
  ],
  
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'exceptions.log') 
    })
  ],
  
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'rejections.log') 
    })
  ]
});

// Create a stream object for Morgan HTTP logging
export const logStream = {
  write: (message: string) => {
    logger.info(message.trim());
  }
};

// Helper functions for structured logging
export const logHelpers = {
  /**
   * Log AMP form submission
   */
  logSubmission: (data: {
    formData: any;
    metadata: any;
    isTracked: boolean;
    validationResult?: any;
  }) => {
    logger.info('AMP form submission received', {
      type: 'form_submission',
      fieldCount: Object.keys(data.formData).length,
      isTracked: data.isTracked,
      userAgent: data.metadata.userAgent,
      ipAddress: data.metadata.ipAddress,
      signatureValid: data.validationResult?.isValid
    });
  },

  /**
   * Log validation attempts
   */
  logValidation: (data: {
    success: boolean;
    error?: string;
    keyUsed?: string;
    timeTaken?: number;
  }) => {
    logger.info('AMP signature validation', {
      type: 'signature_validation',
      success: data.success,
      error: data.error,
      keyUsed: data.keyUsed,
      timeTaken: data.timeTaken
    });
  },

  /**
   * Log security events
   */
  logSecurity: (event: string, data: any) => {
    logger.warn('Security event', {
      type: 'security',
      event,
      ...data
    });
  },

  /**
   * Log performance metrics
   */
  logPerformance: (operation: string, duration: number, metadata?: any) => {
    logger.info('Performance metric', {
      type: 'performance',
      operation,
      duration,
      ...metadata
    });
  },

  /**
   * Log admin actions
   */
  logAdmin: (action: string, user: string, data?: any) => {
    logger.info('Admin action', {
      type: 'admin',
      action,
      user,
      ...data
    });
  },

  /**
   * Log admin actions with IP
   */
  logAdminAction: (action: string, ip: string | undefined, data?: any) => {
    logger.info('Admin action', {
      type: 'admin',
      action,
      ip: ip || 'unknown',
      ...data
    });
  }
};

// Export default logger
export default logger;
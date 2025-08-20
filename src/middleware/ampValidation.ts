import { Request, Response, NextFunction } from 'express';
import { ampValidator } from '../services/ampValidator';
import { logger, logHelpers } from '../utils/logger';
import config from '../../config/default';

/**
 * Middleware to validate AMP signatures
 */
export const validateAmpSignature = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  const startTime = Date.now();
  
  try {
    // Skip validation if disabled in config
    if (!config.amp.validateSignatures) {
      logger.debug('AMP signature validation disabled');
      req.ampData = { isValidSignature: true };
      return next();
    }

    // Extract AMP headers
    const ampSignature = req.headers['amp-signature'] as string;
    const ampTimestamp = req.headers['amp-timestamp'] as string;
    
    // Initialize amp data on request
    req.ampData = {
      signature: ampSignature,
      timestamp: ampTimestamp,
      isValidSignature: false
    };

    // Check if AMP headers are present
    if (!ampSignature || !ampTimestamp) {
      logger.warn('Missing AMP headers', {
        hasSignature: !!ampSignature,
        hasTimestamp: !!ampTimestamp,
        userAgent: req.headers['user-agent'],
        ip: req.ip
      });
      
      // In development, allow requests without signatures
      if (process.env.NODE_ENV === 'development') {
        if (req.ampData) {
          req.ampData.isValidSignature = true;
        }
        return next();
      }
      
      return res.status(400).json({
        success: false,
        error: 'Missing required AMP headers (amp-signature, amp-timestamp)'
      });
    }

    // Get raw body for signature validation
    const rawBody = req.body ? JSON.stringify(req.body) : '';
    
    // Validate signature
    const validationResult = await ampValidator.validateSignature(
      rawBody,
      ampSignature,
      ampTimestamp
    );
    
    const timeTaken = Date.now() - startTime;
    
    // Log validation result
    logHelpers.logValidation({
      success: validationResult.isValid,
      error: validationResult.error,
      keyUsed: validationResult.publicKey,
      timeTaken
    });
    
    if (req.ampData) {
      req.ampData.isValidSignature = validationResult.isValid;
    }
    
    if (!validationResult.isValid) {
      logger.warn('AMP signature validation failed', {
        error: validationResult.error,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        timestamp: ampTimestamp
      });
      
      return res.status(401).json({
        success: false,
        error: 'Invalid AMP signature',
        details: validationResult.error
      });
    }
    
    logger.info('AMP signature validated successfully', {
      keyUsed: validationResult.publicKey,
      timeTaken
    });
    
    next();
    
  } catch (error: any) {
    const timeTaken = Date.now() - startTime;
    
    logger.error('AMP validation middleware error', {
      error: error.message,
      stack: error.stack,
      timeTaken
    });
    
    // In case of validation errors, decide based on environment
    if (process.env.NODE_ENV === 'development') {
      logger.warn('Allowing request due to validation error in development');
      req.ampData = { isValidSignature: true };
      return next();
    }
    
    res.status(500).json({
      success: false,
      error: 'Signature validation failed',
      message: 'Internal server error during validation'
    });
  }
};

/**
 * Middleware to extract and parse AMP form data
 */
export const parseAmpFormData = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Ensure we have a body
    if (!req.body) {
      req.body = {};
    }
    
    // Log the received form data structure
    logger.debug('Received AMP form data', {
      contentType: req.headers['content-type'],
      bodyKeys: Object.keys(req.body),
      bodySize: JSON.stringify(req.body).length
    });
    
    // Handle different content types
    const contentType = req.headers['content-type'] || '';
    
    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Form data is already parsed by express.urlencoded()
      logger.debug('Parsed URL-encoded form data', { fields: Object.keys(req.body) });
    } else if (contentType.includes('application/json')) {
      // JSON data is already parsed by express.json()
      logger.debug('Parsed JSON form data', { fields: Object.keys(req.body) });
    } else {
      logger.warn('Unexpected content type', { contentType });
    }
    
    next();
    
  } catch (error: any) {
    logger.error('Error parsing AMP form data', {
      error: error.message,
      contentType: req.headers['content-type']
    });
    
    res.status(400).json({
      success: false,
      error: 'Failed to parse form data'
    });
  }
};

/**
 * Middleware to handle doNotTrackThis parameter
 */
export const handleDoNotTrack = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Check for doNotTrackThis in query parameters
    const doNotTrack = req.query.doNotTrackThis === '1' || 
                      req.query.doNotTrackThis === 'true';
    
    // Add tracking flag to request
    (req as any).isTracked = !doNotTrack;
    
    if (doNotTrack) {
      logger.debug('Request marked as do not track', {
        url: req.url,
        query: req.query
      });
    }
    
    next();
    
  } catch (error: any) {
    logger.error('Error handling doNotTrack parameter', {
      error: error.message
    });
    
    // Default to tracked if there's an error
    (req as any).isTracked = true;
    next();
  }
};

/**
 * Middleware to log request details for debugging
 */
export const logRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startTime = Date.now();
  
  logger.info('Incoming AMP request', {
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    contentType: req.headers['content-type'],
    ip: req.ip,
    hasAmpSignature: !!req.headers['amp-signature'],
    hasAmpTimestamp: !!req.headers['amp-timestamp']
  });
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    logHelpers.logPerformance('request_handling', duration, {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      contentLength: res.get('content-length')
    });
  });
  
  next();
};
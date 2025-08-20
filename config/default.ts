import { WebhookConfig } from '../src/types';

export const config: WebhookConfig = {
  port: parseInt(process.env.PORT || '3000'),
  
  corsOrigins: [
    'https://mail.google.com',
    'https://outlook.live.com',
    'https://outlook.office.com',
    'https://*.ampproject.org',
    'https://*.amp.dev',
    // Add localhost for development
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },
  
  database: {
    type: 'memory', // Can be changed to 'file' or 'postgresql'
    connectionString: process.env.DATABASE_URL
  },
  
  amp: {
    validateSignatures: process.env.AMP_VALIDATE_SIGNATURES !== 'false',
    publicKeysUrl: 'https://cdn.ampproject.org/certs/signing_certs.json'
  },
  
  admin: {
    enabled: process.env.ADMIN_ENABLED !== 'false',
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123' // Change in production!
  }
};

// Environment-specific overrides
if (process.env.NODE_ENV === 'production') {
  // Production settings
  config.corsOrigins = [
    'https://mail.google.com',
    'https://outlook.live.com',
    'https://outlook.office.com',
    'https://*.ampproject.org',
    'https://*.amp.dev'
  ];
  
  // Stricter rate limiting in production
  config.rateLimit.max = 50;
  
  // Require strong admin password in production
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin123') {
    console.warn('WARNING: Using default admin password in production! Set ADMIN_PASSWORD environment variable.');
  }
}

if (process.env.NODE_ENV === 'development') {
  // Development settings
  config.corsOrigins.push('http://localhost:*');
  config.amp.validateSignatures = false; // Disable signature validation in dev
}

export default config;
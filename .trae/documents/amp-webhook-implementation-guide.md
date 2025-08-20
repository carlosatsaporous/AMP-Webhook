# AMP Email Webhook System - Implementation Guide

## 1. Project Setup

### 1.1 Initialize Node.js Project
```bash
# Create project directory
mkdir amp-webhook-system
cd amp-webhook-system

# Initialize npm project
npm init -y

# Install dependencies
npm install express cors helmet morgan winston joi bcryptjs jsonwebtoken
npm install pg redis ioredis express-rate-limit
npm install @types/node @types/express @types/cors @types/bcryptjs @types/jsonwebtoken typescript ts-node nodemon --save-dev

# Install AMP-specific dependencies
npm install node-fetch crypto
```

### 1.2 Project Structure
```
amp-webhook-system/
├── src/
│   ├── controllers/
│   │   ├── webhookController.ts
│   │   ├── submissionController.ts
│   │   └── configController.ts
│   ├── middleware/
│   │   ├── ampValidator.ts
│   │   ├── rateLimiter.ts
│   │   └── auth.ts
│   ├── models/
│   │   ├── submission.ts
│   │   └── config.ts
│   ├── services/
│   │   ├── ampService.ts
│   │   ├── submissionService.ts
│   │   └── configService.ts
│   ├── utils/
│   │   ├── database.ts
│   │   ├── logger.ts
│   │   └── validator.ts
│   ├── routes/
│   │   ├── webhook.ts
│   │   ├── api.ts
│   │   └── admin.ts
│   └── app.ts
├── config/
│   ├── database.sql
│   └── environment.ts
├── docker-compose.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

## 2. Core Implementation

### 2.1 Express Server Setup (src/app.ts)
```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { webhookRoutes } from './routes/webhook';
import { apiRoutes } from './routes/api';
import { adminRoutes } from './routes/admin';
import { logger } from './utils/logger';
import { rateLimiter } from './middleware/rateLimiter';

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'AMP-Email-Sender', 'AMP-Email-Signature']
}));

// Logging
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(rateLimiter);

// Routes
app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`AMP Webhook server running on port ${PORT}`);
});

export default app;
```

### 2.2 AMP Signature Validator (src/middleware/ampValidator.ts)
```typescript
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { logger } from '../utils/logger';

interface AMPRequest extends Request {
  ampValidated?: boolean;
}

class AMPValidator {
  private googlePublicKeys: string[] = [];
  private lastKeyFetch: number = 0;
  private readonly KEY_CACHE_DURATION = 3600000; // 1 hour

  async fetchGooglePublicKeys(): Promise<void> {
    try {
      const response = await fetch('https://cdn.ampproject.org/certs/prod.json');
      const data = await response.json() as { keys: Array<{ kty: string; n: string; e: string }> };
      
      this.googlePublicKeys = data.keys.map(key => {
        // Convert JWK to PEM format
        return this.jwkToPem(key);
      });
      
      this.lastKeyFetch = Date.now();
      logger.info('Updated Google AMP public keys');
    } catch (error) {
      logger.error('Failed to fetch Google AMP public keys:', error);
      throw new Error('Unable to fetch AMP validation keys');
    }
  }

  private jwkToPem(jwk: { kty: string; n: string; e: string }): string {
    // Implementation to convert JWK to PEM format
    // This is a simplified version - use a proper library like node-jose in production
    const n = Buffer.from(jwk.n, 'base64url');
    const e = Buffer.from(jwk.e, 'base64url');
    
    // Create RSA public key in PEM format
    // Note: This is a simplified implementation
    return `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([n, e]).toString('base64')}\n-----END PUBLIC KEY-----`;
  }

  async validateSignature(signature: string, payload: string, sender: string): Promise<boolean> {
    // Refresh keys if needed
    if (Date.now() - this.lastKeyFetch > this.KEY_CACHE_DURATION) {
      await this.fetchGooglePublicKeys();
    }

    const signatureBuffer = Buffer.from(signature, 'base64');
    const payloadBuffer = Buffer.from(payload, 'utf8');

    for (const publicKey of this.googlePublicKeys) {
      try {
        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(payloadBuffer);
        
        if (verifier.verify(publicKey, signatureBuffer)) {
          return true;
        }
      } catch (error) {
        logger.warn('Signature verification failed for key:', error);
        continue;
      }
    }

    return false;
  }
}

const ampValidator = new AMPValidator();

export const validateAMPSignature = async (req: AMPRequest, res: Response, next: NextFunction) => {
  try {
    const signature = req.headers['amp-email-signature'] as string;
    const sender = req.headers['amp-email-sender'] as string;
    
    if (!signature || !sender) {
      return res.status(400).json({
        success: false,
        message: 'Missing AMP signature or sender headers'
      });
    }

    const payload = JSON.stringify(req.body);
    const isValid = await ampValidator.validateSignature(signature, payload, sender);
    
    if (!isValid) {
      logger.warn(`Invalid AMP signature from sender: ${sender}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid AMP signature'
      });
    }

    req.ampValidated = true;
    next();
  } catch (error) {
    logger.error('AMP validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Signature validation failed'
    });
  }
};
```

### 2.3 Webhook Controller (src/controllers/webhookController.ts)
```typescript
import { Request, Response } from 'express';
import { submissionService } from '../services/submissionService';
import { logger } from '../utils/logger';
import { validateSubmissionData } from '../utils/validator';

interface AMPRequest extends Request {
  ampValidated?: boolean;
}

export class WebhookController {
  async handleAMPSubmission(req: AMPRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Validate request data
      const { error, value } = validateSubmissionData(req.body);
      if (error) {
        logger.warn('Invalid submission data:', error.details);
        res.status(400).json({
          success: false,
          message: 'Invalid submission data',
          errors: error.details
        });
        return;
      }

      // Extract metadata
      const metadata = {
        senderEmail: req.headers['amp-email-sender'] as string,
        clientIp: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        emailId: value.emailId,
        submittedAt: value.timestamp ? new Date(value.timestamp) : new Date()
      };

      // Process submission
      const submission = await submissionService.createSubmission(value.formData, metadata);
      
      // Log processing time
      const processingTime = Date.now() - startTime;
      logger.info(`Submission processed in ${processingTime}ms`, {
        submissionId: submission.id,
        senderEmail: metadata.senderEmail,
        processingTime
      });

      // Return success response
      res.status(200).json({
        success: true,
        message: 'Submission received successfully',
        submissionId: submission.id
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('Webhook processing error:', {
        error: error.message,
        processingTime,
        body: req.body,
        headers: req.headers
      });

      res.status(500).json({
        success: false,
        message: 'Failed to process submission'
      });
    }
  }

  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      // Perform basic health checks
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0'
      };

      res.status(200).json(health);
    } catch (error) {
      logger.error('Health check failed:', error);
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  }
}

export const webhookController = new WebhookController();
```

### 2.4 Database Service (src/utils/database.ts)
```typescript
import { Pool, PoolClient } from 'pg';
import { logger } from './logger';

class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'amp_webhook',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', err);
    });
  }

  async query(text: string, params?: any[]): Promise<any> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const database = new Database();
```

## 3. Environment Configuration

### 3.1 Environment Variables (.env)
```env
# Server Configuration
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=https://mail.google.com,https://outlook.live.com

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=amp_webhook
DB_USER=postgres
DB_PASSWORD=your_secure_password

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Security
JWT_SECRET=your_jwt_secret_key
API_KEY_SECRET=your_api_key_secret

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FILE_PATH=./logs/app.log

# AMP Configuration
AMP_SIGNATURE_VALIDATION=true
GOOGLE_AMP_KEYS_URL=https://cdn.ampproject.org/certs/prod.json
```

### 3.2 Docker Configuration (docker-compose.yml)
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - REDIS_HOST=redis
    depends_on:
      - postgres
      - redis
    volumes:
      - ./logs:/app/logs

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: amp_webhook
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: your_secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./config/database.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass your_redis_password
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

## 4. Deployment Instructions

### 4.1 Local Development
```bash
# Clone and setup
git clone <repository-url>
cd amp-webhook-system
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start services
docker-compose up -d postgres redis

# Run migrations
npm run migrate

# Start development server
npm run dev
```

### 4.2 Production Deployment
```bash
# Build and deploy
docker-compose up -d

# Verify deployment
curl http://localhost:3000/health

# Monitor logs
docker-compose logs -f app
```

### 4.3 SSL/HTTPS Setup
```nginx
# Nginx configuration for HTTPS
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 5. Testing and Validation

### 5.1 Test AMP Email Submission
```bash
# Test webhook endpoint
curl -X POST https://your-domain.com/webhook/amp \
  -H "Content-Type: application/json" \
  -H "AMP-Email-Sender: test@example.com" \
  -H "AMP-Email-Signature: <base64-signature>" \
  -d '{
    "formData": {
      "name": "Test User",
      "email": "test@example.com",
      "message": "Test submission"
    },
    "timestamp": "2024-01-15T10:30:00Z",
    "emailId": "test_email_123"
  }'
```

### 5.2 Monitor System Health
```bash
# Check health endpoint
curl https://your-domain.com/webhook/health

# Check submission data
curl -H "Authorization: Bearer <api-token>" \
  https://your-domain.com/api/submissions?limit=10
```

This implementation guide provides a complete foundation for building an AMP email webhook system with proper security, validation, and monitoring capabilities.
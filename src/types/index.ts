// AMP Webhook Types

export interface AmpFormSubmission {
  id: string;
  formId: string;
  formData: any;
  metadata: SubmissionMetadata;
  timestamp: Date;
  isTracked: boolean;
  isAmpValidated?: boolean;
  validationResult?: any;
}

export interface SubmissionMetadata {
  userAgent?: string;
  ipAddress?: string;
  referer?: string;
  ampSignature?: string;
  ampTimestamp?: string;
  ampSignatureValid?: boolean;
  formStructure: FormStructure;
  senderEmail?: string;
}

export interface FormStructure {
  formId: string;
  fields: FormField[];
  action: string;
  method: string;
}

export interface FormField {
  name: string;
  type: string;
  value: any;
  required?: boolean;
}

export interface AmpSignatureValidation {
  isValid: boolean;
  publicKey?: string;
  error?: string;
}

export interface WebhookConfig {
  port: number;
  corsOrigins: string[];
  rateLimit: {
    windowMs: number;
    max: number;
  };
  database: {
    type: 'memory' | 'file' | 'postgresql';
    connectionString?: string;
  };
  amp: {
    validateSignatures: boolean;
    publicKeysUrl: string;
  };
  admin: {
    enabled: boolean;
    username?: string;
    password?: string;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AdminStats {
  totalSubmissions: number;
  todaySubmissions: number;
  weekSubmissions: number;
  monthSubmissions: number;
  recentSubmissions: AmpFormSubmission[];
  formTypes: { formId: string; count: number }[];
}

// Custom error interface
export interface WebhookError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

// Express Request extension for AMP data
declare global {
  namespace Express {
    interface Request {
      ampData?: {
        isValidSignature: boolean;
        signature?: string;
      };
    }
  }
}
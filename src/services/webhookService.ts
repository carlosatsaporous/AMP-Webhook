import { AmpFormSubmission, SubmissionMetadata } from '../types';
import { logger } from '../utils/logger';
import { createError } from '../middleware/errorHandler';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

interface SubmissionFilters {
  page: number;
  limit: number;
  senderEmail?: string;
  startDate?: Date;
  endDate?: Date;
  ampValidated?: boolean;
}

interface SubmissionResult {
  submissions: AmpFormSubmission[];
  total: number;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: 'connected' | 'disconnected';
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  submissionsToday: number;
}

class WebhookService {
  private submissions: Map<string, AmpFormSubmission> = new Map();
  private readonly dataDir: string;
  private readonly maxSubmissions = 10000; // In-memory limit
  private startTime = Date.now();

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.ensureDataDirectory();
    this.loadSubmissions();
  }

  private async ensureDataDirectory(): Promise<void> {
    try {
      await fs.access(this.dataDir);
    } catch {
      await fs.mkdir(this.dataDir, { recursive: true });
      logger.info('Created data directory:', this.dataDir);
    }
  }

  private async loadSubmissions(): Promise<void> {
    try {
      const submissionsFile = path.join(this.dataDir, 'submissions.json');
      
      try {
        const data = await fs.readFile(submissionsFile, 'utf-8');
        const submissions = JSON.parse(data) as AmpFormSubmission[];
        
        submissions.forEach(submission => {
          this.submissions.set(submission.id, {
            ...submission,
            timestamp: new Date(submission.timestamp)
          });
        });
        
        logger.info(`Loaded ${submissions.length} submissions from storage`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          logger.warn('Failed to load submissions from storage:', error.message);
        }
      }
    } catch (error) {
      logger.error('Error loading submissions:', error);
    }
  }

  private async saveSubmissions(): Promise<void> {
    try {
      const submissionsFile = path.join(this.dataDir, 'submissions.json');
      const submissions = Array.from(this.submissions.values());
      
      await fs.writeFile(submissionsFile, JSON.stringify(submissions, null, 2));
      logger.debug(`Saved ${submissions.length} submissions to storage`);
    } catch (error) {
      logger.error('Error saving submissions:', error);
    }
  }

  async processSubmission(request: any): Promise<AmpFormSubmission> {
    try {
      // Generate unique ID
      const id = this.generateSubmissionId();
      
      // Validate form data
      this.validateFormData(request.formData);
      
      // Create submission record
      const submission: AmpFormSubmission = {
        id,
        formId: request.metadata.formStructure.formId,
        formData: request.formData,
        metadata: {
          ...request.metadata
        },
        timestamp: new Date(),
        isAmpValidated: request.isAmpValidated,
        isTracked: true
      };

      // Store submission
      this.submissions.set(id, submission);
      
      // Clean up old submissions if we exceed the limit
      if (this.submissions.size > this.maxSubmissions) {
        this.cleanupOldSubmissions();
      }

      // Save to persistent storage (async, don't wait)
      this.saveSubmissions().catch(error => {
        logger.error('Failed to save submissions to storage:', error);
      });

      // Log submission details
      logger.info('Submission processed successfully', {
        id,
        senderEmail: request.metadata.senderEmail,
        ampValidated: request.isAmpValidated,
        fieldCount: Object.keys(request.formData).length,
        dataSize: JSON.stringify(request.formData).length
      });

      // Process form data based on content
      await this.processFormContent(submission);

      return submission;

    } catch (error) {
      logger.error('Failed to process submission:', error);
      throw createError(
        `Submission processing failed: ${(error as Error).message}`,
        500,
        'PROCESSING_FAILED'
      );
    }
  }

  async getSubmission(id: string): Promise<AmpFormSubmission | null> {
    return this.submissions.get(id) || null;
  }

  async getSubmissions(filters: SubmissionFilters): Promise<SubmissionResult> {
    let submissions = Array.from(this.submissions.values());

    // Apply filters
    if (filters.senderEmail) {
      submissions = submissions.filter(s => 
        s.metadata.senderEmail?.toLowerCase().includes(filters.senderEmail!.toLowerCase())
      );
    }

    if (filters.startDate) {
      submissions = submissions.filter(s => s.timestamp >= filters.startDate!);
    }

    if (filters.endDate) {
      submissions = submissions.filter(s => s.timestamp <= filters.endDate!);
    }

    if (filters.ampValidated !== undefined) {
      submissions = submissions.filter(s => s.isAmpValidated === filters.ampValidated);
    }

    // Sort by timestamp (newest first)
    submissions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const total = submissions.length;
    const startIndex = (filters.page - 1) * filters.limit;
    const endIndex = startIndex + filters.limit;
    const paginatedSubmissions = submissions.slice(startIndex, endIndex);

    return {
      submissions: paginatedSubmissions,
      total
    };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const submissionsToday = Array.from(this.submissions.values())
      .filter(s => s.timestamp >= todayStart).length;

    return {
      status: 'healthy',
      database: 'connected', // Since we're using in-memory + file storage
      uptime: now - this.startTime,
      memoryUsage: process.memoryUsage(),
      submissionsToday
    };
  }

  private generateSubmissionId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(6).toString('hex');
    return `sub_${timestamp}_${random}`;
  }

  private validateFormData(formData: Record<string, any>): void {
    if (!formData || typeof formData !== 'object') {
      throw new Error('Form data must be an object');
    }

    if (Object.keys(formData).length === 0) {
      throw new Error('Form data cannot be empty');
    }

    // Check for potentially malicious content
    const dataString = JSON.stringify(formData);
    if (dataString.length > 100000) { // 100KB limit
      throw new Error('Form data too large');
    }

    // Basic XSS prevention
    const dangerousPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(dataString)) {
        logger.warn('Potentially malicious content detected in form data');
        break;
      }
    }
  }

  private cleanupOldSubmissions(): void {
    const submissions = Array.from(this.submissions.entries());
    
    // Sort by timestamp (oldest first)
    submissions.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
    
    // Remove oldest 10% of submissions
    const toRemove = Math.floor(submissions.length * 0.1);
    
    for (let i = 0; i < toRemove; i++) {
      this.submissions.delete(submissions[i][0]);
    }
    
    logger.info(`Cleaned up ${toRemove} old submissions`);
  }

  private async processFormContent(submission: AmpFormSubmission): Promise<void> {
    try {
      // Analyze form content and extract insights
      const formData = submission.formData;
      const insights: any = {
        fieldTypes: {},
        hasEmail: false,
        hasChoice: false,
        hasText: false,
        estimatedType: 'unknown'
      };

      // Analyze each field
      Object.entries(formData).forEach(([key, value]) => {
        const keyLower = key.toLowerCase();
        const valueStr = String(value).toLowerCase();

        // Detect field types
        if (keyLower.includes('email') || /\S+@\S+\.\S+/.test(valueStr)) {
          insights.fieldTypes[key] = 'email';
          insights.hasEmail = true;
        } else if (keyLower.includes('choice') || keyLower.includes('option') || keyLower.includes('select')) {
          insights.fieldTypes[key] = 'choice';
          insights.hasChoice = true;
        } else if (typeof value === 'string' && value.length > 10) {
          insights.fieldTypes[key] = 'text';
          insights.hasText = true;
        } else {
          insights.fieldTypes[key] = 'simple';
        }
      });

      // Estimate form type
      if (insights.hasChoice && !insights.hasText) {
        insights.estimatedType = 'poll';
      } else if (insights.hasEmail) {
        insights.estimatedType = 'contact';
      } else if (insights.hasText) {
        insights.estimatedType = 'feedback';
      }

      // Store insights (you could save this to database)
      logger.info('Form content analyzed', {
        submissionId: submission.id,
        insights,
        fieldCount: Object.keys(formData).length
      });

    } catch (error) {
      logger.error('Error processing form content:', error);
      // Don't throw - this is optional processing
    }
  }

  // Export submissions to JSON file
  async exportSubmissions(filters?: Partial<SubmissionFilters>): Promise<string> {
    try {
      const result = await this.getSubmissions({
        page: 1,
        limit: 10000,
        ...filters
      });

      const exportData = {
        exportDate: new Date().toISOString(),
        totalSubmissions: result.total,
        filters,
        submissions: result.submissions
      };

      const filename = `submissions_export_${Date.now()}.json`;
      const filepath = path.join(this.dataDir, filename);
      
      await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
      
      logger.info('Submissions exported', {
        filename,
        count: result.total
      });

      return filepath;
    } catch (error) {
      logger.error('Failed to export submissions:', error);
      throw createError('Export failed', 500, 'EXPORT_FAILED');
    }
  }
}

export const webhookService = new WebhookService();
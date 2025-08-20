import { AmpFormSubmission, SubmissionMetadata, FormStructure, AdminStats } from '../types';
import { logger } from '../utils/logger';
import config from '../../config/default';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Database service for storing AMP form submissions
 * Supports in-memory, file-based, and PostgreSQL storage
 */
class DatabaseService {
  private submissions: AmpFormSubmission[] = [];
  private filePath: string;
  
  constructor() {
    this.filePath = path.join(process.cwd(), 'data', 'submissions.json');
    this.initializeStorage();
  }
  
  private async initializeStorage(): Promise<void> {
    try {
      if (config.database.type === 'file') {
        // Ensure data directory exists
        const dataDir = path.dirname(this.filePath);
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Load existing submissions if file exists
        if (fs.existsSync(this.filePath)) {
          const data = fs.readFileSync(this.filePath, 'utf8');
          this.submissions = JSON.parse(data);
          logger.info(`Loaded ${this.submissions.length} submissions from file`);
        }
      }
      
      logger.info(`Database service initialized with ${config.database.type} storage`);
    } catch (error) {
      logger.error('Failed to initialize database service', {
        error: (error as any)?.message || 'Unknown error',
        type: config.database.type
      });
    }
  }
  
  /**
   * Save a form submission
   */
  async saveSubmission(submission: AmpFormSubmission): Promise<string> {
    try {
      // Generate unique ID
      submission.id = this.generateId();
      submission.timestamp = new Date();
      
      // Add to memory storage
      this.submissions.push(submission);
      
      // Persist to file if using file storage
      if (config.database.type === 'file') {
        await this.saveToFile();
      }
      
      logger.info('Form submission saved', {
        id: submission.id,
        formType: submission.metadata.formStructure.formId,
        fieldCount: Object.keys(submission.formData).length
      });
      
      return submission.id;
    } catch (error: any) {
      logger.error('Failed to save submission', {
        error: error.message,
        submissionId: submission.id
      });
      throw error;
    }
  }
  
  /**
   * Get all submissions with optional filtering
   */
  async getSubmissions(options: {
    limit?: number;
    offset?: number;
    formId?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<AmpFormSubmission[]> {
    try {
      let filtered = [...this.submissions];
      
      // Filter by form ID
      if (options.formId) {
        filtered = filtered.filter(s => s.metadata.formStructure.formId === options.formId);
      }
      
      // Filter by date range
      if (options.startDate) {
        filtered = filtered.filter(s => s.timestamp >= options.startDate!);
      }
      if (options.endDate) {
        filtered = filtered.filter(s => s.timestamp <= options.endDate!);
      }
      
      // Sort by timestamp (newest first)
      filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      // Apply pagination
      const offset = options.offset || 0;
      const limit = options.limit || 100;
      
      return filtered.slice(offset, offset + limit);
    } catch (error: any) {
      logger.error('Failed to get submissions', {
        error: error.message,
        options
      });
      throw error;
    }
  }
  
  /**
   * Get a specific submission by ID
   */
  async getSubmissionById(id: string): Promise<AmpFormSubmission | null> {
    try {
      const submission = this.submissions.find(s => s.id === id);
      return submission || null;
    } catch (error: any) {
      logger.error('Failed to get submission by ID', {
        error: error.message,
        id
      });
      throw error;
    }
  }
  
  /**
   * Get admin statistics
   */
  async getAdminStats(): Promise<AdminStats> {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const totalSubmissions = this.submissions.length;
      const todaySubmissions = this.submissions.filter(s => s.timestamp >= today).length;
      const weekSubmissions = this.submissions.filter(s => s.timestamp >= thisWeek).length;
      const monthSubmissions = this.submissions.filter(s => s.timestamp >= thisMonth).length;
      
      // Get unique form types
      const formTypes = [...new Set(this.submissions.map(s => s.metadata.formStructure.formId))];
      
      // Get form type distribution
      const formTypeStats = formTypes.map(formId => {
        const count = this.submissions.filter(s => s.metadata.formStructure.formId === formId).length;
        return { formId, count };
      });
      
      // Get recent submissions
      const recentSubmissions = this.submissions
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 10);
      
      return {
        totalSubmissions,
        todaySubmissions,
        weekSubmissions,
        monthSubmissions,
        formTypes: formTypeStats,
        recentSubmissions
      };
    } catch (error: any) {
      logger.error('Failed to get admin stats', {
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Delete submissions older than specified days
   */
  async cleanupOldSubmissions(daysOld: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      const initialCount = this.submissions.length;
      this.submissions = this.submissions.filter(s => s.timestamp >= cutoffDate);
      const deletedCount = initialCount - this.submissions.length;
      
      if (deletedCount > 0 && config.database.type === 'file') {
        await this.saveToFile();
      }
      
      logger.info(`Cleaned up ${deletedCount} old submissions`, {
        cutoffDate,
        remainingCount: this.submissions.length
      });
      
      return deletedCount;
    } catch (error: any) {
      logger.error('Failed to cleanup old submissions', {
        error: error.message,
        daysOld
      });
      throw error;
    }
  }
  
  /**
   * Export submissions as JSON
   */
  async exportSubmissions(options: {
    formId?: string;
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<AmpFormSubmission[]> {
    try {
      return await this.getSubmissions({
        ...options,
        limit: 10000 // Large limit for export
      });
    } catch (error: any) {
      logger.error('Failed to export submissions', {
        error: error.message,
        options
      });
      throw error;
    }
  }
  
  private async saveToFile(): Promise<void> {
    try {
      const data = JSON.stringify(this.submissions, null, 2);
      fs.writeFileSync(this.filePath, data, 'utf8');
    } catch (error: any) {
      logger.error('Failed to save submissions to file', {
        error: error.message,
        filePath: this.filePath
      });
      throw error;
    }
  }
  
  private generateId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Get submission count by form ID
   */
  async getSubmissionCountByForm(): Promise<Record<string, number>> {
    try {
      const counts: Record<string, number> = {};
      
      this.submissions.forEach(submission => {
        const formId = submission.metadata.formStructure.formId;
        counts[formId] = (counts[formId] || 0) + 1;
      });
      
      return counts;
    } catch (error: any) {
      logger.error('Failed to get submission count by form', {
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Search submissions by field values
   */
  async searchSubmissions(searchTerm: string): Promise<AmpFormSubmission[]> {
    try {
      const term = searchTerm.toLowerCase();
      
      return this.submissions.filter(submission => {
        // Search in form data values
        const formDataMatch = Object.values(submission.formData)
          .some(value => 
            typeof value === 'string' && value.toLowerCase().includes(term)
          );
        
        // Search in metadata
        const metadataMatch = 
          submission.metadata.userAgent?.toLowerCase().includes(term) ||
          submission.metadata.ipAddress?.toLowerCase().includes(term) ||
          submission.metadata.formStructure.formId?.toLowerCase().includes(term);
        
        return formDataMatch || metadataMatch;
      });
    } catch (error: any) {
      logger.error('Failed to search submissions', {
        error: error.message,
        searchTerm
      });
      throw error;
    }
  }
}

// Export singleton instance
export const database = new DatabaseService();
export default database;
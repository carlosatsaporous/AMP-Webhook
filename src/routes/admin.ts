import { Router, Request, Response } from 'express';
import { database } from '../services/database';
import { logger, logHelpers } from '../utils/logger';
import config from '../../config/default';
const basicAuth = require('express-basic-auth');

const router = Router();

// Basic authentication middleware for admin routes
const authUsers: { [key: string]: string } = {};
const username = config.admin.username as string;
const password = config.admin.password as string;
authUsers[username] = password;

const auth = basicAuth({
  users: authUsers,
  challenge: true,
  realm: 'AMP Webhook Admin'
});

// Apply auth to all admin routes if enabled
if (config.admin.enabled) {
  router.use(auth);
}

/**
 * Admin dashboard - HTML interface
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const stats = await database.getAdminStats();
    
    const html = generateAdminDashboard(stats);
    res.set('Content-Type', 'text/html');
    res.send(html);
    
    logHelpers.logAdminAction('dashboard_view', req.ip);
  } catch (error: any) {
    logger.error('Failed to load admin dashboard', { error: error?.message || 'Unknown error' });
    res.status(500).send('<h1>Error loading dashboard</h1><p>Check server logs for details.</p>');
  }
});

/**
 * Get admin statistics (JSON)
 */
router.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const stats = await database.getAdminStats();
    res.json(stats);
    
    logHelpers.logAdminAction('stats_api', req.ip);
  } catch (error: any) {
    logger.error('Failed to get admin stats', { error: error?.message || 'Unknown error' });
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

/**
 * Get submissions with filtering
 */
router.get('/api/submissions', async (req: Request, res: Response) => {
  try {
    const {
      limit = '50',
      offset = '0',
      formId,
      startDate,
      endDate,
      search
    } = req.query;
    
    let submissions;
    
    if (search) {
      submissions = await database.searchSubmissions(search as string);
    } else {
      submissions = await database.getSubmissions({
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        formId: formId as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined
      });
    }
    
    res.json({
      submissions,
      total: submissions.length,
      filters: { limit, offset, formId, startDate, endDate, search }
    });
    
    logHelpers.logAdminAction('submissions_view', req.ip, {
      count: submissions.length,
      filters: { formId, search }
    });
  } catch (error: any) {
    logger.error('Failed to get submissions', { error: error?.message || 'Unknown error' });
    res.status(500).json({ error: 'Failed to retrieve submissions' });
  }
});

/**
 * Get specific submission by ID
 */
router.get('/api/submissions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const submission = await database.getSubmissionById(id);
    
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    res.json(submission);
    
    logHelpers.logAdminAction('submission_detail', req.ip, { submissionId: id });
  } catch (error: any) {
    logger.error('Failed to get submission', { error: error?.message || 'Unknown error', id: req.params.id });
    return res.status(500).json({ error: 'Failed to retrieve submission' });
  }
});

/**
 * Export submissions as JSON
 */
router.get('/api/export', async (req: Request, res: Response) => {
  try {
    const { formId, startDate, endDate, format = 'json' } = req.query;
    
    const submissions = await database.exportSubmissions({
      formId: formId as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });
    
    if (format === 'csv') {
      const csv = convertToCSV(submissions);
      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="submissions_${new Date().toISOString().split('T')[0]}.csv"`
      });
      res.send(csv);
    } else {
      res.set({
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="submissions_${new Date().toISOString().split('T')[0]}.json"`
      });
      res.json(submissions);
    }
    
    logHelpers.logAdminAction('export', req.ip, {
      count: submissions.length,
      format,
      filters: { formId, startDate, endDate }
    });
  } catch (error: any) {
    logger.error('Failed to export submissions', { error: error?.message || 'Unknown error' });
    res.status(500).json({ error: 'Failed to export submissions' });
  }
});

/**
 * Cleanup old submissions
 */
router.post('/api/cleanup', async (req: Request, res: Response) => {
  try {
    const { daysOld = 30 } = req.body;
    const deletedCount = await database.cleanupOldSubmissions(parseInt(daysOld));
    
    res.json({
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} submissions older than ${daysOld} days`
    });
    
    logHelpers.logAdminAction('cleanup', req.ip, { daysOld, deletedCount });
  } catch (error: any) {
    logger.error('Failed to cleanup submissions', { error: error?.message || 'Unknown error' });
    res.status(500).json({ error: 'Failed to cleanup submissions' });
  }
});

/**
 * Get form submission counts
 */
router.get('/api/form-counts', async (req: Request, res: Response) => {
  try {
    const counts = await database.getSubmissionCountByForm();
    res.json(counts);
    
    logHelpers.logAdminAction('form_counts', req.ip);
  } catch (error: any) {
    logger.error('Failed to get form counts', { error: error?.message || 'Unknown error' });
    res.status(500).json({ error: 'Failed to retrieve form counts' });
  }
});

/**
 * Generate admin dashboard HTML
 */
function generateAdminDashboard(stats: any): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AMP Webhook Admin Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-number { font-size: 2em; font-weight: bold; color: #007bff; }
        .stat-label { color: #666; margin-top: 5px; }
        .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .form-types { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .form-type { padding: 15px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #007bff; }
        .recent-submissions { max-height: 400px; overflow-y: auto; }
        .submission-item { padding: 15px; border-bottom: 1px solid #eee; }
        .submission-item:last-child { border-bottom: none; }
        .submission-meta { font-size: 0.9em; color: #666; margin-top: 5px; }
        .actions { margin-top: 20px; }
        .btn { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; text-decoration: none; display: inline-block; }
        .btn:hover { background: #0056b3; }
        .btn-secondary { background: #6c757d; }
        .btn-secondary:hover { background: #545b62; }
        .refresh-time { color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 AMP Webhook Admin Dashboard</h1>
            <p>Monitor and manage your AMP form submissions</p>
            <div class="refresh-time">Last updated: ${new Date().toLocaleString()}</div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${stats.totalSubmissions}</div>
                <div class="stat-label">Total Submissions</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.todaySubmissions}</div>
                <div class="stat-label">Today</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.weekSubmissions}</div>
                <div class="stat-label">This Week</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.monthSubmissions}</div>
                <div class="stat-label">This Month</div>
            </div>
        </div>
        
        <div class="section">
            <h2>📊 Form Types</h2>
            <div class="form-types">
                ${stats.formTypes.map((ft: any) => `
                    <div class="form-type">
                        <strong>${ft.formId}</strong>
                        <div style="font-size: 1.2em; margin-top: 5px;">${ft.count} submissions</div>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="section">
            <h2>📝 Recent Submissions</h2>
            <div class="recent-submissions">
                ${stats.recentSubmissions.map((sub: any) => `
                    <div class="submission-item">
                        <strong>Form: ${sub.metadata.formStructure.formId}</strong>
                        <div>Data: ${JSON.stringify(sub.formData)}</div>
                        <div class="submission-meta">
                            ${new Date(sub.timestamp).toLocaleString()} | 
                            IP: ${sub.metadata.ipAddress} | 
                            Valid: ${sub.metadata.ampSignatureValid ? '✅' : '❌'}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="actions">
            <a href="/admin/api/submissions" class="btn">📄 View All Submissions (JSON)</a>
            <a href="/admin/api/export" class="btn">💾 Export JSON</a>
            <a href="/admin/api/export?format=csv" class="btn">📊 Export CSV</a>
            <button onclick="location.reload()" class="btn btn-secondary">🔄 Refresh</button>
        </div>
    </div>
    
    <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
    </script>
</body>
</html>
  `;
}

/**
 * Convert submissions to CSV format
 */
function convertToCSV(submissions: any[]): string {
  if (submissions.length === 0) {
    return 'No submissions found';
  }
  
  // Get all unique field names
  const allFields = new Set<string>();
  submissions.forEach(sub => {
    Object.keys(sub.formData).forEach(field => allFields.add(field));
  });
  
  const fieldNames = Array.from(allFields);
  
  // Create CSV header
  const headers = [
    'ID',
    'Timestamp',
    'Form ID',
    'IP Address',
    'User Agent',
    'AMP Valid',
    'Do Not Track',
    ...fieldNames
  ];
  
  // Create CSV rows
  const rows = submissions.map(sub => {
    const row = [
      sub.id,
      sub.timestamp,
      sub.metadata.formStructure.formId,
      sub.metadata.ipAddress,
      sub.metadata.userAgent,
      sub.metadata.ampSignatureValid,
      sub.metadata.doNotTrack,
      ...fieldNames.map(field => sub.formData[field] || '')
    ];
    
    // Escape CSV values
    return row.map(value => {
      const str = String(value || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  });
  
  return [headers.join(','), ...rows].join('\n');
}

export default router;
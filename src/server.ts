import app from './app';
import { logger } from './utils/logger';
import config from '../config/default';
import { database } from './services/database';

/**
 * Start the AMP Webhook server
 */
async function startServer(): Promise<void> {
  try {
    // Initialize database connection
    logger.info('Initializing database...');
    // Database is initialized in its constructor
    
    // Start the server
    const server = app.listen(config.port, () => {
      logger.info('🚀 AMP Webhook Server started successfully', {
        port: config.port,
        environment: process.env.NODE_ENV || 'development',
        corsOrigins: config.corsOrigins.length,
        adminEnabled: config.admin.enabled,
        ampValidation: config.amp.validateSignatures
      });
      
      console.log(`
🎉 AMP Webhook Server is running!
`);
      console.log(`📡 Webhook endpoint: http://localhost:${config.port}/webhook`);
      console.log(`🏠 Health check: http://localhost:${config.port}/health`);
      console.log(`📊 Public stats: http://localhost:${config.port}/stats`);
      
      if (config.admin.enabled) {
        console.log(`👨‍💼 Admin dashboard: http://localhost:${config.port}/admin`);
        console.log(`   Username: ${config.admin.username}`);
        console.log(`   Password: ${config.admin.password}`);
      }
      
      console.log(`🧪 Test endpoint: http://localhost:${config.port}/test`);
      console.log(`\n📝 Replace webhook.site URLs in your AMP emails with:`);
      console.log(`   http://localhost:${config.port}/webhook?doNotTrackThis=1\n`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`⚠️  Development mode: AMP signature validation is disabled`);
        console.log(`⚠️  Change admin password before deploying to production!\n`);
      }
    });
    
    // Handle server errors
    server.on('error', (error: any) => {
      if (error?.code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is already in use`, { error: error?.message || 'Unknown error' });
        console.error(`\n❌ Error: Port ${config.port} is already in use.`);
        console.error(`   Please stop the other process or change the PORT environment variable.\n`);
      } else {
        logger.error('Server error', { error: error?.message || 'Unknown error', stack: error?.stack });
        console.error(`\n❌ Server error: ${error?.message || 'Unknown error'}\n`);
      }
      process.exit(1);
    });
    
    // Graceful shutdown
    const gracefulShutdown = (signal: string) => {
      logger.info(`${signal} received, starting graceful shutdown`);
      console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
      
      server.close((err: any) => {
        if (err) {
          logger.error('Error during server shutdown', { error: err?.message || 'Unknown error' });
          console.error(`❌ Error during shutdown: ${err?.message || 'Unknown error'}`);
          process.exit(1);
        }
        
        logger.info('Server closed successfully');
        console.log('✅ Server closed successfully');
        process.exit(0);
      });
      
      // Force close after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error: any) {
    logger.error('Failed to start server', {
      error: error?.message || 'Unknown error',
      stack: error?.stack
    });
    
    console.error(`\n❌ Failed to start server: ${error?.message || 'Unknown error'}\n`);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

export { startServer };
export default app;
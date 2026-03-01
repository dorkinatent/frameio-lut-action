import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger, serverLogger, generateRequestId } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { captureRawBody } from './middleware/verifySignature.js';
import { lutService } from './services/lutService.js';
import { storageService } from './services/storageService.js';

// Import routes
import authRoutes from './routes/auth.js';
import webhookRoutes from './routes/webhooks.js';
import lutRoutes from './routes/luts.js';
import jobRoutes from './routes/jobs.js';
import previewRoutes from './routes/preview.js';

// Create Express app
const app: Express = express();

// Trust proxy (for running behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-archon-signature', 'x-archon-timestamp'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Logging middleware
app.use(pinoHttp({
  logger,
  genReqId: generateRequestId,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (error: any, res: any) => {
    return `${error.message}`;
  },
  // Redact sensitive headers
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-archon-signature"]'],
    censor: '[REDACTED]',
  },
}));

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: captureRawBody as any, // Capture raw body for signature verification
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// API Routes
app.use('/auth', authRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/luts', lutRoutes);
app.use('/jobs', jobRoutes);
app.use('/preview', previewRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Server startup
async function startServer(): Promise<void> {
  try {
    serverLogger.info('Starting LUT Action service...');

    // Initialize services
    await lutService.initialize();
    await storageService.initialize();


    // Start server
    const port = config.PORT;
    app.listen(port, () => {
      serverLogger.info({ port, env: config.NODE_ENV }, `Server running on port ${port}`);
      serverLogger.info('LUT Action service started successfully');
    });
  } catch (error) {
    serverLogger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal: string): Promise<void> {
  serverLogger.info({ signal }, 'Received shutdown signal');

  try {
    // Stop accepting new connections
    serverLogger.info('Stopping server...');


    // Shutdown storage service
    await storageService.shutdown();

    serverLogger.info('Server shutdown complete');
    process.exit(0);
  } catch (error) {
    serverLogger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  serverLogger.fatal({ error }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  serverLogger.fatal({ reason, promise }, 'Unhandled rejection');
  process.exit(1);
});

// Start the server
startServer();
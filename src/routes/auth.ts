import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { writeFile } from 'fs/promises';
import { frameioAuth } from '../auth/frameioAuth.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { frameioLogger as logger } from '../logger.js';

const router = Router();

// OAuth callback query parameters schema
const OAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
});

/**
 * GET /auth/authorize
 * Redirect user to Adobe IMS OAuth authorization page
 */
router.get(
  '/authorize',
  asyncHandler(async (req: Request, res: Response) => {
    // Use PUBLIC_URL if set (for ngrok/production), otherwise construct from request
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl}/auth/callback`;
    const state = Math.random().toString(36).substring(7);
    
    // Store state in session or temporary storage for validation
    // For now, we'll just use it as-is
    
    const authUrl = frameioAuth.getAuthorizationUrl(redirectUri, state);
    
    logger.info({ redirectUri, state }, 'Redirecting to Adobe IMS for authorization');
    
    res.redirect(authUrl);
  }),
);

/**
 * GET /auth/callback
 * Handle OAuth callback from Adobe IMS
 */
router.get(
  '/callback',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ query: req.query }, 'Received OAuth callback');
    
    // Validate callback parameters
    const params = OAuthCallbackSchema.parse(req.query);
    
    // Use PUBLIC_URL if set (for ngrok/production), otherwise construct from request
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl}/auth/callback`;
    
    try {
      // Exchange code for tokens
      const tokens = await frameioAuth.exchangeCodeForTokens(params.code, redirectUri);
      
      logger.info('Successfully exchanged authorization code for tokens');
      
      // Save the token to a file for use by scripts
      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        expires_at: Date.now() + (tokens.expires_in * 1000),
        scope: tokens.scope,
        created_at: new Date().toISOString(),
      };
      
      await writeFile('.frameio-token', JSON.stringify(tokenData, null, 2));
      logger.info('Token saved to .frameio-token file');
      
      // Return HTML page with success message and next steps
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Frame.io Authentication Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .container {
              background: rgba(255, 255, 255, 0.1);
              backdrop-filter: blur(10px);
              border-radius: 20px;
              padding: 40px;
              max-width: 500px;
              text-align: center;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            }
            h1 {
              margin: 0 0 20px 0;
              font-size: 32px;
            }
            .success-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            .next-steps {
              background: rgba(255, 255, 255, 0.1);
              border-radius: 10px;
              padding: 20px;
              margin: 20px 0;
              text-align: left;
            }
            .step {
              margin: 10px 0;
              padding-left: 25px;
              position: relative;
            }
            .step:before {
              content: "→";
              position: absolute;
              left: 0;
            }
            .command {
              background: rgba(0, 0, 0, 0.3);
              padding: 10px;
              border-radius: 5px;
              font-family: 'Courier New', monospace;
              margin: 5px 0;
              word-break: break-all;
            }
            .note {
              font-size: 14px;
              opacity: 0.9;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Authentication Successful!</h1>
            <p>Your Frame.io access token has been saved automatically.</p>
            
            <div class="next-steps">
              <h3>Next Steps:</h3>
              <div class="step">Return to your terminal</div>
              <div class="step">Run the following commands:</div>
              <div class="command">npm run frameio:info</div>
              <div class="step">Select your account and workspace</div>
              <div class="command">npm run register:action</div>
              <div class="step">Your custom action will be registered!</div>
            </div>
            
            <div class="note">
              <strong>Token expires in:</strong> ${Math.round(tokens.expires_in / 3600)} hours<br>
              <strong>Scopes:</strong> ${tokens.scope || 'all'}
            </div>
          </div>
        </body>
        </html>
      `);
    } catch (error) {
      logger.error({ error }, 'Failed to exchange authorization code');
      
      // Return HTML error page
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #f5576c 0%, #f093fb 100%);
              color: white;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .container {
              background: rgba(255, 255, 255, 0.1);
              backdrop-filter: blur(10px);
              border-radius: 20px;
              padding: 40px;
              max-width: 500px;
              text-align: center;
            }
            .error-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            .command {
              background: rgba(0, 0, 0, 0.3);
              padding: 10px;
              border-radius: 5px;
              font-family: monospace;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Authentication Failed</h1>
            <p>Could not complete the OAuth flow. Please try again.</p>
            <div class="command">npm run dev</div>
            <p>Then navigate to /auth/authorize</p>
          </div>
        </body>
        </html>
      `);
    }
  }),
);

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken, userId } = req.body;
    
    if (!refreshToken || !userId) {
      throw createError('Missing refresh token or user ID', 400, 'MISSING_PARAMS');
    }
    
    try {
      const accessToken = await frameioAuth.getUserAccessToken(userId, refreshToken);
      
      res.json({
        success: true,
        access_token: accessToken,
      });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to refresh token');
      throw createError('Failed to refresh token', 401, 'REFRESH_FAILED');
    }
  }),
);

/**
 * GET /auth/status
 * Check authentication status
 */
router.get(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    // Check if we have valid S2S credentials
    const hasS2S = process.env.FRAMEIO_S2S_CLIENT_ID && process.env.FRAMEIO_S2S_CLIENT_SECRET;
    
    // Check if we have user OAuth credentials
    const hasUserOAuth = process.env.FRAMEIO_CLIENT_ID && process.env.FRAMEIO_CLIENT_SECRET;
    
    res.json({
      configured: hasS2S || hasUserOAuth,
      s2s: hasS2S,
      userOAuth: hasUserOAuth,
      redirectUri: `${req.protocol}://${req.get('host')}/auth/callback`,
    });
  }),
);

export default router;
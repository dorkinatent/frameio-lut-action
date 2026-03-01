#!/usr/bin/env node
import { frameioAuth } from '../src/auth/frameioAuth.js';
import { logger } from '../src/logger.js';
import { readFile, writeFile } from 'fs/promises';

async function refreshToken() {
  try {
    // Read current token
    const tokenData = await readFile('.frameio-token', 'utf-8');
    const stored = JSON.parse(tokenData);
    
    const expiresAt = new Date(stored.expires_at);
    const now = new Date();
    const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    logger.info({
      current_expiry: expiresAt.toISOString(),
      hours_until_expiry: hoursUntilExpiry.toFixed(1),
      has_refresh_token: !!stored.refresh_token
    }, 'Current token status');
    
    if (!stored.refresh_token) {
      logger.error('No refresh token available. Please re-authenticate.');
      process.exit(1);
    }
    
    // Force refresh
    logger.info('Forcing token refresh...');
    
    // Temporarily rename the token file to force a refresh
    const backup = JSON.parse(JSON.stringify(stored));
    stored.expires_at = Date.now() - 1000; // Set to expired
    await writeFile('.frameio-token', JSON.stringify(stored, null, 2));
    
    try {
      // This will trigger the refresh logic
      const newToken = await frameioAuth.getAccessToken();
      
      // Read the refreshed token
      const refreshedData = await readFile('.frameio-token', 'utf-8');
      const refreshed = JSON.parse(refreshedData);
      
      logger.info({
        old_expiry: expiresAt.toISOString(),
        new_expiry: new Date(refreshed.expires_at).toISOString(),
        refreshed_at: refreshed.refreshed_at,
      }, '✅ Token refreshed successfully!');
      
    } catch (error) {
      // Restore backup if refresh failed
      await writeFile('.frameio-token', JSON.stringify(backup, null, 2));
      throw error;
    }
    
  } catch (error) {
    logger.error({ error }, 'Failed to refresh token');
    process.exit(1);
  }
}

refreshToken().catch(console.error);
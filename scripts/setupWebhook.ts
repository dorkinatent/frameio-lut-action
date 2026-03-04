#!/usr/bin/env tsx

import axios from 'axios';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { config } from '../src/config.js';
import { logger } from '../src/logger.js';
import * as readline from 'readline/promises';

/**
 * Get access token for the script
 */
async function getAccessTokenForScript(): Promise<string> {
  const tokenFile = '.frameio-token';
  
  if (existsSync(tokenFile)) {
    try {
      const stored = JSON.parse(await readFile(tokenFile, 'utf-8'));
      if (stored.access_token && stored.expires_at > Date.now()) {
        logger.info('Using stored access token');
        return stored.access_token;
      }
    } catch (error) {
      logger.warn('Could not read stored token, will prompt for new one');
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const token = await rl.question('Enter your Frame.io access token: ');
  rl.close();

  return token.trim();
}

/**
 * Setup Frame.io webhook for asset events
 */
async function setupWebhook() {
  try {
    logger.info('Starting webhook setup...');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Get required information
    console.log('\n📝 Frame.io Webhook Setup');
    console.log('========================\n');
    
    const accountId = await rl.question('Enter your Frame.io Account ID: ');
    const workspaceId = await rl.question('Enter your Frame.io Workspace ID: ');
    
    console.log('\n🎯 Select webhook events to listen for:');
    console.log('1. File upload completed (for LUT sync)');
    console.log('2. File created');
    console.log('3. File ready (transcoding complete)');
    console.log('4. Comment created');
    console.log('5. All of the above');
    
    const eventChoice = await rl.question('\nSelect option (1-5): ');
    
    let events: string[] = [];
    switch (eventChoice) {
      case '1':
        events = ['file.upload.completed'];
        break;
      case '2':
        events = ['file.created'];
        break;
      case '3':
        events = ['file.ready'];
        break;
      case '4':
        events = ['comment.created'];
        break;
      case '5':
        events = ['file.upload.completed', 'file.created', 'file.ready', 'comment.created'];
        break;
      default:
        events = ['file.upload.completed'];
    }
    
    rl.close();

    // Get access token
    const accessToken = await getAccessTokenForScript();
    logger.info('Retrieved access token');

    // Create axios instance for Frame.io API
    const frameioApi = axios.create({
      baseURL: 'https://api.frame.io/v4',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Webhook configuration
    const webhookConfig = {
      url: (() => {
        if (!process.env.PUBLIC_URL) {
          console.error('\n❌ PUBLIC_URL environment variable is required.');
          console.error('   Set it to your ngrok or deployment URL.');
          process.exit(1);
        }
        return `${process.env.PUBLIC_URL}/webhooks/frameio/events`;
      })(),
      events: events,
      secret: config.FRAMEIO_WEBHOOK_SECRET,
      active: true,
      description: 'LUT Action Service Webhook',
    };

    logger.info('Creating webhook with Frame.io...');
    console.log('\n📡 Webhook Configuration:');
    console.log('URL:', webhookConfig.url);
    console.log('Events:', webhookConfig.events.join(', '));
    
    // Create the webhook
    const response = await frameioApi.post(
      `/accounts/${accountId}/workspaces/${workspaceId}/webhooks`,
      webhookConfig
    );

    logger.info('✅ Webhook created successfully!');
    console.log('\n📋 Webhook Details:');
    console.log('==========================');
    console.log('ID:', response.data.id);
    console.log('URL:', response.data.url);
    console.log('Events:', response.data.events);
    console.log('Status:', response.data.active ? 'Active' : 'Inactive');
    console.log('Created:', response.data.created_at);
    
    // Save the webhook ID for future reference
    await writeFile(
      '.webhook-id',
      response.data.id,
      'utf-8'
    );
    console.log(`\n💾 Webhook ID saved to .webhook-id for future reference`);
    
    console.log('\n🎉 Webhook setup complete!');
    console.log('Your service will now receive notifications for the selected events.');
    console.log('\nTo process LUTs when assets are created:');
    console.log('1. Add a comment to the asset with format: "LUT: <lut-name>"');
    console.log('2. The service will automatically apply the LUT and create a new version');

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Failed to create webhook:');
      console.error('Status:', error.response?.status);
      console.error('Response:', error.response?.data);
      
      if (error.response?.status === 401) {
        console.error('\n⚠️  Authentication failed. The access token may be expired or invalid.');
        try {
          await import('fs/promises').then(fs => fs.unlink('.frameio-token'));
        } catch {}
      }
    } else {
      logger.error({ error }, 'Unexpected error');
    }
    process.exit(1);
  }
}

// Run the setup
setupWebhook().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
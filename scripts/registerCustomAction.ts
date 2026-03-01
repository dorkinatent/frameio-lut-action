#!/usr/bin/env tsx

import axios from 'axios';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { config } from '../src/config.js';
import { lutService } from '../src/services/lutService.js';
import { logger } from '../src/logger.js';
import * as readline from 'readline/promises';

/**
 * Get access token for the script
 * First checks for a stored token, otherwise prompts for manual input
 */
async function getAccessTokenForScript(): Promise<string> {
  const tokenFile = '.frameio-token';
  
  // Check if we have a stored token
  if (existsSync(tokenFile)) {
    try {
      const stored = JSON.parse(await readFile(tokenFile, 'utf-8'));
      // Simple check if token looks valid (you might want to test it)
      if (stored.access_token && stored.expires_at > Date.now()) {
        logger.info('Using stored access token');
        return stored.access_token;
      }
    } catch (error) {
      logger.warn('Could not read stored token, will prompt for new one');
    }
  }

  // Prompt for access token
  console.log('\n📝 To register the custom action, you need a Frame.io access token.');
  console.log('   You can get one by:');
  console.log('   1. Starting the service: npm run dev');
  console.log('   2. Navigating to: ' + (process.env.PUBLIC_URL || 'http://localhost:8080') + '/auth/authorize');
  console.log('   3. Completing the OAuth flow');
  console.log('   4. The access token will be shown in the response');
  console.log('   5. Or use the Frame.io Developer Portal to generate a token\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const token = await rl.question('Enter your Frame.io access token: ');
  rl.close();

  // Optionally save the token for future use
  const saveAnswer = await readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  }).question('Save this token for future use? (y/n): ');
  
  if (saveAnswer.toLowerCase() === 'y') {
    await writeFile(tokenFile, JSON.stringify({
      access_token: token.trim(),
      expires_at: Date.now() + 24 * 60 * 60 * 1000, // Assume 24 hours
    }), 'utf-8');
    console.log('✅ Token saved to .frameio-token');
  }

  return token.trim();
}

/**
 * Get Frame.io account and workspace IDs
 */
async function getFrameioConfig(): Promise<{ account_id: string; workspace_id: string }> {
  const configFile = '.frameio-config';
  
  // Check if we have saved config
  if (existsSync(configFile)) {
    try {
      const config = JSON.parse(await readFile(configFile, 'utf-8'));
      if (config.account_id && config.workspace_id) {
        logger.info('Using saved Frame.io configuration');
        console.log(`\n📋 Using Account: ${config.account_name} (${config.account_id})`);
        console.log(`   Workspace: ${config.workspace_name} (${config.workspace_id})`);
        return { account_id: config.account_id, workspace_id: config.workspace_id };
      }
    } catch (error) {
      logger.warn('Could not read saved config');
    }
  }

  // Prompt for IDs
  console.log('\n⚠️  No Frame.io configuration found.');
  console.log('   Run "npm run frameio:info" first to get your account and workspace IDs\n');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const account_id = await rl.question('Enter your Frame.io Account ID: ');
  const workspace_id = await rl.question('Enter your Frame.io Workspace ID: ');
  rl.close();

  return { account_id: account_id.trim(), workspace_id: workspace_id.trim() };
}

/**
 * Register a custom action with Frame.io using the experimental API
 */
async function registerCustomAction() {
  try {
    logger.info('Starting custom action registration...');

    // Initialize services
    await lutService.initialize();

    // Get all LUTs to create the options
    const luts = await lutService.listLUTs();
    logger.info(`Found ${luts.length} LUTs to include in custom action`);

    if (luts.length === 0) {
      console.error('\n❌ No LUTs found! Please import some LUTs first:');
      console.error('   npm run import:luts ~/LUTs');
      console.error('   or');
      console.error('   npm run seed:luts\n');
      process.exit(1);
    }

    // Get access token and config
    const accessToken = await getAccessTokenForScript();
    logger.info('Retrieved access token');
    
    const { account_id, workspace_id } = await getFrameioConfig();
    logger.info('Retrieved Frame.io configuration');

    // Create axios instance for Frame.io experimental API
    const frameioApi = axios.create({
      baseURL: 'https://api.frame.io/v4',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'api-version': 'experimental', // Enable experimental API features
      },
    });

    // Custom action payload (simplified based on experimental API)
    const customActionPayload = {
      data: {
        name: 'Apply LUT (Local)',
        description: 'Apply color grading LUT to video assets',
        event: 'lut.apply', // Custom event name
        url: (() => {
          if (!process.env.PUBLIC_URL) {
            console.error('\n❌ PUBLIC_URL environment variable is required.');
            process.exit(1);
          }
          return `${process.env.PUBLIC_URL}/webhooks/frameio/custom-action`;
        })(),
      }
    };

    logger.info('Registering custom action with Frame.io...');
    logger.info(`Endpoint: /v4/accounts/${account_id}/workspaces/${workspace_id}/actions`);
    
    // Register the custom action using the experimental API endpoint
    const response = await frameioApi.post(
      `/accounts/${account_id}/workspaces/${workspace_id}/actions`,
      customActionPayload
    );

    logger.info('✅ Custom action registered successfully!');
    console.log('\n📋 Custom Action Details:');
    console.log('==========================');
    console.log('ID:', response.data.data.id);
    console.log('Name:', response.data.data.name);
    console.log('Description:', response.data.data.description);
    console.log('Event:', response.data.data.event);
    console.log('Webhook URL:', response.data.data.url);
    console.log('Secret:', response.data.data.secret ? '***' + response.data.data.secret.slice(-4) : 'Not provided');
    console.log('Created:', response.data.data.created_at);
    console.log('\n✨ The custom action is now available in your Frame.io workspace!');
    console.log('The action will be triggered when the specified event occurs.');
    console.log('\n💡 Multi-asset support:');
    console.log('   To enable selecting up to 100 assets at once, toggle "Multi-asset"');
    console.log('   in the Action\'s configuration modal at https://next.frame.io/settings/actions');
    
    // Save the webhook secret if provided
    if (response.data.data.secret) {
      console.log('\n⚠️  IMPORTANT: Save this webhook secret to your .env file:');
      console.log(`FRAMEIO_WEBHOOK_SECRET=${response.data.data.secret}`);
    }

    // Save the custom action details for future updates
    const actionDetails = {
      id: response.data.data.id,
      account_id,
      workspace_id,
      name: response.data.data.name,
      event: response.data.data.event,
      created_at: response.data.data.created_at,
    };
    
    const fs = await import('fs/promises');
    await fs.writeFile(
      '.custom-action-details',
      JSON.stringify(actionDetails, null, 2),
      'utf-8'
    );
    console.log(`\n💾 Custom action details saved to .custom-action-details for future reference`);

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Failed to register custom action:');
      console.error('Status:', error.response?.status);
      console.error('Response:', error.response?.data);
      
      if (error.response?.status === 404) {
        console.error('\n⚠️  Endpoint not found. Possible reasons:');
        console.error('1. Invalid account ID or workspace ID');
        console.error('2. Custom Actions API not available for this workspace');
        console.error('3. Experimental API not properly enabled');
        console.error('\nRun "npm run frameio:info" to verify your account and workspace IDs.');
      } else if (error.response?.status === 403) {
        console.error('\n⚠️  Access denied. Possible reasons:');
        console.error('1. Custom Actions API is not enabled for your account');
        console.error('2. Missing required permissions in this workspace');
        console.error('3. Account needs to be allowlisted for experimental features');
        console.error('\nContact Frame.io support to enable Custom Actions for your account.');
      } else if (error.response?.status === 401) {
        console.error('\n⚠️  Authentication failed. The access token may be expired or invalid.');
        console.error('Please obtain a fresh token and try again.');
        // Remove stored token if it exists
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

// Run the registration
registerCustomAction().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
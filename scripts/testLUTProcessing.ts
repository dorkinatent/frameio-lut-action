#!/usr/bin/env tsx

import axios from 'axios';
import { createHmac } from 'crypto';
import { config } from '../src/config.js';
import { lutService } from '../src/services/lutService.js';
import { logger } from '../src/logger.js';
import * as readline from 'readline/promises';

/**
 * Generate HMAC signature for webhook
 */
function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Test LUT processing with a sample webhook
 */
async function testLUTProcessing() {
  try {
    logger.info('Starting LUT processing test...');

    // Initialize LUT service to get available LUTs
    await lutService.initialize();
    const luts = await lutService.listLUTs();
    
    if (luts.length === 0) {
      console.error('\n❌ No LUTs found! Please import some LUTs first:');
      console.error('   npm run import:luts ~/LUTs');
      console.error('   or');
      console.error('   npm run seed:luts\n');
      process.exit(1);
    }

    console.log('\n📋 Available LUTs:');
    console.log('==================');
    luts.forEach((lut, index) => {
      console.log(`${index + 1}. ${lut.name} (${lut.type} - ${lut.colorspace})`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Get user inputs
    const lutChoice = await rl.question('\nSelect LUT number (1-' + luts.length + '): ');
    const selectedLUT = luts[parseInt(lutChoice) - 1];
    
    if (!selectedLUT) {
      console.error('Invalid LUT selection');
      process.exit(1);
    }

    const assetId = await rl.question('Enter Frame.io Asset ID: ');
    const workspaceId = await rl.question('Enter Frame.io Workspace ID: ');
    const accountId = await rl.question('Enter Frame.io Account ID: ');
    
    rl.close();

    // Create webhook payload
    const webhookPayload = {
      action: 'custom_action_triggered',
      customActionId: 'test-action',
      assetId: assetId.trim(),
      accountId: accountId.trim(),
      workspaceId: workspaceId.trim(),
      userId: 'test-user',
      formData: {
        lutId: selectedLUT.id,
      },
      timestamp: new Date().toISOString(),
    };

    const payloadString = JSON.stringify(webhookPayload);
    const signature = generateSignature(payloadString, config.FRAMEIO_WEBHOOK_SECRET);
    const timestamp = Date.now().toString();

    // Send webhook to local server
    const serviceUrl = process.env.PUBLIC_URL || 'http://localhost:8080';
    
    console.log('\n🚀 Sending webhook to service...');
    console.log('URL:', `${serviceUrl}/webhooks/frameio/custom-action`);
    console.log('LUT:', selectedLUT.name);
    console.log('Asset ID:', assetId);

    const response = await axios.post(
      `${serviceUrl}/webhooks/frameio/custom-action`,
      webhookPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-archon-signature': signature,
          'x-archon-timestamp': timestamp,
        },
      }
    );

    if (response.data.success) {
      console.log('\n✅ Webhook accepted successfully!');
      console.log('Job ID:', response.data.jobId);
      console.log('\nThe LUT processing job has been queued.');
      console.log('Check job status at:', `${serviceUrl}/jobs/${response.data.jobId}`);
      
      // Poll for job status
      console.log('\n📊 Polling job status...');
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes with 5-second intervals
      
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const statusResponse = await axios.get(`${serviceUrl}/jobs/${response.data.jobId}`);
          const job = statusResponse.data.job;
          
          console.log(`[${new Date().toLocaleTimeString()}] Status: ${job.status} | Progress: ${job.progress}%`);
          
          if (job.status === 'completed') {
            console.log('\n🎉 Job completed successfully!');
            console.log('Result:', job.result);
            clearInterval(pollInterval);
            process.exit(0);
          } else if (job.status === 'failed') {
            console.error('\n❌ Job failed!');
            console.error('Error:', job.error);
            clearInterval(pollInterval);
            process.exit(1);
          } else if (attempts >= maxAttempts) {
            console.log('\n⏱️ Job is taking longer than expected. Check status manually.');
            clearInterval(pollInterval);
            process.exit(0);
          }
        } catch (error) {
          console.error('Error checking job status:', error);
        }
      }, 5000);
      
    } else {
      console.error('\n❌ Webhook failed:', response.data.message);
    }

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('\n❌ Request failed:');
      console.error('Status:', error.response?.status);
      console.error('Response:', error.response?.data);
    } else {
      logger.error({ error }, 'Unexpected error');
    }
    process.exit(1);
  }
}

// Run the test
testLUTProcessing().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
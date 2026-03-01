#!/usr/bin/env node
import { readFile } from 'fs/promises';

async function getTokenForEnv() {
  try {
    const tokenData = await readFile('.frameio-token', 'utf-8');
    const token = JSON.parse(tokenData);
    
    console.log('\n📋 Copy this value and set it as FRAMEIO_TOKEN in Railway:\n');
    console.log(JSON.stringify(token));
    console.log('\n✅ To set in Railway:');
    console.log('1. Go to your Railway project');
    console.log('2. Click on your service');
    console.log('3. Go to Variables tab');
    console.log('4. Add FRAMEIO_TOKEN with the value above');
    console.log('\n⚠️  Note: You\'ll need to update this when the refresh token expires (every 14 days)');
    
  } catch (error) {
    console.error('❌ Failed to read token file. Make sure you have authenticated first.');
    console.error('Run: npm run frameio:info');
    process.exit(1);
  }
}

getTokenForEnv().catch(console.error);
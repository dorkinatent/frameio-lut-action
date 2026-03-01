#!/usr/bin/env tsx

import axios from 'axios';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Debug Frame.io API responses to understand the structure
 */
async function debugFrameioApi() {
  try {
    const tokenFile = '.frameio-token';
    
    if (!existsSync(tokenFile)) {
      console.error('❌ No token file found. Please complete OAuth flow first.');
      process.exit(1);
    }

    const stored = JSON.parse(await readFile(tokenFile, 'utf-8'));
    const accessToken = stored.access_token;
    
    const api = axios.create({
      baseURL: 'https://api.frame.io/v4',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Debug /me endpoint
    console.log('🔍 Testing /me endpoint...');
    try {
      const meResponse = await api.get('/me');
      console.log('\n/me response structure:');
      console.log('Full response keys:', Object.keys(meResponse.data));
      console.log('Response data:', JSON.stringify(meResponse.data, null, 2));
    } catch (error: any) {
      console.error('Error with /me:', error.response?.status, error.response?.data);
    }

    // Debug /accounts endpoint
    console.log('\n🔍 Testing /accounts endpoint...');
    try {
      const accountsResponse = await api.get('/accounts');
      console.log('\n/accounts response structure:');
      console.log('Full response keys:', Object.keys(accountsResponse.data));
      console.log('First account (if any):', JSON.stringify(accountsResponse.data.data?.[0] || accountsResponse.data[0], null, 2));
      
      // Try to get the actual account ID
      const accounts = accountsResponse.data.data || accountsResponse.data;
      if (Array.isArray(accounts) && accounts.length > 0) {
        const firstAccount = accounts[0];
        console.log('\nFirst account details:');
        console.log('ID:', firstAccount.id);
        console.log('Name:', firstAccount.name);
        console.log('Type:', firstAccount.type);
        
        // Try to get workspaces
        console.log(`\n🔍 Testing /accounts/${firstAccount.id}/workspaces endpoint...`);
        try {
          const workspacesResponse = await api.get(`/accounts/${firstAccount.id}/workspaces`);
          console.log('\n/workspaces response structure:');
          console.log('Full response keys:', Object.keys(workspacesResponse.data));
          console.log('First workspace (if any):', JSON.stringify(workspacesResponse.data.data?.[0] || workspacesResponse.data[0], null, 2));
        } catch (error: any) {
          console.error('Error with workspaces:', error.response?.status, error.response?.data);
        }
      }
    } catch (error: any) {
      console.error('Error with /accounts:', error.response?.status, error.response?.data);
    }

  } catch (error: any) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Run the debug script
debugFrameioApi().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
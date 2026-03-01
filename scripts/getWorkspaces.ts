#!/usr/bin/env tsx

import axios from 'axios';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as readline from 'readline/promises';

async function getWorkspaces() {
  let accountId: string;

  const configFile = '.frameio-config';
  if (existsSync(configFile)) {
    try {
      const cfg = JSON.parse(await readFile(configFile, 'utf-8'));
      if (cfg.account_id) {
        accountId = cfg.account_id;
        console.log(`Using account from .frameio-config: ${accountId}`);
      }
    } catch (e) {
      console.warn('Could not parse .frameio-config, prompting instead');
    }
  }

  if (!accountId) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    accountId = (await rl.question('Enter your Frame.io Account ID: ')).trim();
    rl.close();
    if (!accountId) {
      console.error('Account ID is required');
      process.exit(1);
    }
  }

  const tokenFile = '.frameio-token';
  if (!existsSync(tokenFile)) {
    console.error('No token file found. Run npm run frameio:info first');
    process.exit(1);
  }
  
  const stored = JSON.parse(await readFile(tokenFile, 'utf-8'));
  const token = stored.access_token;
  
  const response = await axios.get(
    `https://api.frame.io/v4/accounts/${accountId}/workspaces`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    }
  );
  
  console.log('\nWorkspaces:');
  console.log('=====================================');
  
  response.data.data.forEach((workspace: any, index: number) => {
    console.log(`${index + 1}. ${workspace.name}`);
    console.log(`   ID: ${workspace.id}`);
    console.log(`   URL Slug: ${workspace.url_slug || 'N/A'}`);
    console.log('');
  });
}

getWorkspaces().catch(console.error);
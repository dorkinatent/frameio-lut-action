import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { frameioService } from './frameioService.js';
import { serverLogger as logger } from '../logger.js';

interface FrameioConfig {
  account_id: string;
  workspace_id: string;
}

interface WebhookState {
  webhookId: string;
  accountId: string;
  secret: string;
}

const STATE_PATH = '.frameio-webhook';

let webhookSecret: string | null = null;

/**
 * Get the signing secret for the dynamically-created event webhook.
 * Returns null if no webhook has been registered yet.
 */
export function getEventWebhookSecret(): string | null {
  return webhookSecret;
}

/**
 * Clean up any webhook left over from a previous run that was force-killed.
 */
async function cleanupStaleWebhook(): Promise<void> {
  if (!existsSync(STATE_PATH)) return;

  let prev: WebhookState;
  try {
    prev = JSON.parse(await readFile(STATE_PATH, 'utf-8'));
  } catch (err) {
    logger.debug({ err }, 'Could not read stale webhook state, removing corrupt file');
    await unlink(STATE_PATH).catch(() => {});
    return;
  }

  try {
    logger.info({ webhookId: prev.webhookId }, 'Found stale webhook from previous run, deleting');
    await frameioService.deleteWebhook(prev.accountId, prev.webhookId);
    logger.info({ webhookId: prev.webhookId }, 'Deleted stale webhook');
    await unlink(STATE_PATH).catch(() => {});
  } catch (err) {
    logger.warn({ err, webhookId: prev.webhookId }, 'Could not delete stale webhook, preserving state for next attempt');
  }
}

/**
 * Register event webhooks with Frame.io.
 * Reads account/workspace IDs from `.frameio-config` (created by `npm run frameio:info`).
 * Gracefully skips if config is missing or PUBLIC_URL is not set.
 *
 * On startup, any leftover webhook from a previous force-killed run is cleaned up first.
 */
export async function registerEventWebhook(): Promise<void> {
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    logger.warn('PUBLIC_URL not set — skipping automatic webhook registration');
    return;
  }

  const configPath = '.frameio-config';
  if (!existsSync(configPath)) {
    logger.warn('No .frameio-config found (run "npm run frameio:info" first) — skipping webhook registration');
    return;
  }

  let fioConfig: FrameioConfig;
  try {
    fioConfig = JSON.parse(await readFile(configPath, 'utf-8'));
  } catch (err) {
    logger.error({ err }, 'Failed to parse .frameio-config');
    return;
  }

  if (!fioConfig.account_id || !fioConfig.workspace_id) {
    logger.warn('Incomplete .frameio-config — skipping webhook registration');
    return;
  }

  await cleanupStaleWebhook();

  const url = `${publicUrl}/webhooks/frameio/events`;

  try {
    const result = await frameioService.createWebhook(
      fioConfig.account_id,
      fioConfig.workspace_id,
      `LUT Sync (dev ${new Date().toISOString().slice(0, 16)})`,
      url,
      ['file.upload.completed', 'file.deleted'],
    );

    webhookSecret = result.secret;

    const state: WebhookState = {
      webhookId: result.id,
      accountId: fioConfig.account_id,
      secret: result.secret,
    };

    try {
      await writeFile(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
    } catch (writeErr) {
      webhookSecret = null;
      try {
        await frameioService.deleteWebhook(fioConfig.account_id, result.id);
      } catch (deleteErr) {
        logger.error({ deleteErr, webhookId: result.id }, 'Failed to roll back orphaned webhook after state persistence failure');
      }
      throw writeErr;
    }

    logger.info({ webhookId: result.id, url }, 'Registered event webhook');
  } catch (err) {
    logger.error({ err }, 'Failed to register event webhook — LUT sync from Frame.io will not work');
  }
}

/**
 * Delete the webhook that was created during startup and remove the state file.
 * Safe to call even if registration was skipped or already cleaned up.
 */
export async function deregisterEventWebhook(): Promise<void> {
  if (!existsSync(STATE_PATH)) return;

  try {
    const state: WebhookState = JSON.parse(await readFile(STATE_PATH, 'utf-8'));
    await frameioService.deleteWebhook(state.accountId, state.webhookId);
    logger.info({ webhookId: state.webhookId }, 'Deleted event webhook');
    webhookSecret = null;
    await unlink(STATE_PATH).catch(() => {});
  } catch (err) {
    logger.warn({ err }, 'Failed to delete event webhook (will be cleaned up on next start)');
  }
}

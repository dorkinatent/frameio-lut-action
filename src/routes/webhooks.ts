import { Router, Request, Response, NextFunction } from 'express';
import { existsSync, createWriteStream } from 'fs';
import { readFile, writeFile, unlink } from 'fs/promises';
import { join, extname, basename, resolve } from 'path';
import { createHmac, timingSafeEqual } from 'crypto';
import { pipeline } from 'stream/promises';
import { z } from 'zod';
import axios from 'axios';
import { verifySignature, type SignedRequest } from '../middleware/verifySignature.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { processLUTJob } from '../services/simpleJobProcessor.js';
import { webhookLogger as logger } from '../logger.js';
import { LUTJobRequestSchema } from '../types/jobs.js';
import { config } from '../config.js';
import { frameioService } from '../services/frameioService.js';
import { getEventWebhookSecret } from '../services/webhookLifecycle.js';

const router = Router();

const ResourceSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['file', 'folder', 'version_stack']),
});

// Accepts both legacy single-asset (`resource`) and multi-asset (`resources`) payloads.
// See https://next.developer.frame.io/platform/docs/guides/custom-actions#multi-asset-configuration
const CustomActionPayloadSchema = z.object({
  account_id: z.string().uuid(),
  action_id: z.string().uuid(),
  interaction_id: z.string().uuid(),
  project: z.object({
    id: z.string().uuid(),
  }),
  resource: ResourceSchema.optional(),
  resources: z.array(ResourceSchema).min(1).max(100).optional(),
  type: z.string(),
  user: z.object({
    id: z.string().uuid(),
  }),
  workspace: z.object({
    id: z.string().uuid(),
  }),
  data: z.record(z.unknown()).optional(),
}).refine(
  (data) => data.resource || data.resources,
  { message: 'Payload must include either `resource` or `resources`' },
);

/**
 * Normalize legacy single-asset and multi-asset payloads into a single array.
 */
function getResources(payload: z.infer<typeof CustomActionPayloadSchema>) {
  if (payload.resources) return payload.resources;
  if (payload.resource) return [payload.resource];
  return [];
}

/**
 * POST /webhooks/frameio/custom-action
 * Handle Frame.io custom action webhook (single and multi-asset)
 */
router.post(
  '/frameio/custom-action',
  verifySignature,
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Received custom action webhook');

    const payload = CustomActionPayloadSchema.parse(req.body);
    const resources = getResources(payload);

    logger.info(
      { resourceCount: resources.length, types: resources.map((r) => r.type) },
      'Resolved resources from payload',
    );

    if (payload.data && payload.data.lutId) {
      // User has selected a LUT — kick off a job for every resource
      const jobIds: string[] = [];
      for (const resource of resources) {
        const jobRequest = LUTJobRequestSchema.parse({
          assetId: resource.id,
          sourceVersionId: null,
          lutId: payload.data.lutId as string,
          idempotencyKey: `${payload.interaction_id}_${resource.id}`,
          requestedBy: payload.user.id,
          accountId: payload.account_id,
          workspaceId: payload.workspace.id,
          metadata: {
            projectId: payload.project.id,
            resourceType: resource.type,
          },
        });

        const jobId = await processLUTJob(jobRequest);
        jobIds.push(jobId);
      }

      logger.info({ jobIds, payload }, 'LUT jobs started successfully');

      const assetWord = resources.length === 1 ? 'asset' : 'assets';
      res.json({
        title: 'LUT Processing Started',
        description: `Applying LUT to ${resources.length} ${assetWord}. Job IDs: ${jobIds.join(', ')}`,
      });
    } else {
      // First interaction — show LUT selection form
      const { lutService } = await import('../services/lutService.js');
      const luts = await lutService.listLUTs();

      const lutOptions = luts.map((lut) => ({
        name: lut.name,
        value: lut.id,
      }));

      const assetCount = resources.length;
      const description =
        assetCount === 1
          ? 'Choose a LUT to apply to your video'
          : `Choose a LUT to apply to ${assetCount} selected videos`;

      // Build a preview URL for the first resource so users can compare looks
      const firstResource = resources[0];
      const publicUrl = process.env.PUBLIC_URL || `http://localhost:${config.PORT}`;
      const previewUrl = `${publicUrl}/preview?accountId=${payload.account_id}&assetId=${firstResource.id}`;

      const formResponse = {
        title: 'Select a LUT',
        description,
        fields: [
          {
            type: 'link',
            label: 'Preview LUTs on your footage',
            name: 'previewLink',
            value: previewUrl,
          },
          {
            type: 'select',
            label: 'LUT',
            name: 'lutId',
            options: lutOptions,
          },
        ],
      };

      logger.info({ formResponse, assetCount }, 'Returning LUT selection form');
      res.json(formResponse);
    }
  }),
);

// ---------------------------------------------------------------------------
// Frame.io event webhooks (file.upload.completed, etc.)
// ---------------------------------------------------------------------------

const EventPayloadSchema = z.object({
  type: z.string(),
  account: z.object({ id: z.string().uuid() }),
  project: z.object({ id: z.string().uuid() }),
  resource: z.object({
    id: z.string().uuid(),
    type: z.string(),
  }),
  user: z.object({ id: z.string().uuid() }),
  workspace: z.object({ id: z.string().uuid() }),
});

const LUT_DOWNLOAD_DIR = join(process.cwd(), 'luts');
const SYNC_MAP_PATH = join(LUT_DOWNLOAD_DIR, '.frameio-sync.json');
const SAFE_FILENAME_RE = /^[A-Za-z0-9_\-. ]+\.cube$/;

/**
 * Sanitize an external filename: strip path components, reject traversal
 * sequences and characters outside a safe whitelist.
 */
function sanitizeFilename(raw: string): string | null {
  const name = basename(raw);
  if (!SAFE_FILENAME_RE.test(name)) return null;
  const full = resolve(LUT_DOWNLOAD_DIR, name);
  if (!full.startsWith(resolve(LUT_DOWNLOAD_DIR) + '/')) return null;
  return name;
}

type SyncMap = Record<string, string>;

let syncMapLock: Promise<void> = Promise.resolve();

async function loadSyncMap(): Promise<SyncMap> {
  try {
    return JSON.parse(await readFile(SYNC_MAP_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveSyncMap(map: SyncMap): Promise<void> {
  await writeFile(SYNC_MAP_PATH, JSON.stringify(map, null, 2));
}

async function updateSyncMap(mutator: (map: SyncMap) => void): Promise<void> {
  const prev = syncMapLock;
  let release!: () => void;
  syncMapLock = new Promise<void>((r) => { release = r; });
  await prev;
  try {
    const map = await loadSyncMap();
    mutator(map);
    await saveSyncMap(map);
  } finally {
    release();
  }
}

/**
 * Verify the signature of an event webhook using the dynamically-issued
 * secret from webhook creation (falls back to static FRAMEIO_WEBHOOK_SECRET).
 */
function verifyEventSignature(req: SignedRequest, res: Response, next: NextFunction): void {
  const secret = getEventWebhookSecret() || config.FRAMEIO_WEBHOOK_SECRET;

  const signature = req.headers['x-frameio-signature'] as string;
  const timestamp = req.headers['x-frameio-request-timestamp'] as string;

  if (!signature || !timestamp) {
    res.status(401).json({ error: 'Missing signature or timestamp header' });
    return;
  }

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    res.status(401).json({ error: 'Invalid or expired timestamp' });
    return;
  }

  const body = req.rawBody
    ? req.rawBody.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body);

  const expected = createHmac('sha256', secret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex');

  const [, provided] = (signature || '').split('=');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided || '');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logger.warn('Invalid event webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

/**
 * POST /webhooks/frameio/events
 * Handle Frame.io event webhooks for LUT sync:
 *   file.upload.completed → download .cube to local luts/
 *   file.deleted          → remove the corresponding local .cube
 */
router.post(
  '/frameio/events',
  verifyEventSignature,
  asyncHandler(async (req: Request, res: Response) => {
    const payload = EventPayloadSchema.parse(req.body);
    logger.info({ type: payload.type, resourceId: payload.resource.id }, 'Received Frame.io event');

    if (payload.resource.type !== 'file') {
      res.json({ ignored: true, reason: 'Not a file resource' });
      return;
    }

    const { id: fileId } = payload.resource;
    const accountId = payload.account.id;

    if (payload.type === 'file.upload.completed') {
      return await handleFileUploaded(fileId, accountId, res);
    }

    if (payload.type === 'file.deleted') {
      return await handleFileDeleted(fileId, res);
    }

    res.json({ ignored: true, reason: `Unhandled event: ${payload.type}` });
  }),
);

const DOWNLOAD_TIMEOUT_MS = 30_000;

async function handleFileUploaded(fileId: string, accountId: string, res: Response) {
  const file = await frameioService.getFile(fileId, accountId);

  if (!file.name || extname(file.name).toLowerCase() !== '.cube') {
    logger.debug({ fileId, name: file.name }, 'Ignoring non-.cube file');
    res.json({ ignored: true, reason: 'Not a .cube file' });
    return;
  }

  const safeName = sanitizeFilename(file.name);
  if (!safeName) {
    logger.warn({ fileId, name: file.name }, 'Rejected unsafe LUT filename');
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const parentId = file.parent_id;
  if (!parentId) {
    res.json({ ignored: true, reason: 'No parent folder' });
    return;
  }

  if (!(await checkIsLutFolder(parentId, accountId))) {
    logger.debug({ fileId, parentId }, 'File is not in the LUT folder, skipping');
    res.json({ ignored: true, reason: 'Not in LUT folder' });
    return;
  }

  const localPath = join(LUT_DOWNLOAD_DIR, safeName);
  if (existsSync(localPath)) {
    logger.info({ name: safeName }, 'LUT already exists locally, skipping');
    res.json({ ignored: true, reason: 'Already exists locally' });
    return;
  }

  const downloadUrl = await frameioService.getDownloadUrl(fileId, accountId);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
      signal: abort.signal,
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    await pipeline(response.data, createWriteStream(localPath));
  } catch (err) {
    await unlink(localPath).catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }

  await updateSyncMap((map) => { map[fileId] = safeName; });

  logger.info({ name: safeName, localPath }, 'Synced LUT from Frame.io');
  res.json({ synced: true, name: safeName });
}

async function handleFileDeleted(fileId: string, res: Response) {
  let removedName: string | null = null;

  await updateSyncMap((map) => {
    const filename = map[fileId];
    if (!filename) return;

    const safeName = sanitizeFilename(filename);
    if (!safeName) {
      logger.warn({ fileId, filename }, 'Sync map contained unsafe filename, purging entry');
      delete map[fileId];
      return;
    }

    const localPath = join(LUT_DOWNLOAD_DIR, safeName);
    if (existsSync(localPath)) {
      // unlink is async but we fire-and-forget inside the sync mutator;
      // the file watcher will handle registry cleanup regardless.
      unlink(localPath).catch((err) =>
        logger.warn({ localPath, err }, 'Failed to remove local LUT file'),
      );
      logger.info({ name: safeName, localPath }, 'Removed local LUT (deleted from Frame.io)');
    }

    removedName = safeName;
    delete map[fileId];
  });

  if (!removedName) {
    res.json({ ignored: true, reason: 'Asset not in sync map' });
    return;
  }

  res.json({ removed: true, name: removedName });
}

/**
 * Check whether a folder matches the configured LUT folder.
 * If FRAMEIO_LUT_FOLDER_ID is set, compare by ID.
 * Otherwise, match any folder named "luts" (case-insensitive).
 */
async function checkIsLutFolder(folderId: string, accountId: string): Promise<boolean> {
  if (config.FRAMEIO_LUT_FOLDER_ID) {
    return folderId === config.FRAMEIO_LUT_FOLDER_ID;
  }
  try {
    const folder = await frameioService.getFolder(folderId, accountId);
    return folder.name.toLowerCase() === 'luts';
  } catch (err) {
    logger.warn({ folderId, err }, 'Could not fetch parent folder');
    return false;
  }
}

/**
 * POST /webhooks/test
 * Test webhook endpoint (no signature verification)
 */
router.post(
  '/test',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Received test webhook');

    // Echo back the payload
    res.json({
      received: true,
      timestamp: new Date().toISOString(),
      payload: req.body,
    });
  }),
);

export default router;
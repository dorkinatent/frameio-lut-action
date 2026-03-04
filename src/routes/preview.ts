import { Router, Request, Response } from 'express';
import { existsSync } from 'fs';
import { mkdir, rm, readFile, writeFile } from 'fs/promises';
import { join, resolve, basename } from 'path';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../logger.js';
import { config, TEMP_PROCESSING_DIR } from '../config.js';
import { downloadAsset } from '../services/frameioProcessor.js';
import { lutService } from '../services/lutService.js';
import { extractFrameWithLUTs } from '../ffmpeg/extractFrame.js';

const router = Router();

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const SAFE_FILENAME_RE = /^[A-Za-z0-9_-]+\.(jpg|jpeg|png)$/;
const PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * GET /preview
 * Generate and display LUT preview thumbnails for a Frame.io asset.
 * Query params: accountId, assetId
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const accountId = (req.query.accountId as string | undefined)?.trim().replace(/\\+$/, '');
    const assetId = (req.query.assetId as string | undefined)?.trim().replace(/\\+$/, '');

    if (!accountId || !assetId) {
      res.status(400).json({ error: 'Missing required query params: accountId, assetId' });
      return;
    }

    if (!SAFE_ID_RE.test(assetId)) {
      res.status(400).json({ error: 'Invalid assetId' });
      return;
    }

    const previewDir = join(TEMP_PROCESSING_DIR, 'previews', assetId);

    try {
      // Build a fingerprint of the current LUT set so we can bust the cache
      // when LUTs are added or removed.
      const currentLuts = await lutService.listLUTs();
      const lutFingerprint = currentLuts
        .map((l) => l.id)
        .sort()
        .join(',');

      // Check if previews are already cached (with TTL + LUT fingerprint)
      const cacheMarker = join(previewDir, '.done');
      if (existsSync(cacheMarker)) {
        try {
          const markerData = JSON.parse(await readFile(cacheMarker, 'utf-8'));
          const age = Date.now() - new Date(markerData.generatedAt).getTime();
          const lutSetChanged = markerData.lutFingerprint !== lutFingerprint;
          if (age > PREVIEW_CACHE_TTL_MS) {
            logger.info({ assetId, ageMs: age }, 'Preview cache expired, regenerating');
            await rm(previewDir, { recursive: true, force: true });
          } else if (lutSetChanged) {
            logger.info({ assetId }, 'LUT set changed since last preview, regenerating');
            await rm(previewDir, { recursive: true, force: true });
          } else {
            logger.info({ assetId }, 'Serving cached preview');
            return await servePreviews(res, previewDir, assetId as string);
          }
        } catch {
          logger.warn({ assetId }, 'Invalid cache marker, regenerating');
          await rm(previewDir, { recursive: true, force: true });
        }
      }

      await mkdir(previewDir, { recursive: true });

      // Download the asset to a temp location
      const downloadDir = join(previewDir, '_download');
      await mkdir(downloadDir, { recursive: true });
      logger.info({ assetId, accountId }, 'Downloading asset for preview');
      const inputPath = await downloadAsset(
        assetId as string,
        downloadDir,
        accountId as string,
      );

      const lutEntries = currentLuts.map((lut) => ({
        id: lut.id,
        name: lut.name,
        path: lut.storageUri.startsWith('file://') ? lut.storageUri.replace('file://', '') : lut.storageUri,
      }));

      // Extract frames with each LUT applied
      const thumbDir = join(previewDir, 'thumbs');
      logger.info({ assetId, lutCount: lutEntries.length }, 'Generating preview frames');
      const results = await extractFrameWithLUTs(inputPath, thumbDir, lutEntries, {
        timestamp: 2,
        width: 480,
      });

      // Clean up the downloaded video — we only need the thumbnails
      await rm(downloadDir, { recursive: true, force: true });

      // Write cache marker with LUT fingerprint for invalidation
      await writeFile(cacheMarker, JSON.stringify({
        generatedAt: new Date().toISOString(),
        count: results.length,
        lutFingerprint,
      }));

      await servePreviews(res, previewDir, assetId as string);
    } catch (error) {
      logger.error({ assetId, error }, 'Failed to generate previews');
      await rm(previewDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }),
);

/**
 * GET /preview/thumb/:assetId/:filename
 * Serve an individual thumbnail JPEG.
 */
router.get(
  '/thumb/:assetId/:filename',
  asyncHandler(async (req: Request, res: Response) => {
    const { assetId, filename } = req.params;

    if (!SAFE_ID_RE.test(assetId) || !SAFE_FILENAME_RE.test(filename)) {
      res.status(400).json({ error: 'Invalid assetId or filename' });
      return;
    }

    const safeBase = resolve(TEMP_PROCESSING_DIR, 'previews');
    const filePath = resolve(safeBase, assetId, 'thumbs', basename(filename));
    if (!filePath.startsWith(safeBase + '/')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Thumbnail not found' });
      return;
    }

    const data = await readFile(filePath);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(data);
  }),
);

async function servePreviews(res: Response, previewDir: string, assetId: string) {
  const thumbDir = join(previewDir, 'thumbs');
  const { readdir } = await import('fs/promises');
  const files = await readdir(thumbDir);

  const luts = await lutService.listLUTs();
  const lutMap = new Map(luts.map((l) => [l.id, l.name]));

  const thumbnails = files
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => {
      const id = f.replace('.jpg', '');
      const isOriginal = id === 'original';
      return {
        id: isOriginal ? null : id,
        name: isOriginal ? 'Original (No LUT)' : lutMap.get(id) || id,
        url: `/preview/thumb/${assetId}/${f}`,
        isOriginal,
      };
    })
    .sort((a, b) => {
      if (a.isOriginal) return -1;
      if (b.isOriginal) return 1;
      return a.name.localeCompare(b.name);
    });

  const html = renderPreviewPage(assetId, thumbnails);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

interface Thumbnail {
  id: string | null;
  name: string;
  url: string;
  isOriginal: boolean;
}

function renderPreviewPage(assetId: string, thumbnails: Thumbnail[]): string {
  const cards = thumbnails
    .map(
      (t) => `
      <div class="card${t.isOriginal ? ' original' : ''}">
        <img src="${t.url}" alt="${escapeHtml(t.name)}" loading="lazy" />
        <div class="label">${escapeHtml(t.name)}</div>
      </div>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LUT Preview — ${escapeHtml(assetId.slice(0, 8))}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d0d0d;
      color: #e0e0e0;
      padding: 24px;
    }
    h1 {
      font-size: 1.4rem;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .subtitle {
      color: #888;
      font-size: 0.85rem;
      margin-bottom: 24px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .card {
      background: #1a1a1a;
      border-radius: 8px;
      overflow: hidden;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .card.original {
      border: 2px solid #3b82f6;
    }
    .card img {
      width: 100%;
      display: block;
      aspect-ratio: 16 / 9;
      object-fit: cover;
    }
    .label {
      padding: 10px 12px;
      font-size: 0.85rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card.original .label { color: #3b82f6; }
  </style>
</head>
<body>
  <h1>LUT Preview</h1>
  <p class="subtitle">${thumbnails.length} looks generated for asset ${escapeHtml(assetId.slice(0, 8))}…</p>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`;
}

export default router;

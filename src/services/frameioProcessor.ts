import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { frameioService } from './frameioService.js';
import { logger } from '../logger.js';

/**
 * Download an asset from Frame.io
 */
export async function downloadAsset(
  assetId: string,
  tempDir: string,
  accountId: string,
): Promise<string> {

  const file = await frameioService.getFile(assetId, accountId);
  logger.info({ assetId, accountId, name: file.name }, 'Got asset details');

  const downloadUrl = await frameioService.getDownloadUrl(assetId, accountId);
  logger.info({ assetId }, 'Got download URL');

  const ext = path.extname(file.name) || '.mp4';
  const outputPath = path.join(tempDir, `input_${assetId}${ext}`);

  logger.info({ assetId, outputPath }, 'Downloading asset');
  const response = await axios({
    method: 'GET',
    url: downloadUrl,
    responseType: 'stream',
  });

  const writer = createWriteStream(outputPath);
  await pipeline(response.data, writer);

  logger.info({ assetId, outputPath, size: file.file_size }, 'Asset downloaded successfully');
  return outputPath;
}

/**
 * Upload processed video back to Frame.io as a new version
 */
export async function uploadProcessedVideo(
  filePath: string,
  originalAssetId: string,
  lutName: string,
  accountId: string,
): Promise<{ id: string; versionId: string }> {

  const fileName = path.basename(filePath);
  const fileStats = await fs.stat(filePath);

  logger.info({ originalAssetId, accountId, fileName, size: fileStats.size }, 'Starting upload process');

  const originalFile = await frameioService.getFile(originalAssetId, accountId);
  const parentId = originalFile.parent_id;

  if (!parentId) {
    throw new Error('Original asset has no parent folder');
  }

  // parent_id of a file is always a folder — upload directly to it
  logger.info({ parentId, fileName: originalFile.name, size: fileStats.size }, 'Creating upload in parent folder');
  const newFile = await frameioService.createLocalUpload(
    accountId,
    parentId,
    originalFile.name,
    fileStats.size,
  );

  const uploadUrls = newFile.upload_urls;
  const fileId = newFile.id;
  if (!uploadUrls || uploadUrls.length === 0 || !fileId) {
    throw new Error('No upload URLs or file ID returned from createLocalUpload');
  }

  logger.info({ fileId, chunks: uploadUrls.length, mediaType: newFile.media_type }, 'Uploading processed file');
  await frameioService.uploadChunked(
    uploadUrls,
    filePath,
    newFile.media_type,
    (percent) => logger.debug({ fileId, percent }, 'Upload progress'),
  );

  logger.info({ originalAssetId, processedFileId: fileId }, 'Creating version stack');
  const versionStack = await frameioService.createVersionStack(
    accountId,
    parentId,
    originalAssetId,
    fileId,
  );

  try {
    await frameioService.postComment(
      fileId,
      `✨ LUT "${lutName}" has been applied to this video`,
      accountId,
    );
  } catch (commentError) {
    logger.warn({ fileId, error: commentError }, 'Failed to post comment, but upload succeeded');
  }

  logger.info({
    originalAssetId,
    processedFileId: fileId,
    versionStackId: versionStack.id,
  }, 'Successfully created version stack with processed video');

  return { id: fileId, versionId: versionStack.id };
}

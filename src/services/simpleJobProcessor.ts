import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { LUTJobRequest, JobStatus, JobResult } from '../types/jobs.js';
import { applyLUT } from '../ffmpeg/applyLUT.js';
import { downloadAsset, uploadProcessedVideo } from './frameioProcessor.js';
import { processVideoRemotely } from './remoteFrameioProcessor.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

// In-memory job storage (could be replaced with a database later)
const jobs = new Map<string, {
  id: string;
  status: JobStatus;
  request: LUTJobRequest;
  result?: JobResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}>();

/**
 * Process a LUT job synchronously
 */
export async function processLUTJob(request: LUTJobRequest): Promise<string> {
  const jobId = `job_${randomUUID()}`;
  
  // Store job in memory
  jobs.set(jobId, {
    id: jobId,
    status: 'pending',
    request,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Process in background (fire and forget)
  processJobAsync(jobId, request).catch(error => {
    logger.error({ jobId, error }, 'Failed to process job');
    updateJobStatus(jobId, 'failed', undefined, error.message);
  });

  return jobId;
}

/**
 * Get job status
 */
export function getJobStatus(jobId: string) {
  return jobs.get(jobId);
}

/**
 * Update job status
 */
function updateJobStatus(
  jobId: string, 
  status: JobStatus, 
  result?: JobResult, 
  error?: string
) {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    job.updatedAt = new Date();
    if (result) job.result = result;
    if (error) job.error = error;
  }
}

/**
 * Post a progress comment on the original asset. Best-effort — never throws.
 */
async function postProgress(assetId: string, accountId: string, message: string) {
  try {
    const { frameioService } = await import('./frameioService.js');
    await frameioService.postComment(assetId, message, accountId);
  } catch (err) {
    logger.debug({ assetId, err }, 'Progress comment failed (non-fatal)');
  }
}

/**
 * Process job asynchronously
 */
async function processJobAsync(jobId: string, request: LUTJobRequest) {
  logger.info({ jobId, request, processingMode: config.PROCESSING_MODE }, 'Starting job processing');
  updateJobStatus(jobId, 'processing');

  const startTime = Date.now();
  
  try {
    // Step 1: Get LUT
    logger.info({ jobId, lutId: request.lutId }, 'Getting LUT');
    const { lutService } = await import('./lutService.js');
    const lut = await lutService.getLUT(request.lutId);
    
    if (!lut) {
      throw new Error(`LUT not found: ${request.lutId}`);
    }

    // Get the actual LUT file path
    const lutPath = lut.storageUri.startsWith('file://') 
      ? lut.storageUri.replace('file://', '') 
      : lut.storageUri;

    // Use remote processing for Railway/cloud deployments
    if (config.PROCESSING_MODE === 'remote') {
      logger.info({ jobId, mode: 'remote' }, 'Using remote processing mode');
      await postProgress(request.assetId, request.accountId, `🎨 Processing with "${lut.name}"…`);

      const uploadResult = await processVideoRemotely(
        request.assetId,
        lutPath,
        request.accountId,
        lut.name
      );

      // Calculate processing duration
      const duration = Date.now() - startTime;

      // Update job status with results
      const result: JobResult = {
        outputAssetId: uploadResult.id,
        outputVersionId: uploadResult.versionId,
        duration,
        inputProperties: {
          fileSize: 0, // Not available in remote mode
        },
        outputProperties: {
          fileSize: 0, // Not available in remote mode
          codec: 'h264',
          container: 'mp4',
        },
        lutApplied: {
          id: lut.id,
          name: lut.name,
          type: lut.type,
          colorspace: lut.colorspace,
        },
      };

      updateJobStatus(jobId, 'completed', result);
      logger.info({ jobId, result }, 'Job completed successfully (remote mode)');
      
    } else {
      // Use local processing (existing code)
      logger.info({ jobId, mode: 'local' }, 'Using local processing mode');
      
      const tempDir = path.join(config.TMP_DIR, jobId);
      
      try {
        // Create temp directory
        await fs.mkdir(tempDir, { recursive: true });

        // Step 2: Download asset from Frame.io
        await postProgress(request.assetId, request.accountId, `⏳ Downloading video for LUT "${lut.name}"…`);
        logger.info({ jobId, assetId: request.assetId }, 'Downloading asset from Frame.io');
        const inputPath = await downloadAsset(
          request.assetId,
          tempDir,
          request.accountId
        );

        // Get file stats for input
        const inputStats = await fs.stat(inputPath);

        // Step 2.5: Analyze input file to determine format
        logger.info({ jobId }, 'Analyzing input video format');
        const { getVideoMetadata } = await import('../ffmpeg/applyLUT.js');
        const metadata = await getVideoMetadata(inputPath);
        
        // Determine output extension based on input container
        let outputExt = path.extname(inputPath); // Default to input extension
        if (metadata.container === 'mov,mp4,m4a,3gp,3g2,mj2') {
          // FFprobe returns this for MOV/MP4 files
          outputExt = path.extname(inputPath).toLowerCase();
        }
        
        // Step 3: Apply LUT using FFmpeg
        await postProgress(request.assetId, request.accountId, `🎨 Applying "${lut.name}"…`);
        logger.info({ jobId, lutId: request.lutId, lutPath: lutPath, container: metadata.container, codec: metadata.codec }, 'Applying LUT to video');
        const outputFilename = `processed_${path.parse(inputPath).name}${outputExt}`;
        const outputPath = path.join(tempDir, outputFilename);
        
        const lutResult = await applyLUT({
          inputUrl: `file://${inputPath}`,
          lutPath: lutPath,
          outputPath: outputPath,
          jobId: jobId,
          onProgress: (percent) => {
            logger.debug({ jobId, percent }, 'LUT processing progress');
          }
        });

        // Get file stats for output
        const outputStats = await fs.stat(outputPath);

        // Step 4: Upload processed video back to Frame.io
        updateJobStatus(jobId, 'uploading');
        await postProgress(request.assetId, request.accountId, '⬆️ Uploading graded video…');
        logger.info({ jobId }, 'Uploading processed video to Frame.io');
        
        const uploadResult = await uploadProcessedVideo(
          outputPath,
          request.assetId,
          lut.name,
          request.accountId
        );

        // Calculate processing duration
        const duration = Date.now() - startTime;

        // Update job status with actual results
        const result: JobResult = {
          outputAssetId: uploadResult.id,
          outputVersionId: uploadResult.versionId,
          duration,
          inputProperties: {
            fileSize: inputStats.size,
          },
          outputProperties: {
            fileSize: outputStats.size,
            codec: 'h264',
            container: 'mp4',
          },
          lutApplied: {
            id: lut.id,
            name: lut.name,
            type: lut.type,
            colorspace: lut.colorspace,
          },
        };

        updateJobStatus(jobId, 'completed', result);
        logger.info({ jobId, result }, 'Job completed successfully (local mode)');

        try {
          const { frameioService } = await import('./frameioService.js');
          await frameioService.postComment(
            uploadResult.id,
            `✨ LUT "${lut.name}" applied. Use Frame.io's "Compare versions" to see the before/after side-by-side.`,
            request.accountId,
          );
        } catch (commentError) {
          logger.warn({ jobId, commentError }, 'Failed to post completion comment (non-fatal)');
        }

      } finally {
        // Cleanup temp files for local mode
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          logger.warn({ jobId, cleanupError }, 'Failed to cleanup temp files');
        }
      }
    }

  } catch (error) {
    logger.error({ jobId, error }, 'Job processing failed');
    updateJobStatus(jobId, 'failed', undefined, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Cleanup old jobs from memory.
 */
export function cleanupOldJobs() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  
  for (const [jobId, job] of jobs.entries()) {
    if (now - job.createdAt.getTime() > ONE_DAY) {
      jobs.delete(jobId);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupOldJobs, 60 * 60 * 1000);
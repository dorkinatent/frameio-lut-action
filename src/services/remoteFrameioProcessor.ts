import { promises as fs } from 'fs';
import path from 'path';
import { frameioService } from './frameioService.js';
import { logger } from '../logger.js';
import { spawn } from 'child_process';
import { config } from '../config.js';

/**
 * Process video with LUT using remote URLs (no local download)
 * This is for deployment environments like Railway where local storage is limited
 */
export async function processVideoRemotely(
  assetId: string,
  lutPath: string,
  accountId: string,
  lutName: string
): Promise<{ id: string; versionId: string }> {
  try {
    logger.info({ assetId, accountId, lutName, lutPath }, 'Starting remote video processing');
    
    // Verify LUT file exists
    try {
      await fs.access(lutPath, fs.constants.R_OK);
      logger.info({ lutPath }, 'LUT file verified accessible');
    } catch (err) {
      logger.error({ lutPath, error: err }, 'LUT file not accessible');
      throw new Error(`LUT file not accessible: ${lutPath}`);
    }

    const asset = await frameioService.getFile(assetId, accountId);
    logger.info({ assetId, name: asset.name }, 'Got asset details');

    const downloadUrl = await frameioService.getDownloadUrl(assetId, accountId);
    logger.info({ assetId }, 'Got download URL for remote processing');

    const uploadParentId = asset.parent_id;
    if (!uploadParentId) {
      throw new Error('Original asset has no parent');
    }

    logger.info({ uploadParentId }, 'Will upload processed file to same folder as original');

    const processedFileName = asset.name;
    const outputExt = path.extname(asset.name) || '.mp4';
    
    // Create a temporary output file path
    const tempDir = config.TMP_DIR;
    await fs.mkdir(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, `processed_${assetId}${outputExt}`);

    // Process video with FFmpeg using remote URL as input
    logger.info({ assetId, lutName }, 'Processing video with FFmpeg (remote URL input)');
    
    await new Promise<void>((resolve, reject) => {
      // For 10-bit HEVC input, we need to handle color space conversion explicitly
      // The LUT3D filter expects RGB input, so we need proper conversion
      const escapedLutPath = lutPath
        .replace(/\\/g, '\\\\')  // Escape backslashes
        .replace(/:/g, '\\:')    // Escape colons
        .replace(/'/g, "\\'")    // Escape single quotes
        .replace(/=/g, '\\=')    // Escape equals signs
        .replace(/,/g, '\\,');   // Escape commas
      
      // Simpler approach - let FFmpeg handle format conversion automatically
      // Just apply the LUT directly
      const filterChain = `lut3d=${escapedLutPath}`;
      
      const ffmpegArgs = [
        '-i', downloadUrl,        // Input from remote URL
        '-vf', filterChain,       // Apply LUT filter
        '-c:v', 'libx264',        // Video codec
        '-preset', 'medium',      // More compatible preset
        '-profile:v', 'high',     // H.264 High Profile
        '-level', '4.1',          // H.264 Level
        '-crf', '23',             // Reasonable quality
        '-pix_fmt', 'yuv420p',    // Force 8-bit output
        '-c:a', 'copy',           // Copy audio stream
        '-movflags', '+faststart', // Optimize for streaming
        '-max_muxing_queue_size', '9999', // Prevent muxing issues
        '-threads', '4',          // Limit threads to avoid issues
        '-y',                     // Overwrite output
        outputPath                // Output file
      ];

      logger.info({ 
        lutPath,
        filterChain,
        outputPath
      }, 'FFmpeg execution details');

      const ffmpeg = spawn(config.FFMPEG_PATH, ffmpegArgs);
      
      let errorOutput = '';
      let progressTimeout: NodeJS.Timeout;
      let lastProgress = Date.now();
      let frameCount = 0;

      // Set a timeout for FFmpeg processing (5 minutes)
      const processTimeout = setTimeout(() => {
        logger.error({ assetId }, 'FFmpeg processing timeout - killing process');
        ffmpeg.kill('SIGTERM');
        reject(new Error('FFmpeg processing timeout after 5 minutes'));
      }, 5 * 60 * 1000);

      // Monitor for progress updates
      const checkProgress = () => {
        const timeSinceLastProgress = Date.now() - lastProgress;
        if (timeSinceLastProgress > 30000) { // 30 seconds without progress
          logger.warn({ assetId, timeSinceLastProgress }, 'No FFmpeg progress detected');
        }
      };
      progressTimeout = setInterval(checkProgress, 10000);

      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        errorOutput += output;
        
        // Check for frame progress
        const frameMatch = output.match(/frame=\s*(\d+)/);
        if (frameMatch) {
          const newFrameCount = parseInt(frameMatch[1], 10);
          if (newFrameCount > frameCount) {
            frameCount = newFrameCount;
            lastProgress = Date.now(); // Reset progress timer on frame update
            logger.info({ frames: frameCount }, 'FFmpeg processing frames');
          }
        } else {
          lastProgress = Date.now(); // Reset progress timer on any output
        }
        
        // Check for specific LUT errors
        if (output.includes('Cannot find color') || output.includes('lut3d') || output.includes('No such file')) {
          logger.error({ lutPath, escapedLutPath }, 'LUT file error detected in FFmpeg output');
        }
        
        // Log verbose output only in debug mode to reduce noise
        if (output.includes('frame=') || output.includes('fps=')) {
          logger.debug({ ffmpeg: output.trim() }, 'FFmpeg progress');
        } else {
          logger.info({ ffmpeg: output.trim() }, 'FFmpeg output');
        }
      });

      ffmpeg.on('close', (code) => {
        clearTimeout(processTimeout);
        clearInterval(progressTimeout);
        
        if (code === 0) {
          logger.info({ assetId }, 'FFmpeg processing completed successfully');
          resolve();
        } else {
          logger.error({ 
            code, 
            errorOutput,
            downloadUrl: downloadUrl.substring(0, 100) + '...',
            lutPath,
            outputPath 
          }, 'FFmpeg processing failed - detailed error');
          reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
        }
      });

      ffmpeg.on('error', (err) => {
        clearTimeout(processTimeout);
        clearInterval(progressTimeout);
        logger.error({ error: err }, 'FFmpeg spawn error');
        reject(err);
      });
    });

    // Get file size for upload
    const fileStats = await fs.stat(outputPath);
    logger.info({ outputPath, size: fileStats.size }, 'Processed video ready for upload');

    logger.info({ parentId: uploadParentId, processedFileName, size: fileStats.size }, 'Creating upload');
    const newFile = await frameioService.createLocalUpload(
      accountId,
      uploadParentId,
      processedFileName,
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
      outputPath,
      newFile.media_type,
      (percent) => logger.debug({ fileId, percent }, 'Upload progress'),
    );

    logger.info({ originalAssetId: assetId, processedFileId: fileId }, 'Creating version stack');
    const versionStack = await frameioService.createVersionStack(accountId, uploadParentId, assetId, fileId);

    try {
      await frameioService.postComment(
        fileId,
        `✨ LUT "${lutName}" has been applied to this video`,
        accountId,
      );
    } catch (commentError) {
      logger.warn({ fileId, error: commentError }, 'Failed to post comment, but upload succeeded');
    }

    try {
      await fs.unlink(outputPath);
    } catch (cleanupError) {
      logger.warn({ outputPath, error: cleanupError }, 'Failed to clean up temp file');
    }

    logger.info({ originalAssetId: assetId, processedFileId: fileId }, 'Successfully processed video remotely');
    return { id: fileId, versionId: versionStack.id };
  } catch (error) {
    logger.error({ assetId, error }, 'Failed to process video remotely');
    throw error;
  }
}
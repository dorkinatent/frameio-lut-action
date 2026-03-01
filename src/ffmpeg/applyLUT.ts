import { spawn } from 'child_process';
import { createWriteStream, existsSync, statSync } from 'fs';
import { unlink, mkdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import axios from 'axios';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { config, TEMP_PROCESSING_DIR, MAX_FILE_SIZE_BYTES } from '../config.js';
import { ffmpegLogger as logger, logFFmpegProgress } from '../logger.js';
import {
  buildFFmpegCommand,
  parseFFmpegProgress,
  detectColorSpace,
  VideoMetadata,
  FFmpegFilterOptions,
} from './filters.js';

export interface ApplyLUTOptions {
  inputUrl: string;
  lutPath: string;
  outputPath?: string;
  jobId: string;
  onProgress?: (percent: number, fps?: number, time?: string) => void;
  inputColorSpace?: string;
  outputColorSpace?: string;
  strength?: number;
  maxDuration?: number; // Maximum processing time in seconds
}

export interface ApplyLUTResult {
  outputPath: string;
  outputSize: number;
  duration: number; // Processing time in milliseconds
  metadata: VideoMetadata;
}

/**
 * Download media file from URL
 */
async function downloadMedia(
  url: string,
  outputPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  logger.info({ url, outputPath }, 'Starting media download');

  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 0,
    maxRedirects: 5,
    onDownloadProgress: (progressEvent) => {
      if (progressEvent.total) {
        const percent = (progressEvent.loaded / progressEvent.total) * 100;
        onProgress?.(percent);
        logger.debug({ percent: percent.toFixed(1) }, 'Download progress');
      }
    },
  });

  // Check content length
  const contentLength = parseInt(response.headers['content-length'] || '0', 10);
  if (contentLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large: ${(contentLength / 1024 / 1024 / 1024).toFixed(2)}GB exceeds maximum of ${config.MAX_INPUT_GB}GB`,
    );
  }

  const writer = createWriteStream(outputPath);
  await pipeline(response.data, writer);
  
  logger.info({ outputPath, size: contentLength }, 'Media download completed');
}

/**
 * Get video metadata using FFprobe
 */
export async function getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ];

    const ffprobe = spawn('ffprobe', args);
    let output = '';
    let error = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      error += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFprobe failed: ${error}`));
        return;
      }

      try {
        const data = JSON.parse(output);
        const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
        const audioStream = data.streams.find((s: any) => s.codec_type === 'audio');

        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        const metadata: VideoMetadata = {
          codec: videoStream.codec_name,
          container: data.format.format_name.split(',')[0],
          width: videoStream.width,
          height: videoStream.height,
          frameRate: eval(videoStream.r_frame_rate), // e.g., "30/1" -> 30
          duration: parseFloat(data.format.duration),
          bitrate: parseInt(data.format.bit_rate, 10),
          pixelFormat: videoStream.pix_fmt,
          hasAudio: !!audioStream,
          audioCodec: audioStream?.codec_name,
          audioBitrate: audioStream ? parseInt(audioStream.bit_rate || '0', 10) : undefined,
          audioSampleRate: audioStream ? parseInt(audioStream.sample_rate || '0', 10) : undefined,
          audioChannels: audioStream?.channels,
        };

        // Detect color space
        metadata.colorSpace = detectColorSpace(metadata);

        resolve(metadata);
      } catch (err) {
        reject(new Error(`Failed to parse FFprobe output: ${err}`));
      }
    });

    ffprobe.on('error', (err) => {
      reject(new Error(`FFprobe spawn error: ${err.message}`));
    });
  });
}

/**
 * Apply LUT to video using FFmpeg
 */
export async function applyLUT(options: ApplyLUTOptions): Promise<ApplyLUTResult> {
  const startTime = Date.now();
  const tempDir = join(TEMP_PROCESSING_DIR, options.jobId);
  
  // Ensure temp directory exists
  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }

  // Generate paths
  const inputFileName = `input_${uuidv4()}${extname(options.inputUrl.split('?')[0]) || '.mp4'}`;
  const inputPath = join(tempDir, inputFileName);
  const outputFileName = `output_${uuidv4()}.mov`; // Default to MOV for ProRes
  const outputPath = options.outputPath || join(tempDir, outputFileName);

  try {
    // Check if input is a local file or needs to be downloaded
    if (options.inputUrl.startsWith('file://')) {
      // Local file - just copy it
      const sourcePath = options.inputUrl.replace('file://', '');
      logger.info({ jobId: options.jobId }, 'Using local file');
      const { copyFile } = await import('fs/promises');
      await copyFile(sourcePath, inputPath);
      options.onProgress?.(30, undefined, 'File ready');
    } else {
      // Download input media from URL
      logger.info({ jobId: options.jobId }, 'Downloading input media');
      await downloadMedia(options.inputUrl, inputPath, (percent) => {
        options.onProgress?.(percent * 0.3, undefined, 'Downloading'); // 30% for download
      });
    }

    // Get video metadata
    logger.info({ jobId: options.jobId }, 'Analyzing video metadata');
    const metadata = await getVideoMetadata(inputPath);
    logger.info({ jobId: options.jobId, metadata }, 'Video metadata analyzed');

    // Build FFmpeg command
    const filterOptions: Partial<FFmpegFilterOptions> = {
      inputColorSpace: options.inputColorSpace as any,
      outputColorSpace: options.outputColorSpace as any,
      strength: options.strength,
      interpolation: 'trilinear', // Default to trilinear for quality
    };

    const ffmpegArgs = buildFFmpegCommand(
      inputPath,
      outputPath,
      options.lutPath,
      metadata,
      filterOptions,
    );

    // Apply LUT using FFmpeg
    logger.info({ jobId: options.jobId, args: ffmpegArgs }, 'Starting FFmpeg processing');
    await runFFmpeg(ffmpegArgs, metadata.duration, (percent, fps, time) => {
      // Scale progress from 30% to 100%
      const scaledPercent = 30 + percent * 0.7;
      options.onProgress?.(scaledPercent, fps, time);
      logFFmpegProgress(options.jobId, scaledPercent, fps, time);
    });

    // Get output file stats
    const outputStats = statSync(outputPath);

    // Clean up input file
    await unlink(inputPath);

    const result: ApplyLUTResult = {
      outputPath,
      outputSize: outputStats.size,
      duration: Date.now() - startTime,
      metadata,
    };

    logger.info(
      { jobId: options.jobId, duration: result.duration, outputSize: result.outputSize },
      'LUT application completed',
    );

    return result;
  } catch (error) {
    // Clean up on error
    try {
      if (existsSync(inputPath)) await unlink(inputPath);
      if (existsSync(outputPath) && !options.outputPath) await unlink(outputPath);
    } catch (cleanupError) {
      logger.error({ cleanupError }, 'Failed to clean up temp files');
    }

    logger.error({ jobId: options.jobId, error }, 'Failed to apply LUT');
    throw error;
  }
}

/**
 * Run FFmpeg command with progress tracking
 */
function runFFmpeg(
  args: string[],
  totalDuration: number,
  onProgress?: (percent: number, fps?: number, time?: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(config.FFMPEG_PATH, args);
    let lastProgress = 0;

    ffmpeg.stderr.on('data', (data) => {
      const line = data.toString();
      
      // Parse progress
      const progress = parseFFmpegProgress(line);
      if (progress.time && totalDuration > 0) {
        // Convert time to seconds
        const timeParts = progress.time.split(':');
        const currentTime =
          parseInt(timeParts[0], 10) * 3600 +
          parseInt(timeParts[1], 10) * 60 +
          parseFloat(timeParts[2]);
        
        const percent = (currentTime / totalDuration) * 100;
        if (percent > lastProgress) {
          lastProgress = percent;
          onProgress?.(Math.min(percent, 100), progress.fps, progress.time);
        }
      }

      // Log FFmpeg output for debugging
      if (line.includes('error') || line.includes('Error')) {
        logger.error({ ffmpeg: line }, 'FFmpeg error output');
      } else {
        logger.debug({ ffmpeg: line }, 'FFmpeg output');
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

/**
 * Clean up temporary files for a job
 */
export async function cleanupJobFiles(jobId: string): Promise<void> {
  const tempDir = join(TEMP_PROCESSING_DIR, jobId);
  if (existsSync(tempDir)) {
    try {
      const files = await import('fs/promises').then((fs) => fs.readdir(tempDir));
      for (const file of files) {
        await unlink(join(tempDir, file));
      }
      await import('fs/promises').then((fs) => fs.rmdir(tempDir));
      logger.info({ jobId, tempDir }, 'Cleaned up job files');
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to clean up job files');
    }
  }
}
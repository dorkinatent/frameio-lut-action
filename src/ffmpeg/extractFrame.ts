import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { config } from '../config.js';
import { ffmpegLogger as logger } from '../logger.js';

export interface ExtractFrameOptions {
  inputPath: string;
  outputPath: string;
  /** Timestamp in seconds to extract the frame at (default: 2) */
  timestamp?: number;
  /** Optional LUT .cube file to apply to the extracted frame */
  lutPath?: string;
  /** Output width in pixels — height scales proportionally (default: 640) */
  width?: number;
}

/**
 * Extract a single JPEG frame from a video, optionally with a LUT applied.
 * Used for preview thumbnails and before/after comparisons.
 */
export async function extractFrame(options: ExtractFrameOptions): Promise<string> {
  const {
    inputPath,
    outputPath,
    timestamp = 2,
    lutPath,
    width = 640,
  } = options;

  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }

  const filters: string[] = [];

  if (lutPath) {
    filters.push(`lut3d=${lutPath}:interp=trilinear`);
  }

  filters.push(`scale=${width}:-2`);

  const args: string[] = [
    '-hide_banner',
    '-y',
    '-ss', String(timestamp),
    '-i', inputPath,
    '-vframes', '1',
    '-vf', filters.join(','),
    '-q:v', '2',
    outputPath,
  ];

  logger.debug({ args, inputPath, outputPath, lutPath }, 'Extracting frame');

  return new Promise((resolve, reject) => {
    const proc = spawn(config.FFMPEG_PATH, args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && existsSync(outputPath)) {
        logger.info({ outputPath }, 'Frame extracted');
        resolve(outputPath);
      } else {
        reject(new Error(`Frame extraction failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

/**
 * Extract a frame and apply every provided LUT, returning an array of output paths.
 * The original (no-LUT) frame is always the first entry.
 */
export async function extractFrameWithLUTs(
  inputPath: string,
  outputDir: string,
  luts: Array<{ id: string; name: string; path: string }>,
  options: { timestamp?: number; width?: number } = {},
): Promise<Array<{ id: string | null; name: string; path: string }>> {
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  const results: Array<{ id: string | null; name: string; path: string }> = [];

  // Original frame (no LUT)
  const originalPath = join(outputDir, 'original.jpg');
  await extractFrame({
    inputPath,
    outputPath: originalPath,
    timestamp: options.timestamp,
    width: options.width,
  });
  results.push({ id: null, name: 'Original', path: originalPath });

  // One frame per LUT — run concurrently in batches of 4
  const BATCH_SIZE = 4;
  for (let i = 0; i < luts.length; i += BATCH_SIZE) {
    const batch = luts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (lut) => {
        const framePath = join(outputDir, `${lut.id}.jpg`);
        await extractFrame({
          inputPath,
          outputPath: framePath,
          lutPath: lut.path,
          timestamp: options.timestamp,
          width: options.width,
        });
        return { id: lut.id, name: lut.name, path: framePath };
      }),
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
      else logger.warn({ error: r.reason?.message }, 'Skipped LUT preview');
    }
  }

  return results;
}

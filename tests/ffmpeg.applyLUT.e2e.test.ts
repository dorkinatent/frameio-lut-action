import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyLUT, cleanupJobFiles } from '../src/ffmpeg/applyLUT';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(require('child_process').exec);

describe('FFmpeg Apply LUT E2E Tests', () => {
  const testDir = join(process.cwd(), 'test-ffmpeg');
  const testVideoPath = join(testDir, 'test-video.mp4');
  const testLUTPath = join(testDir, 'test.cube');
  const testJobId = 'test-job-123';

  beforeAll(async () => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Generate a simple test video using FFmpeg
    await generateTestVideo(testVideoPath);

    // Create a simple test LUT
    const testLUT = `TITLE "Test LUT"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

    writeFileSync(testLUTPath, testLUT);
  });

  afterAll(async () => {
    // Clean up test files
    await cleanupJobFiles(testJobId);
    
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should apply LUT to a test video', async () => {
    // Skip if FFmpeg is not available
    const ffmpegAvailable = await checkFFmpegAvailable();
    if (!ffmpegAvailable) {
      console.log('Skipping FFmpeg test - FFmpeg not available');
      return;
    }

    const outputPath = join(testDir, 'output.mov');

    const result = await applyLUT({
      inputUrl: `file://${testVideoPath}`,
      lutPath: testLUTPath,
      outputPath,
      jobId: testJobId,
      onProgress: (percent, fps, time) => {
        console.log(`Progress: ${percent.toFixed(1)}% - FPS: ${fps} - Time: ${time}`);
      },
    });

    expect(result.outputPath).toBe(outputPath);
    expect(result.outputSize).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.metadata).toBeDefined();
    expect(result.metadata.codec).toBeDefined();
    expect(result.metadata.width).toBeGreaterThan(0);
    expect(result.metadata.height).toBeGreaterThan(0);

    // Verify output file exists
    expect(existsSync(outputPath)).toBe(true);
  }, 60000); // 60 second timeout

  it('should handle progress callbacks', async () => {
    const ffmpegAvailable = await checkFFmpegAvailable();
    if (!ffmpegAvailable) {
      console.log('Skipping FFmpeg test - FFmpeg not available');
      return;
    }

    const outputPath = join(testDir, 'output-progress.mov');
    const progressUpdates: number[] = [];

    await applyLUT({
      inputUrl: `file://${testVideoPath}`,
      lutPath: testLUTPath,
      outputPath,
      jobId: `${testJobId}-progress`,
      onProgress: (percent) => {
        progressUpdates.push(percent);
      },
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBeGreaterThanOrEqual(90);
  }, 60000);

  it('should handle invalid input URL', async () => {
    const ffmpegAvailable = await checkFFmpegAvailable();
    if (!ffmpegAvailable) {
      console.log('Skipping FFmpeg test - FFmpeg not available');
      return;
    }

    await expect(
      applyLUT({
        inputUrl: 'file:///non-existent-file.mp4',
        lutPath: testLUTPath,
        jobId: `${testJobId}-invalid`,
      }),
    ).rejects.toThrow();
  });

  it('should handle invalid LUT path', async () => {
    const ffmpegAvailable = await checkFFmpegAvailable();
    if (!ffmpegAvailable) {
      console.log('Skipping FFmpeg test - FFmpeg not available');
      return;
    }

    await expect(
      applyLUT({
        inputUrl: `file://${testVideoPath}`,
        lutPath: '/non-existent-lut.cube',
        jobId: `${testJobId}-invalid-lut`,
      }),
    ).rejects.toThrow();
  });
});

/**
 * Generate a simple test video using FFmpeg
 */
async function generateTestVideo(outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Generate a 2-second test video with color bars
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'lavfi',
      '-i', 'testsrc=duration=2:size=640x480:rate=30',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-y',
      outputPath,
    ]);

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // If FFmpeg is not available, create a dummy file
        writeFileSync(outputPath, Buffer.from('dummy video content'));
        resolve();
      }
    });

    ffmpeg.on('error', () => {
      // If FFmpeg is not available, create a dummy file
      writeFileSync(outputPath, Buffer.from('dummy video content'));
      resolve();
    });
  });
}

/**
 * Check if FFmpeg is available
 */
async function checkFFmpegAvailable(): Promise<boolean> {
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch {
    return false;
  }
}
import { ColorSpace } from '../types/lut.js';

export interface VideoMetadata {
  codec: string;
  container: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number; // seconds
  bitrate: number;
  pixelFormat: string;
  colorSpace?: ColorSpace;
  hasAudio: boolean;
  audioCodec?: string;
  audioBitrate?: number;
  audioSampleRate?: number;
  audioChannels?: number;
}

export interface FFmpegFilterOptions {
  lutPath: string;
  inputColorSpace?: ColorSpace;
  outputColorSpace?: ColorSpace;
  strength?: number; // 0.0 to 1.0
  interpolation?: 'nearest' | 'trilinear' | 'tetrahedral';
}

/**
 * Build FFmpeg filter graph for LUT application
 */
export function buildLUTFilterGraph(options: FFmpegFilterOptions): string {
  const filters: string[] = [];

  // Color space conversion if needed (input)
  if (options.inputColorSpace && options.inputColorSpace !== 'Rec709') {
    filters.push(getColorSpaceConversionFilter(options.inputColorSpace, 'Rec709'));
  }

  // Apply LUT
  let lutFilter = `lut3d='${options.lutPath}'`;
  
  // Add interpolation method if specified
  if (options.interpolation) {
    lutFilter += `:interp=${options.interpolation}`;
  }

  filters.push(lutFilter);

  // Apply strength if less than 1.0
  if (options.strength !== undefined && options.strength < 1.0) {
    // Mix original with LUT-applied using blend filter
    // This requires splitting the stream and blending
    return buildBlendedLUTFilter(options);
  }

  // Color space conversion if needed (output)
  if (options.outputColorSpace && options.outputColorSpace !== 'Rec709') {
    filters.push(getColorSpaceConversionFilter('Rec709', options.outputColorSpace));
  }

  return filters.join(',');
}

/**
 * Build a blended LUT filter for partial strength application
 */
function buildBlendedLUTFilter(options: FFmpegFilterOptions): string {
  const strength = options.strength || 1.0;
  
  // Split input into two streams
  let filterComplex = '[0:v]split=2[original][lut];';
  
  // Apply LUT to one stream
  filterComplex += `[lut]lut3d='${options.lutPath}'`;
  if (options.interpolation) {
    filterComplex += `:interp=${options.interpolation}`;
  }
  filterComplex += '[lutted];';
  
  // Blend the two streams
  filterComplex += `[original][lutted]blend=all_mode=normal:all_opacity=${strength}`;
  
  return filterComplex;
}

/**
 * Get color space conversion filter
 */
function getColorSpaceConversionFilter(from: ColorSpace, to: ColorSpace): string {
  // Simplified color space conversion - in production, use proper color management
  const conversions: Record<string, Record<string, string>> = {
    SLog3: {
      Rec709: 'colorspace=all=bt709:iall=bt2020:fast=0',
      P3D65: 'colorspace=all=p3-d65:iall=bt2020:fast=0',
    },
    LogC: {
      Rec709: 'colorspace=all=bt709:iall=bt470bg:fast=0',
      P3D65: 'colorspace=all=p3-d65:iall=bt470bg:fast=0',
    },
    P3D65: {
      Rec709: 'colorspace=all=bt709:iall=p3-d65:fast=0',
      SLog3: 'colorspace=all=bt2020:iall=p3-d65:fast=0',
    },
    Rec709: {
      P3D65: 'colorspace=all=p3-d65:iall=bt709:fast=0',
      SLog3: 'colorspace=all=bt2020:iall=bt709:fast=0',
    },
  };

  return conversions[from]?.[to] || 'colorspace=all=bt709:fast=0';
}

/**
 * Build complete FFmpeg command for LUT application
 */
export function buildFFmpegCommand(
  inputPath: string,
  outputPath: string,
  lutPath: string,
  metadata: VideoMetadata,
  options: Partial<FFmpegFilterOptions> = {},
): string[] {
  const args: string[] = [
    '-hide_banner',
    '-y', // Overwrite output
    '-i', inputPath,
  ];

  // Build filter graph
  const filterOptions: FFmpegFilterOptions = {
    lutPath,
    ...options,
  };
  const filterGraph = buildLUTFilterGraph(filterOptions);
  
  if (filterGraph) {
    args.push('-vf', filterGraph);
  }

  // Video codec settings
  args.push(...getVideoCodecArgs(metadata));

  // Audio settings (pass through by default)
  if (metadata.hasAudio) {
    args.push(...getAudioCodecArgs(metadata));
  }

  // Output file
  args.push(outputPath);

  return args;
}

/**
 * Get video codec arguments based on metadata
 */
function getVideoCodecArgs(metadata: VideoMetadata): string[] {
  const codec = metadata.codec.toLowerCase();
  
  // Preserve original codec when possible
  if (codec.includes('h264') || codec.includes('avc')) {
    // Use H.264 for MP4/MOV files with H.264 input
    return [
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18', // High quality
      '-pix_fmt', metadata.pixelFormat || 'yuv420p',
    ];
  } else if (codec.includes('hevc') || codec.includes('h265')) {
    // Use H.265/HEVC for HEVC input
    return [
      '-c:v', 'libx265',
      '-preset', 'slow',
      '-crf', '20',
      '-pix_fmt', metadata.pixelFormat || 'yuv420p',
    ];
  } else if (codec.includes('prores')) {
    // Use ProRes for ProRes input
    return [
      '-c:v', 'prores_ks',
      '-profile:v', '3', // ProRes 422 HQ
      '-vendor', 'apl0',
      '-pix_fmt', 'yuv422p10le',
    ];
  } else {
    // Default to H.264 for compatibility
    return [
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-pix_fmt', metadata.pixelFormat || 'yuv420p',
    ];
  }
}

/**
 * Get audio codec arguments
 */
function getAudioCodecArgs(metadata: VideoMetadata): string[] {
  return ['-c:a', 'copy'];
}

/**
 * Parse FFmpeg progress output
 */
export function parseFFmpegProgress(line: string): {
  percent?: number;
  fps?: number;
  time?: string;
  speed?: number;
} {
  const result: any = {};

  // Parse time
  const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
  if (timeMatch) {
    result.time = timeMatch[1];
  }

  // Parse fps
  const fpsMatch = line.match(/fps=\s*(\d+\.?\d*)/);
  if (fpsMatch) {
    result.fps = parseFloat(fpsMatch[1]);
  }

  // Parse speed
  const speedMatch = line.match(/speed=\s*(\d+\.?\d*)x/);
  if (speedMatch) {
    result.speed = parseFloat(speedMatch[1]);
  }

  return result;
}

/**
 * Detect color space from video metadata
 */
export function detectColorSpace(metadata: VideoMetadata): ColorSpace {
  // This is a simplified detection - in production, use FFprobe color metadata
  const codecLower = metadata.codec.toLowerCase();
  
  if (codecLower.includes('prores') && metadata.pixelFormat.includes('10')) {
    // ProRes often uses P3 or Rec709
    return 'Rec709'; // Default to Rec709, could be P3D65
  }
  
  if (codecLower.includes('h264') || codecLower.includes('h265')) {
    return 'Rec709'; // Most common for H.264/H.265
  }
  
  if (metadata.pixelFormat.includes('log')) {
    return 'LogC'; // or SLog3, depends on camera
  }
  
  return 'Rec709'; // Default fallback
}
import { z } from 'zod';

export type LUTType = '3D' | '1D';

export type ColorSpace = 'Rec709' | 'P3D65' | 'SLog3' | 'HLG' | 'PQ' | 'Linear' | 'LogC' | 'Unknown';

export const LUTDescriptorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['3D', '1D']),
  colorspace: z.enum(['Rec709', 'P3D65', 'SLog3', 'HLG', 'PQ', 'Linear', 'LogC', 'Unknown']),
  size: z.string().optional(), // e.g., '33x33x33' for 3D LUTs
  hash: z.string(), // SHA-256 hash
  storageUri: z.string(),
  fileSize: z.number(),
  previewUrl: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type LUTDescriptor = z.infer<typeof LUTDescriptorSchema>;

export const LUTCreateRequestSchema = z.object({
  name: z.string(),
  type: z.enum(['3D', '1D']).optional(),
  colorspace: z.enum(['Rec709', 'P3D65', 'SLog3', 'HLG', 'PQ', 'Linear', 'LogC', 'Unknown']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type LUTCreateRequest = z.infer<typeof LUTCreateRequestSchema>;

// CUBE file parsing types
export interface CubeLUT {
  title: string;
  type: LUTType;
  size: number; // e.g., 33 for 33x33x33
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: number[][][]; // 3D array of RGB values
  colorspace?: ColorSpace;
}

// LUT application options
export interface LUTApplicationOptions {
  inputColorSpace?: ColorSpace;
  outputColorSpace?: ColorSpace;
  interpolation?: 'nearest' | 'trilinear' | 'tetrahedral';
  strength?: number; // 0.0 to 1.0
}

// Validation result
export interface LUTValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  details?: {
    type: LUTType;
    size: number;
    colorspace?: ColorSpace;
    hasTitle: boolean;
    hasDomain: boolean;
  };
}
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { lutLogger as logger } from '../logger.js';
import { LUT_STORAGE_DIR } from '../config.js';
import {
  LUTDescriptor,
  LUTDescriptorSchema,
  LUTCreateRequest,
  CubeLUT,
  LUTValidationResult,
  ColorSpace,
  LUTType,
} from '../types/lut.js';

export class LUTService {
  private static instance: LUTService;
  private luts: Map<string, LUTDescriptor> = new Map();
  private initialized = false;

  private constructor() {}

  static getInstance(): LUTService {
    if (!LUTService.instance) {
      LUTService.instance = new LUTService();
    }
    return LUTService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure LUT storage directory exists
    if (!existsSync(LUT_STORAGE_DIR)) {
      await mkdir(LUT_STORAGE_DIR, { recursive: true });
      logger.info({ dir: LUT_STORAGE_DIR }, 'Created LUT storage directory');
    }

    // Load existing LUTs from storage
    await this.loadLUTRegistry();
    this.initialized = true;
    logger.info({ count: this.luts.size }, 'LUT service initialized');
  }

  /**
   * List all available LUTs
   */
  async listLUTs(includeDeleted = false): Promise<LUTDescriptor[]> {
    const luts = Array.from(this.luts.values());
    if (includeDeleted) {
      return luts;
    }
    return luts.filter((lut) => !lut.deletedAt);
  }

  /**
   * Get a specific LUT by ID
   */
  async getLUT(lutId: string): Promise<LUTDescriptor | null> {
    const lut = this.luts.get(lutId);
    if (!lut || lut.deletedAt) {
      return null;
    }
    return lut;
  }

  /**
   * Create a new LUT from uploaded file
   */
  async createLUT(
    fileBuffer: Buffer,
    request: LUTCreateRequest,
  ): Promise<LUTDescriptor> {
    // Validate the LUT file
    const validation = await this.validateLUT(fileBuffer);
    if (!validation.valid) {
      throw new Error(`Invalid LUT file: ${validation.errors?.join(', ')}`);
    }

    // Parse the LUT to get details
    const parsedLUT = await this.parseCubeLUT(fileBuffer.toString());

    // Generate unique ID and hash
    const lutId = uuidv4();
    const hash = createHash('sha256').update(fileBuffer).digest('hex');

    // Check for duplicate by hash
    const existingLUT = Array.from(this.luts.values()).find((lut) => lut.hash === hash);
    if (existingLUT) {
      logger.warn({ hash, existingId: existingLUT.id }, 'LUT with same hash already exists');
      return existingLUT;
    }

    // Save LUT file to storage
    const fileName = `${lutId}.cube`;
    const storagePath = join(LUT_STORAGE_DIR, fileName);
    await writeFile(storagePath, fileBuffer);

    // Create LUT descriptor
    const lutDescriptor: LUTDescriptor = {
      id: lutId,
      name: request.name || parsedLUT.title || 'Unnamed LUT',
      type: parsedLUT.type,
      colorspace: request.colorspace || parsedLUT.colorspace || 'Unknown',
      size: `${parsedLUT.size}x${parsedLUT.size}x${parsedLUT.size}`,
      hash,
      storageUri: storagePath,
      fileSize: fileBuffer.length,
      metadata: {
        ...request.metadata,
        domainMin: parsedLUT.domainMin,
        domainMax: parsedLUT.domainMax,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };

    // Validate descriptor
    const validated = LUTDescriptorSchema.parse(lutDescriptor);

    // Store in registry
    this.luts.set(lutId, validated);
    await this.saveLUTRegistry();

    logger.info({ lutId, name: validated.name, hash }, 'Created new LUT');
    return validated;
  }

  /**
   * Delete a LUT (soft delete by default)
   */
  async deleteLUT(lutId: string, hardDelete = false): Promise<void> {
    const lut = this.luts.get(lutId);
    if (!lut) {
      throw new Error(`LUT not found: ${lutId}`);
    }

    if (hardDelete) {
      // Remove file from storage
      if (existsSync(lut.storageUri)) {
        await unlink(lut.storageUri);
      }
      this.luts.delete(lutId);
      logger.info({ lutId }, 'Hard deleted LUT');
    } else {
      // Soft delete
      lut.deletedAt = new Date().toISOString();
      lut.updatedAt = new Date().toISOString();
      logger.info({ lutId }, 'Soft deleted LUT');
    }

    await this.saveLUTRegistry();
  }

  /**
   * Validate a LUT file
   */
  async validateLUT(fileBuffer: Buffer): Promise<LUTValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      const content = fileBuffer.toString();
      const lines = content.split('\n').filter((line) => line.trim() && !line.startsWith('#'));

      // Check for required CUBE format headers
      let hasTitle = false;
      let hasSize = false;
      let hasDomain = false;
      let size = 0;
      let type: LUTType = '3D';

      for (const line of lines) {
        if (line.startsWith('TITLE')) hasTitle = true;
        if (line.startsWith('LUT_3D_SIZE')) {
          hasSize = true;
          type = '3D';
          size = parseInt(line.split(/\s+/)[1], 10);
        }
        if (line.startsWith('LUT_1D_SIZE')) {
          hasSize = true;
          type = '1D';
          size = parseInt(line.split(/\s+/)[1], 10);
        }
        if (line.startsWith('DOMAIN_MIN') || line.startsWith('DOMAIN_MAX')) {
          hasDomain = true;
        }
      }

      if (!hasSize) {
        errors.push('Missing LUT size declaration (LUT_3D_SIZE or LUT_1D_SIZE)');
      }

      if (size < 2 || size > 256) {
        errors.push(`Invalid LUT size: ${size} (must be between 2 and 256)`);
      }

      if (!hasTitle) {
        warnings.push('Missing TITLE field');
      }

      if (!hasDomain) {
        warnings.push('Missing DOMAIN_MIN/DOMAIN_MAX fields (using defaults 0.0 to 1.0)');
      }

      // Count data points
      const dataLines = lines.filter(
        (line) =>
          !line.startsWith('TITLE') &&
          !line.startsWith('LUT_') &&
          !line.startsWith('DOMAIN_'),
      );

      const expectedDataPoints = type === '3D' ? size * size * size : size;
      if (dataLines.length !== expectedDataPoints) {
        errors.push(
          `Data point count mismatch: expected ${expectedDataPoints}, got ${dataLines.length}`,
        );
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        details: {
          type,
          size,
          hasTitle,
          hasDomain,
        },
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to parse LUT file: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Parse a CUBE LUT file
   */
  async parseCubeLUT(content: string): Promise<CubeLUT> {
    const lines = content.split('\n');
    let title = 'Untitled';
    let type: LUTType = '3D';
    let size = 0;
    let domainMin: [number, number, number] = [0, 0, 0];
    let domainMax: [number, number, number] = [1, 1, 1];
    const data: number[][][] = [];

    // Parse headers
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('TITLE')) {
        title = trimmed.substring(5).trim().replace(/^["']|["']$/g, '');
      } else if (trimmed.startsWith('LUT_3D_SIZE')) {
        size = parseInt(trimmed.split(/\s+/)[1], 10);
        type = '3D';
      } else if (trimmed.startsWith('LUT_1D_SIZE')) {
        size = parseInt(trimmed.split(/\s+/)[1], 10);
        type = '1D';
      } else if (trimmed.startsWith('DOMAIN_MIN')) {
        const values = trimmed.split(/\s+/).slice(1).map(parseFloat);
        domainMin = [values[0] || 0, values[1] || 0, values[2] || 0];
      } else if (trimmed.startsWith('DOMAIN_MAX')) {
        const values = trimmed.split(/\s+/).slice(1).map(parseFloat);
        domainMax = [values[0] || 1, values[1] || 1, values[2] || 1];
      }
    }

    // Parse data points (for 3D LUTs)
    if (type === '3D') {
      for (let b = 0; b < size; b++) {
        data[b] = [];
        for (let g = 0; g < size; g++) {
          data[b][g] = [];
          for (let r = 0; r < size; r++) {
            data[b][g][r] = 0; // Will be filled from parsed data
          }
        }
      }

      let dataIndex = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.startsWith('#') ||
          trimmed.startsWith('TITLE') ||
          trimmed.startsWith('LUT_') ||
          trimmed.startsWith('DOMAIN_')
        ) {
          continue;
        }

        const values = trimmed.split(/\s+/).map(parseFloat);
        if (values.length === 3) {
          const b = Math.floor(dataIndex / (size * size));
          const g = Math.floor((dataIndex % (size * size)) / size);
          const r = dataIndex % size;
          if (b < size && g < size && r < size) {
            data[b][g][r] = values[0]; // Red component
            // Note: values[1] and values[2] are green and blue
          }
          dataIndex++;
        }
      }
    }

    // Try to detect colorspace from title or metadata
    let colorspace: ColorSpace = 'Unknown';
    const titleLower = title.toLowerCase();
    if (titleLower.includes('rec709') || titleLower.includes('709')) {
      colorspace = 'Rec709';
    } else if (titleLower.includes('p3')) {
      colorspace = 'P3D65';
    } else if (titleLower.includes('slog')) {
      colorspace = 'SLog3';
    } else if (titleLower.includes('logc')) {
      colorspace = 'LogC';
    }

    return {
      title,
      type,
      size,
      domainMin,
      domainMax,
      data,
      colorspace,
    };
  }

  /**
   * Get LUT file path
   */
  async getLUTFilePath(lutId: string): Promise<string> {
    const lut = await this.getLUT(lutId);
    if (!lut) {
      throw new Error(`LUT not found: ${lutId}`);
    }
    if (!existsSync(lut.storageUri)) {
      throw new Error(`LUT file not found: ${lut.storageUri}`);
    }
    return lut.storageUri;
  }

  /**
   * Load LUT registry from disk
   */
  private async loadLUTRegistry(): Promise<void> {
    const registryPath = join(LUT_STORAGE_DIR, 'registry.json');
    if (existsSync(registryPath)) {
      try {
        const data = await readFile(registryPath, 'utf-8');
        const registry = JSON.parse(data) as LUTDescriptor[];
        for (const lut of registry) {
          const validated = LUTDescriptorSchema.parse(lut);
          this.luts.set(validated.id, validated);
        }
        logger.info({ count: registry.length }, 'Loaded LUT registry');
      } catch (error) {
        logger.error({ error }, 'Failed to load LUT registry');
      }
    }
  }

  /**
   * Save LUT registry to disk
   */
  private async saveLUTRegistry(): Promise<void> {
    const registryPath = join(LUT_STORAGE_DIR, 'registry.json');
    const registry = Array.from(this.luts.values());
    await writeFile(registryPath, JSON.stringify(registry, null, 2));
    logger.debug('Saved LUT registry');
  }
}

export const lutService = LUTService.getInstance();
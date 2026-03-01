import { existsSync, createReadStream, createWriteStream } from 'fs';
import { unlink, mkdir, stat, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import { config, TEMP_PROCESSING_DIR, TEMP_UPLOAD_DIR } from '../config.js';
import { storageLogger as logger } from '../logger.js';

export interface StorageFile {
  path: string;
  size: number;
  createdAt: Date;
  expiresAt?: Date;
}

export class StorageService {
  private static instance: StorageService;
  private cleanupInterval?: NodeJS.Timeout;

  private constructor() {}

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  async initialize(): Promise<void> {
    // Ensure temp directories exist
    await this.ensureDirectory(TEMP_PROCESSING_DIR);
    await this.ensureDirectory(TEMP_UPLOAD_DIR);
    await this.ensureDirectory(config.TMP_DIR);

    // Start cleanup interval (every 15 minutes)
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredFiles().catch((error) => {
        logger.error({ error }, 'Failed to cleanup expired files');
      });
    }, 15 * 60 * 1000);

    logger.info('Storage service initialized');
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Store a file temporarily
   */
  async storeTemp(
    sourcePath: string,
    category: 'upload' | 'processing' | 'output',
    ttlMinutes = 60,
  ): Promise<StorageFile> {
    const baseDir = category === 'upload' ? TEMP_UPLOAD_DIR : TEMP_PROCESSING_DIR;
    const destPath = join(baseDir, `${Date.now()}_${Math.random().toString(36).substring(7)}`);

    await this.ensureDirectory(dirname(destPath));

    if (config.STORAGE_MODE === 'local') {
      await this.copyFile(sourcePath, destPath);
    } else if (config.STORAGE_MODE === 's3') {
      await this.uploadToS3(sourcePath, destPath);
    } else if (config.STORAGE_MODE === 'gcs') {
      await this.uploadToGCS(sourcePath, destPath);
    }

    const stats = await stat(sourcePath);
    const file: StorageFile = {
      path: destPath,
      size: stats.size,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    };

    logger.debug({ file }, 'Stored temporary file');
    return file;
  }

  /**
   * Retrieve a temporary file
   */
  async retrieveTemp(filePath: string): Promise<Buffer> {
    if (config.STORAGE_MODE === 'local') {
      const { readFile } = await import('fs/promises');
      return readFile(filePath);
    } else if (config.STORAGE_MODE === 's3') {
      return this.downloadFromS3(filePath);
    } else if (config.STORAGE_MODE === 'gcs') {
      return this.downloadFromGCS(filePath);
    }
    throw new Error(`Unsupported storage mode: ${config.STORAGE_MODE}`);
  }

  /**
   * Delete a temporary file
   */
  async deleteTemp(filePath: string): Promise<void> {
    try {
      if (config.STORAGE_MODE === 'local') {
        if (existsSync(filePath)) {
          await unlink(filePath);
          logger.debug({ filePath }, 'Deleted temporary file');
        }
      } else if (config.STORAGE_MODE === 's3') {
        await this.deleteFromS3(filePath);
      } else if (config.STORAGE_MODE === 'gcs') {
        await this.deleteFromGCS(filePath);
      }
    } catch (error) {
      logger.error({ filePath, error }, 'Failed to delete temporary file');
    }
  }

  /**
   * Cleanup expired files
   */
  private async cleanupExpiredFiles(): Promise<void> {
    const now = Date.now();
    const directories = [TEMP_PROCESSING_DIR, TEMP_UPLOAD_DIR];

    for (const dir of directories) {
      if (!existsSync(dir)) continue;

      try {
        const files = await readdir(dir);
        for (const file of files) {
          const filePath = join(dir, file);
          const stats = await stat(filePath);
          
          // Delete files older than 2 hours
          const ageMs = now - stats.mtimeMs;
          if (ageMs > 2 * 60 * 60 * 1000) {
            await this.deleteTemp(filePath);
            logger.info({ filePath, ageMs }, 'Cleaned up expired file');
          }
        }
      } catch (error) {
        logger.error({ dir, error }, 'Failed to cleanup directory');
      }
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      logger.debug({ dir }, 'Created directory');
    }
  }

  /**
   * Copy file locally
   */
  private async copyFile(source: string, dest: string): Promise<void> {
    const readStream = createReadStream(source);
    const writeStream = createWriteStream(dest);
    await pipeline(readStream, writeStream);
  }

  /**
   * S3 storage methods (stubs)
   */
  private async uploadToS3(sourcePath: string, destKey: string): Promise<void> {
    // Implementation would use AWS SDK
    logger.warn('S3 upload not implemented - using local storage');
    await this.copyFile(sourcePath, destKey);
  }

  private async downloadFromS3(key: string): Promise<Buffer> {
    // Implementation would use AWS SDK
    logger.warn('S3 download not implemented - using local storage');
    const { readFile } = await import('fs/promises');
    return readFile(key);
  }

  private async deleteFromS3(key: string): Promise<void> {
    // Implementation would use AWS SDK
    logger.warn('S3 delete not implemented - using local storage');
    if (existsSync(key)) {
      await unlink(key);
    }
  }

  /**
   * GCS storage methods (stubs)
   */
  private async uploadToGCS(sourcePath: string, destKey: string): Promise<void> {
    // Implementation would use Google Cloud Storage SDK
    logger.warn('GCS upload not implemented - using local storage');
    await this.copyFile(sourcePath, destKey);
  }

  private async downloadFromGCS(key: string): Promise<Buffer> {
    // Implementation would use Google Cloud Storage SDK
    logger.warn('GCS download not implemented - using local storage');
    const { readFile } = await import('fs/promises');
    return readFile(key);
  }

  private async deleteFromGCS(key: string): Promise<void> {
    // Implementation would use Google Cloud Storage SDK
    logger.warn('GCS delete not implemented - using local storage');
    if (existsSync(key)) {
      await unlink(key);
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    tempFiles: number;
    totalSize: number;
    oldestFile?: Date;
  }> {
    let tempFiles = 0;
    let totalSize = 0;
    let oldestFile: Date | undefined;

    const directories = [TEMP_PROCESSING_DIR, TEMP_UPLOAD_DIR];
    for (const dir of directories) {
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);
      for (const file of files) {
        const filePath = join(dir, file);
        const stats = await stat(filePath);
        tempFiles++;
        totalSize += stats.size;
        
        const fileDate = new Date(stats.mtimeMs);
        if (!oldestFile || fileDate < oldestFile) {
          oldestFile = fileDate;
        }
      }
    }

    return { tempFiles, totalSize, oldestFile };
  }
}

export const storageService = StorageService.getInstance();
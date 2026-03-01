import { FrameioClient, Frameio } from 'frameio';
import { statSync, openSync, readSync, closeSync } from 'fs';
import { frameioAuth } from '../auth/frameioAuth.js';
import { frameioLogger as logger } from '../logger.js';

export class FrameIOService {
  private static instance: FrameIOService;
  private client: FrameioClient;

  private constructor() {
    this.client = new FrameioClient({
      token: () => frameioAuth.getAccessToken(),
    });
  }

  static getInstance(): FrameIOService {
    if (!FrameIOService.instance) {
      FrameIOService.instance = new FrameIOService();
    }
    return FrameIOService.instance;
  }

  /**
   * Get file details (use for files/assets, NOT folders)
   */
  async getFile(fileId: string, accountId: string): Promise<Frameio.FileWithIncludes> {
    const response = await this.client.files.show(accountId, fileId, {
      include: 'media_links.original',
    });
    logger.debug({ fileId, accountId }, 'Retrieved file details');
    return response.data;
  }

  /**
   * Get folder details
   */
  async getFolder(folderId: string, accountId: string): Promise<Frameio.FolderWithIncludes> {
    const response = await this.client.folders.show(accountId, folderId, {});
    logger.debug({ folderId, accountId }, 'Retrieved folder details');
    return response.data;
  }

  /**
   * Get original media download URL for a file
   */
  async getDownloadUrl(fileId: string, accountId: string): Promise<string> {
    const response = await this.client.files.show(accountId, fileId, {
      include: 'media_links.original',
    });
    const downloadUrl = response.data?.media_links?.original?.download_url;
    if (!downloadUrl) {
      throw new Error('No original media link found in response');
    }
    logger.debug({ fileId, accountId }, 'Retrieved original download URL');
    return downloadUrl;
  }

  /**
   * Create a new file for local upload — returns presigned upload URLs
   */
  async createLocalUpload(
    accountId: string,
    folderId: string,
    fileName: string,
    fileSize: number,
  ): Promise<Frameio.FileWithUploadUrls> {
    logger.info({ accountId, folderId, fileName, fileSize }, 'Creating local upload');
    const response = await this.client.files.createLocalUpload(accountId, folderId, {
      data: { name: fileName, file_size: fileSize },
    });
    logger.info({ fileId: response.data.id, chunks: response.data.upload_urls?.length }, 'Created local upload');
    return response.data;
  }

  /**
   * Create a folder inside the given parent folder
   */
  async createFolder(
    accountId: string,
    parentFolderId: string,
    folderName: string,
  ): Promise<Frameio.Folder> {
    logger.info({ accountId, parentFolderId, folderName }, 'Creating folder');
    const response = await this.client.folders.create(accountId, parentFolderId, {
      data: { name: folderName },
    });
    logger.info({ folderId: response.data.id, folderName }, 'Created folder');
    return response.data;
  }

  /**
   * List children in a folder (files, folders, version stacks)
   */
  async listFolderChildren(
    folderId: string,
    accountId: string,
    pageSize = 100,
  ): Promise<Frameio.AssetCommonWithIncludes[]> {
    const response = await this.client.folders.index(accountId, folderId, {
      type: 'file,folder,version_stack',
      page_size: pageSize,
    });
    logger.debug({ folderId, count: response.data?.length }, 'Listed folder children');
    return response.data ?? [];
  }

  /**
   * Upload file content to Frame.io presigned URLs (chunked)
   */
  async uploadChunked(
    uploadUrls: Frameio.UploadUrl[],
    filePath: string,
    mediaType: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const fileStats = statSync(filePath);
    const fileSize = fileStats.size;

    logger.info({ filePath, fileSize, chunks: uploadUrls.length }, 'Starting chunked upload');

    const fd = openSync(filePath, 'r');
    let currentOffset = 0;
    let totalUploaded = 0;

    try {
      for (let i = 0; i < uploadUrls.length; i++) {
        const { url, size: chunkSize } = uploadUrls[i];
        const bytesToRead = Math.min(chunkSize, fileSize - currentOffset);
        if (bytesToRead <= 0) break;

        logger.debug({ chunk: i + 1, totalChunks: uploadUrls.length, bytesToRead }, 'Uploading chunk');

        const buffer = Buffer.alloc(bytesToRead);
        readSync(fd, buffer, 0, bytesToRead, currentOffset);

        const response = await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': mediaType,
            'x-amz-acl': 'private',
          },
          body: buffer,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Chunk ${i + 1} upload failed (${response.status}): ${errorText}`);
        }

        currentOffset += bytesToRead;
        totalUploaded += bytesToRead;
        onProgress?.((totalUploaded / fileSize) * 100);
      }

      logger.info({ filePath, totalUploaded, chunks: uploadUrls.length }, 'Chunked upload complete');
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Create a version stack linking files under a parent folder
   */
  async createVersionStack(
    accountId: string,
    folderId: string,
    originalFileId: string,
    processedFileId: string,
  ): Promise<Frameio.VersionStackWithIncludes> {
    logger.info({ originalFileId, processedFileId, folderId }, 'Creating version stack');
    const response = await this.client.versionStacks.create(accountId, folderId, {
      data: { file_ids: [originalFileId, processedFileId] },
    });
    logger.info({ originalFileId, processedFileId }, 'Created version stack');
    return response.data;
  }

  /**
   * Post a comment on a file
   */
  async postComment(
    fileId: string,
    text: string,
    accountId: string,
  ): Promise<Frameio.Comment> {
    const response = await this.client.comments.create(accountId, fileId, {
      data: { text },
    });
    logger.info({ fileId, commentId: response.data.id }, 'Posted comment');
    return response.data;
  }
}

export const frameioService = FrameIOService.getInstance();

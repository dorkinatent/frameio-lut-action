import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { frameioService } from '../src/services/frameioService';
import { frameioAuth } from '../src/auth/frameioAuth';
import nock from 'nock';

describe('Frame.io Service Integration Tests', () => {
  const baseURL = 'https://api.frame.io/v4';
  const mockAccessToken = 'mock-access-token';

  beforeEach(() => {
    // Mock auth token
    vi.spyOn(frameioAuth, 'getAccessToken').mockResolvedValue(mockAccessToken);

    // Clean up any previous nock interceptors
    nock.cleanAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    nock.cleanAll();
  });

  describe('getAsset', () => {
    it('should retrieve asset details', async () => {
      const assetId = '123e4567-e89b-12d3-a456-426614174000';
      const mockAsset = {
        id: assetId,
        name: 'test-video.mp4',
        type: 'file',
        filetype: 'video/mp4',
        filesize: 1024000,
        parent_id: null,
        project_id: '123e4567-e89b-12d3-a456-426614174001',
        workspace_id: '123e4567-e89b-12d3-a456-426614174002',
        account_id: '123e4567-e89b-12d3-a456-426614174003',
        creator_id: '123e4567-e89b-12d3-a456-426614174004',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      nock(baseURL)
        .get(`/assets/${assetId}`)
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(200, mockAsset);

      const result = await frameioService.getAsset(assetId);

      expect(result).toEqual(mockAsset);
      expect(result.id).toBe(assetId);
      expect(result.name).toBe('test-video.mp4');
    });

    it('should handle 404 error for non-existent asset', async () => {
      const assetId = 'non-existent-id';

      nock(baseURL)
        .get(`/assets/${assetId}`)
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(404, {
          error: 'Not Found',
          message: 'Asset not found',
          status_code: 404,
        });

      await expect(frameioService.getAsset(assetId)).rejects.toThrow();
    });
  });

  describe('getMediaLinksOriginal', () => {
    it('should retrieve original download URL', async () => {
      const assetId = '123e4567-e89b-12d3-a456-426614174000';
      const mockDownloadUrl = 'https://download.frame.io/original/file.mp4?signature=xyz';

      nock(baseURL)
        .get(`/assets/${assetId}/download`)
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(200, mockDownloadUrl);

      const result = await frameioService.getMediaLinksOriginal(assetId);

      expect(result).toBe(mockDownloadUrl);
      expect(result).toContain('https://');
    });

    it('should handle object response with URL field', async () => {
      const assetId = '123e4567-e89b-12d3-a456-426614174000';
      const mockResponse = {
        url: 'https://download.frame.io/original/file.mp4?signature=xyz',
        expires_at: '2024-01-02T00:00:00Z',
      };

      nock(baseURL)
        .get(`/assets/${assetId}/download`)
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(200, mockResponse);

      const result = await frameioService.getMediaLinksOriginal(assetId);

      expect(result).toBe(mockResponse.url);
    });
  });

  describe('createVersion', () => {
    it('should create a new version for an asset', async () => {
      const assetId = '123e4567-e89b-12d3-a456-426614174000';
      const versionData = {
        name: 'processed-video.mov',
        filesize: 2048000,
        filetype: 'video/quicktime',
        description: 'Applied LUT',
      };

      const mockResponse = {
        id: '123e4567-e89b-12d3-a456-426614174005',
        asset_id: assetId,
        upload_url: 'https://upload.frame.io/v1/upload?token=abc',
        created_at: '2024-01-01T00:00:00Z',
      };

      nock(baseURL)
        .post(`/assets/${assetId}/versions`, versionData)
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(201, mockResponse);

      const result = await frameioService.createVersion(assetId, versionData);

      expect(result.id).toBe(mockResponse.id);
      expect(result.asset_id).toBe(assetId);
      expect(result.upload_url).toContain('upload.frame.io');
    });
  });

  describe('postComment', () => {
    it('should post a comment on an asset', async () => {
      const assetId = '123e4567-e89b-12d3-a456-426614174000';
      const commentText = 'LUT applied successfully';
      const timestamp = 10.5;

      const mockComment = {
        id: '123e4567-e89b-12d3-a456-426614174006',
        text: commentText,
        asset_id: assetId,
        creator_id: '123e4567-e89b-12d3-a456-426614174004',
        timestamp,
        resolved: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      nock(baseURL)
        .post('/comments', {
          text: commentText,
          asset_id: assetId,
          timestamp,
        })
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(201, mockComment);

      const result = await frameioService.postComment(assetId, commentText, timestamp);

      expect(result.id).toBe(mockComment.id);
      expect(result.text).toBe(commentText);
      expect(result.asset_id).toBe(assetId);
      expect(result.timestamp).toBe(timestamp);
    });
  });

  describe('completeUpload', () => {
    it('should complete an upload', async () => {
      const assetId = '123e4567-e89b-12d3-a456-426614174000';

      nock(baseURL)
        .post(`/assets/${assetId}/complete-upload`, {})
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(200);

      await expect(frameioService.completeUpload(assetId)).resolves.not.toThrow();
    });

    it('should complete multipart upload with parts', async () => {
      const assetId = '123e4567-e89b-12d3-a456-426614174000';
      const uploadData = {
        parts: [
          { part_number: 1, etag: 'etag1' },
          { part_number: 2, etag: 'etag2' },
        ],
      };

      nock(baseURL)
        .post(`/assets/${assetId}/complete-upload`, uploadData)
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(200);

      await expect(frameioService.completeUpload(assetId, uploadData)).resolves.not.toThrow();
    });
  });

  describe('updateAsset', () => {
    it('should update asset metadata', async () => {
      const assetId = '123e4567-e89b-12d3-a456-426614174000';
      const updates = {
        label: 'approved',
        description: 'Final version with color correction',
      };

      const mockUpdatedAsset = {
        id: assetId,
        name: 'test-video.mp4',
        type: 'file',
        label: 'approved',
        description: 'Final version with color correction',
        filetype: 'video/mp4',
        filesize: 1024000,
        parent_id: null,
        project_id: '123e4567-e89b-12d3-a456-426614174001',
        workspace_id: '123e4567-e89b-12d3-a456-426614174002',
        account_id: '123e4567-e89b-12d3-a456-426614174003',
        creator_id: '123e4567-e89b-12d3-a456-426614174004',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      nock(baseURL)
        .patch(`/assets/${assetId}`, updates)
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(200, mockUpdatedAsset);

      const result = await frameioService.updateAsset(assetId, updates);

      expect(result.id).toBe(assetId);
      expect(result.label).toBe('approved');
      expect(result.description).toBe('Final version with color correction');
    });
  });

  describe('listAssetChildren', () => {
    it('should list children of a folder asset', async () => {
      const folderId = '123e4567-e89b-12d3-a456-426614174000';
      const mockChildren = [
        {
          id: '123e4567-e89b-12d3-a456-426614174007',
          name: 'child1.mp4',
          type: 'file',
          parent_id: folderId,
          project_id: '123e4567-e89b-12d3-a456-426614174001',
          workspace_id: '123e4567-e89b-12d3-a456-426614174002',
          account_id: '123e4567-e89b-12d3-a456-426614174003',
          creator_id: '123e4567-e89b-12d3-a456-426614174004',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: '123e4567-e89b-12d3-a456-426614174008',
          name: 'child2.mp4',
          type: 'file',
          parent_id: folderId,
          project_id: '123e4567-e89b-12d3-a456-426614174001',
          workspace_id: '123e4567-e89b-12d3-a456-426614174002',
          account_id: '123e4567-e89b-12d3-a456-426614174003',
          creator_id: '123e4567-e89b-12d3-a456-426614174004',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      nock(baseURL)
        .get(`/assets/${folderId}/children`)
        .query({ page: 1, per_page: 100 })
        .matchHeader('authorization', `Bearer ${mockAccessToken}`)
        .reply(200, mockChildren);

      const result = await frameioService.listAssetChildren(folderId);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('child1.mp4');
      expect(result[1].name).toBe('child2.mp4');
      expect(result[0].parent_id).toBe(folderId);
    });
  });
});
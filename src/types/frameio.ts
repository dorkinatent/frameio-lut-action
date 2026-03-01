import { z } from 'zod';

// Asset types
export const AssetTypeSchema = z.enum(['file', 'folder', 'project', 'version_stack']);
export type AssetType = z.infer<typeof AssetTypeSchema>;

// Asset schema - Updated to match actual API response
export const AssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: AssetTypeSchema,
  status: z.string().optional(),
  file_size: z.number().optional(),
  filesize: z.number().optional(), // Some endpoints use filesize
  media_type: z.string().optional(),
  project_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  parent_id: z.string().uuid().nullable(),
  view_url: z.string().url().optional(),
  // These fields are not always returned by the API
  filetype: z.string().optional(),
  workspace_id: z.string().uuid().optional(),
  account_id: z.string().uuid().optional(),
  creator_id: z.string().uuid().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  deleted_at: z.string().datetime().nullable().optional(),
  archived_at: z.string().datetime().nullable().optional(),
  properties: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Asset = z.infer<typeof AssetSchema>;

// Media links schema
export const MediaLinksSchema = z.object({
  original: z.string().url(),
  h264_360: z.string().url().optional(),
  h264_540: z.string().url().optional(),
  h264_720: z.string().url().optional(),
  h264_1080: z.string().url().optional(),
  h264_2160: z.string().url().optional(),
  image_high: z.string().url().optional(),
  image_medium: z.string().url().optional(),
  image_small: z.string().url().optional(),
});

export type MediaLinks = z.infer<typeof MediaLinksSchema>;

// Version create request
export const VersionCreateRequestSchema = z.object({
  name: z.string(),
  filesize: z.number(),
  filetype: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  properties: z.record(z.unknown()).optional(),
});

export type VersionCreateRequest = z.infer<typeof VersionCreateRequestSchema>;

// Version create response
export const VersionCreateResponseSchema = z.object({
  id: z.string().uuid(),
  asset_id: z.string().uuid(),
  upload_url: z.string().url(),
  upload_urls: z.array(z.string().url()).optional(),
  chunk_size: z.number().optional(),
  created_at: z.string().datetime(),
});

export type VersionCreateResponse = z.infer<typeof VersionCreateResponseSchema>;

// Comment schema (Frame.io V4)
export const CommentSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  file_id: z.string().uuid(), // V4 uses file_id instead of asset_id
  page: z.number().nullable().optional(),
  timestamp: z.number().nullable().optional(),
  annotation: z.string().nullable().optional(),
  text_edited_at: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Comment = z.infer<typeof CommentSchema>;

// OAuth token response
export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  token_type: z.string().default('Bearer'),
  expires_in: z.number(),
  scope: z.string().optional(),
});

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

// Upload completion request
export const UploadCompletionRequestSchema = z.object({
  parts: z
    .array(
      z.object({
        part_number: z.number(),
        etag: z.string(),
      }),
    )
    .optional(),
});

export type UploadCompletionRequest = z.infer<typeof UploadCompletionRequestSchema>;

// Workspace schema
export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  account_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

// Project schema
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  workspace_id: z.string().uuid(),
  root_asset_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Project = z.infer<typeof ProjectSchema>;

// Review link schema
export const ReviewLinkSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  asset_id: z.string().uuid(),
  url: z.string().url(),
  expires_at: z.string().datetime().nullable().optional(),
  password_protected: z.boolean().default(false),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ReviewLink = z.infer<typeof ReviewLinkSchema>;

// Error response
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  status_code: z.number(),
  request_id: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
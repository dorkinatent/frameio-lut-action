import { z } from 'zod';

export type JobStatus = 'pending' | 'processing' | 'uploading' | 'completed' | 'failed';

export const LUTJobRequestSchema = z.object({
  assetId: z.string().uuid(),
  sourceVersionId: z.string().uuid().nullable().optional(),
  lutId: z.string().uuid(),
  idempotencyKey: z.string(),
  requestedBy: z.string(), // userId
  accountId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  webhookUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type LUTJobRequest = z.infer<typeof LUTJobRequestSchema>;

export const JobProgressSchema = z.object({
  percent: z.number().min(0).max(100),
  stage: z.enum(['downloading', 'processing', 'uploading', 'completing']),
  message: z.string().optional(),
  fps: z.number().optional(),
  timeRemaining: z.number().optional(), // seconds
  bytesProcessed: z.number().optional(),
  totalBytes: z.number().optional(),
});

export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobResultSchema = z.object({
  outputAssetId: z.string().uuid(),
  outputVersionId: z.string().uuid(),
  outputUrl: z.string().url().optional(),
  duration: z.number(), // milliseconds
  inputProperties: z.object({
    fileSize: z.number(),
    duration: z.number().optional(), // video duration in seconds
    codec: z.string().optional(),
    resolution: z.string().optional(),
    frameRate: z.number().optional(),
    bitrate: z.number().optional(),
  }),
  outputProperties: z.object({
    fileSize: z.number(),
    codec: z.string(),
    container: z.string(),
    resolution: z.string().optional(),
    frameRate: z.number().optional(),
    bitrate: z.number().optional(),
  }),
  lutApplied: z.object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.string(),
    colorspace: z.string(),
  }),
});

export type JobResult = z.infer<typeof JobResultSchema>;

export const JobErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  stack: z.string().optional(),
  retryable: z.boolean().default(false),
});

export type JobError = z.infer<typeof JobErrorSchema>;

export const JobDataSchema = z.object({
  id: z.string(),
  request: LUTJobRequestSchema,
  status: z.enum(['queued', 'processing', 'uploading', 'completed', 'failed']),
  progress: JobProgressSchema.optional(),
  result: JobResultSchema.optional(),
  error: JobErrorSchema.optional(),
  attempts: z.number().default(0),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type JobData = z.infer<typeof JobDataSchema>;

// Queue job payload
export interface LUTProcessingJob {
  jobId: string;
  request: LUTJobRequest;
  attempt: number;
}

// Job events for real-time updates
export interface JobEvent {
  jobId: string;
  type: 'progress' | 'status' | 'error' | 'complete';
  timestamp: Date;
  data: JobProgress | JobStatus | JobError | JobResult;
}
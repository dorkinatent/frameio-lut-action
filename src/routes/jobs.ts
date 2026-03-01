import { Router, Request, Response } from 'express';
import { getJobStatus } from '../services/simpleJobProcessor.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * GET /jobs/:id
 * Get job status and details
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const job = getJobStatus(id);

    if (!job) {
      throw createError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    logger.debug({ jobId: id }, 'Retrieved job status');

    res.json({
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      request: {
        assetId: job.request.assetId,
        lutId: job.request.lutId,
        requestedBy: job.request.requestedBy,
      },
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  }),
);

export default router;

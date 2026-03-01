import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { verifySignature } from '../middleware/verifySignature.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { processLUTJob } from '../services/simpleJobProcessor.js';
import { webhookLogger as logger } from '../logger.js';
import { LUTJobRequestSchema } from '../types/jobs.js';
import { config } from '../config.js';

const router = Router();

const ResourceSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['file', 'folder', 'version_stack']),
});

// Accepts both legacy single-asset (`resource`) and multi-asset (`resources`) payloads.
// See https://next.developer.frame.io/platform/docs/guides/custom-actions#multi-asset-configuration
const CustomActionPayloadSchema = z.object({
  account_id: z.string().uuid(),
  action_id: z.string().uuid(),
  interaction_id: z.string().uuid(),
  project: z.object({
    id: z.string().uuid(),
  }),
  resource: ResourceSchema.optional(),
  resources: z.array(ResourceSchema).min(1).max(100).optional(),
  type: z.string(),
  user: z.object({
    id: z.string().uuid(),
  }),
  workspace: z.object({
    id: z.string().uuid(),
  }),
  data: z.record(z.unknown()).optional(),
}).refine(
  (data) => data.resource || data.resources,
  { message: 'Payload must include either `resource` or `resources`' },
);

/**
 * Normalize legacy single-asset and multi-asset payloads into a single array.
 */
function getResources(payload: z.infer<typeof CustomActionPayloadSchema>) {
  if (payload.resources) return payload.resources;
  if (payload.resource) return [payload.resource];
  return [];
}

/**
 * POST /webhooks/frameio/custom-action
 * Handle Frame.io custom action webhook (single and multi-asset)
 */
router.post(
  '/frameio/custom-action',
  verifySignature,
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Received custom action webhook');

    const payload = CustomActionPayloadSchema.parse(req.body);
    const resources = getResources(payload);

    logger.info(
      { resourceCount: resources.length, types: resources.map((r) => r.type) },
      'Resolved resources from payload',
    );

    if (payload.data && payload.data.lutId) {
      // User has selected a LUT — kick off a job for every resource
      const jobIds: string[] = [];
      for (const resource of resources) {
        const jobRequest = LUTJobRequestSchema.parse({
          assetId: resource.id,
          sourceVersionId: null,
          lutId: payload.data.lutId as string,
          idempotencyKey: `${payload.interaction_id}_${resource.id}`,
          requestedBy: payload.user.id,
          accountId: payload.account_id,
          workspaceId: payload.workspace.id,
          metadata: {
            projectId: payload.project.id,
            resourceType: resource.type,
          },
        });

        const jobId = await processLUTJob(jobRequest);
        jobIds.push(jobId);
      }

      logger.info({ jobIds, payload }, 'LUT jobs started successfully');

      const assetWord = resources.length === 1 ? 'asset' : 'assets';
      res.json({
        title: 'LUT Processing Started',
        description: `Applying LUT to ${resources.length} ${assetWord}. Job IDs: ${jobIds.join(', ')}`,
      });
    } else {
      // First interaction — show LUT selection form
      const { lutService } = await import('../services/lutService.js');
      const luts = await lutService.listLUTs();

      const lutOptions = luts.map((lut) => ({
        name: lut.name,
        value: lut.id,
      }));

      const assetCount = resources.length;
      const description =
        assetCount === 1
          ? 'Choose a LUT to apply to your video'
          : `Choose a LUT to apply to ${assetCount} selected videos`;

      // Build a preview URL for the first resource so users can compare looks
      const firstResource = resources[0];
      const publicUrl = process.env.PUBLIC_URL || `http://localhost:${config.PORT}`;
      const previewUrl = `${publicUrl}/preview?accountId=${payload.account_id}&assetId=${firstResource.id}`;

      const formResponse = {
        title: 'Select a LUT',
        description,
        fields: [
          {
            type: 'link',
            label: 'Preview LUTs on your footage',
            name: 'previewLink',
            value: previewUrl,
          },
          {
            type: 'select',
            label: 'LUT',
            name: 'lutId',
            options: lutOptions,
          },
        ],
      };

      logger.info({ formResponse, assetCount }, 'Returning LUT selection form');
      res.json(formResponse);
    }
  }),
);

/**
 * POST /webhooks/test
 * Test webhook endpoint (no signature verification)
 */
router.post(
  '/test',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Received test webhook');

    // Echo back the payload
    res.json({
      received: true,
      timestamp: new Date().toISOString(),
      payload: req.body,
    });
  }),
);

export default router;
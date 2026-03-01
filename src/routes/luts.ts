import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { lutService } from '../services/lutService.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { lutLogger as logger } from '../logger.js';
import { LUTCreateRequestSchema } from '../types/lut.js';
import { TEMP_UPLOAD_DIR } from '../config.js';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  dest: TEMP_UPLOAD_DIR,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max for LUT files
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    // Accept only .cube files
    if (file.originalname.toLowerCase().endsWith('.cube')) {
      cb(null, true);
    } else {
      cb(new Error('Only .cube files are allowed'));
    }
  },
});

/**
 * GET /luts
 * List all available LUTs
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const includeDeleted = req.query.includeDeleted === 'true';
    const luts = await lutService.listLUTs(includeDeleted);

    logger.debug({ count: luts.length, includeDeleted }, 'Listed LUTs');

    res.json({
      luts: luts.map((lut) => ({
        id: lut.id,
        name: lut.name,
        type: lut.type,
        colorspace: lut.colorspace,
        size: lut.size,
        hash: lut.hash,
        previewUrl: lut.previewUrl,
        createdAt: lut.createdAt,
        deletedAt: lut.deletedAt,
      })),
      count: luts.length,
    });
  }),
);

/**
 * GET /luts/:id
 * Get a specific LUT
 */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const lut = await lutService.getLUT(id);

    if (!lut) {
      throw createError('LUT not found', 404, 'LUT_NOT_FOUND');
    }

    logger.debug({ lutId: id }, 'Retrieved LUT');

    res.json({
      id: lut.id,
      name: lut.name,
      type: lut.type,
      colorspace: lut.colorspace,
      size: lut.size,
      hash: lut.hash,
      previewUrl: lut.previewUrl,
      metadata: lut.metadata,
      createdAt: lut.createdAt,
      updatedAt: lut.updatedAt,
    });
  }),
);

/**
 * POST /luts
 * Upload and create a new LUT
 */
router.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw createError('No file uploaded', 400, 'NO_FILE');
    }

    logger.info({ filename: req.file.originalname, size: req.file.size }, 'Uploading LUT');

    // Parse request body
    const requestData = LUTCreateRequestSchema.parse({
      name: req.body.name || req.file.originalname.replace('.cube', ''),
      type: req.body.type,
      colorspace: req.body.colorspace,
      metadata: req.body.metadata ? JSON.parse(req.body.metadata) : undefined,
    });

    // Read file buffer
    const { readFile, unlink } = await import('fs/promises');
    const fileBuffer = await readFile(req.file.path);

    try {
      // Create LUT
      const lut = await lutService.createLUT(fileBuffer, requestData);

      logger.info({ lutId: lut.id, name: lut.name }, 'Created LUT');

      res.status(201).json({
        id: lut.id,
        name: lut.name,
        type: lut.type,
        colorspace: lut.colorspace,
        size: lut.size,
        hash: lut.hash,
        message: 'LUT created successfully',
      });
    } finally {
      // Clean up uploaded file
      await unlink(req.file.path).catch((err) => {
        logger.error({ error: err }, 'Failed to clean up uploaded file');
      });
    }
  }),
);

/**
 * DELETE /luts/:id
 * Delete a LUT
 */
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const hardDelete = req.query.hard === 'true';

    const lut = await lutService.getLUT(id);
    if (!lut) {
      throw createError('LUT not found', 404, 'LUT_NOT_FOUND');
    }

    await lutService.deleteLUT(id, hardDelete);

    logger.info({ lutId: id, hardDelete }, 'Deleted LUT');

    res.json({
      message: hardDelete ? 'LUT permanently deleted' : 'LUT soft deleted',
      id,
    });
  }),
);

export default router;
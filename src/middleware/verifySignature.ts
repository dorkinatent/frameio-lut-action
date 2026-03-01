import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { webhookLogger as logger } from '../logger.js';

export interface SignedRequest extends Request {
  rawBody?: Buffer;
  signature?: string;
  timestamp?: number;
}

/**
 * Middleware to verify HMAC signature on webhook requests
 */
export function verifySignature(req: SignedRequest, res: Response, next: NextFunction): void {
  try {
    // Check for Frame.io specific headers first
    const frameioSignature = req.headers['x-frameio-signature'] as string;
    const frameioTimestamp = req.headers['x-frameio-request-timestamp'] as string;
    
    // Fall back to generic webhook headers
    const signatureHeader = frameioSignature || (req.headers['x-archon-signature'] as string);
    const timestampHeader = frameioTimestamp || (req.headers['x-archon-timestamp'] as string);

    if (!signatureHeader || !timestampHeader) {
      logger.warn({ headers: req.headers }, 'Missing signature or timestamp header');
      res.status(401).json({ error: 'Missing signature or timestamp header' });
      return;
    }

    // Parse timestamp
    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp)) {
      logger.warn({ timestamp: timestampHeader }, 'Invalid timestamp header');
      res.status(401).json({ error: 'Invalid timestamp header' });
      return;
    }

    // Check timestamp is within 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const MAX_AGE_SECONDS = 300; // 5 minutes
    if (Math.abs(now - timestamp) > MAX_AGE_SECONDS) {
      logger.warn({ timestamp, now, diff: Math.abs(now - timestamp) }, 'Request timestamp too old');
      res.status(401).json({ error: 'Request timestamp too old' });
      return;
    }

    // Get raw body
    const rawBody = req.rawBody || req.body;
    if (!rawBody) {
      logger.error('No raw body available for signature verification');
      res.status(500).json({ error: 'Unable to verify signature' });
      return;
    }

    // Parse provided signature (format: "sha256=signature" or "v0=signature" for Frame.io)
    const [algorithm, providedSignature] = signatureHeader.split('=');
    const isFrameio = algorithm === 'v0';
    
    // Create signature payload based on format
    let bodyString: string;
    if (Buffer.isBuffer(rawBody)) {
      bodyString = rawBody.toString('utf8');
    } else if (typeof rawBody === 'string') {
      bodyString = rawBody;
    } else {
      bodyString = JSON.stringify(rawBody);
    }
    
    const signaturePayload = isFrameio 
      ? `v0:${timestamp}:${bodyString}`  // Frame.io format: v0:timestamp:body
      : `${timestamp}.${bodyString}`;      // Standard format: timestamp.body

    // Debug logging for Frame.io webhooks
    if (isFrameio) {
      logger.debug({
        timestamp,
        bodyLength: bodyString.length,
        bodyPreview: bodyString.substring(0, 100),
        secret: config.FRAMEIO_WEBHOOK_SECRET.substring(0, 10) + '...',
        payloadPreview: signaturePayload.substring(0, 50)
      }, 'Frame.io signature calculation');
    }

    // Calculate expected signature
    const expectedSignature = createHmac('sha256', config.FRAMEIO_WEBHOOK_SECRET)
      .update(signaturePayload)
      .digest('hex');
    
    if (!isFrameio && algorithm !== 'sha256') {
      logger.warn({ algorithm }, 'Invalid signature algorithm');
      res.status(401).json({ error: 'Invalid signature algorithm' });
      return;
    }

    // Timing-safe comparison
    const expected = Buffer.from(expectedSignature);
    const provided = Buffer.from(providedSignature || '');

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      logger.warn(
        { 
          expected: expectedSignature.substring(0, 10) + '...', 
          provided: (providedSignature || '').substring(0, 10) + '...' 
        },
        'Invalid signature'
      );
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Add verified data to request
    req.signature = providedSignature;
    req.timestamp = timestamp;

    logger.debug({ timestamp }, 'Signature verified successfully');
    next();
  } catch (error) {
    logger.error({ error }, 'Error verifying signature');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Helper function to generate signature for testing
 */
export function generateSignature(payload: any, timestamp?: number): {
  signature: string;
  timestamp: number;
  headers: Record<string, string>;
} {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const signaturePayload = `${ts}.${typeof payload === 'string' ? payload : JSON.stringify(payload)}`;
  
  const signature = createHmac('sha256', config.FRAMEIO_WEBHOOK_SECRET)
    .update(signaturePayload)
    .digest('hex');

  return {
    signature,
    timestamp: ts,
    headers: {
      'x-archon-signature': `sha256=${signature}`,
      'x-archon-timestamp': ts.toString(),
    },
  };
}

/**
 * Express middleware to capture raw body for signature verification
 */
export function captureRawBody(req: SignedRequest, res: Response, buf: Buffer): void {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}
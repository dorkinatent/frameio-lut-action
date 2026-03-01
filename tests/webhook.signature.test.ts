import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response } from 'express';
import { verifySignature, generateSignature } from '../src/middleware/verifySignature';

describe('Webhook Signature Verification', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: vi.Mock;

  beforeEach(() => {
    vi.stubEnv('FRAMEIO_WEBHOOK_SECRET', 'test-webhook-secret-32-characters-long');

    mockReq = {
      headers: {},
      body: {},
      rawBody: undefined,
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe('verifySignature middleware', () => {
    it('should pass valid signature', () => {
      const payload = { test: 'data' };
      const { headers } = generateSignature(payload);

      mockReq.headers = headers;
      mockReq.body = payload;
      mockReq.rawBody = Buffer.from(JSON.stringify(payload));

      verifySignature(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should reject missing signature header', () => {
      mockReq.headers = {
        'x-archon-timestamp': '1234567890',
      };
      mockReq.body = { test: 'data' };

      verifySignature(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing signature or timestamp header',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject missing timestamp header', () => {
      mockReq.headers = {
        'x-archon-signature': 'sha256=invalid',
      };
      mockReq.body = { test: 'data' };

      verifySignature(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing signature or timestamp header',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid timestamp', () => {
      mockReq.headers = {
        'x-archon-signature': 'sha256=invalid',
        'x-archon-timestamp': 'not-a-number',
      };
      mockReq.body = { test: 'data' };

      verifySignature(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid timestamp header',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject old timestamp', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago

      mockReq.headers = {
        'x-archon-signature': 'sha256=invalid',
        'x-archon-timestamp': oldTimestamp.toString(),
      };
      mockReq.body = { test: 'data' };
      mockReq.rawBody = Buffer.from(JSON.stringify(mockReq.body));

      verifySignature(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Request timestamp too old',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid signature algorithm', () => {
      const timestamp = Math.floor(Date.now() / 1000);

      mockReq.headers = {
        'x-archon-signature': 'sha512=invalid',
        'x-archon-timestamp': timestamp.toString(),
      };
      mockReq.body = { test: 'data' };
      mockReq.rawBody = Buffer.from(JSON.stringify(mockReq.body));

      verifySignature(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid signature algorithm',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000);

      mockReq.headers = {
        'x-archon-signature': 'sha256=invalidsignature',
        'x-archon-timestamp': timestamp.toString(),
      };
      mockReq.body = { test: 'data' };
      mockReq.rawBody = Buffer.from(JSON.stringify(mockReq.body));

      verifySignature(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid signature',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle missing raw body', () => {
      const timestamp = Math.floor(Date.now() / 1000);

      mockReq.headers = {
        'x-archon-signature': 'sha256=signature',
        'x-archon-timestamp': timestamp.toString(),
      };
      mockReq.body = undefined;
      mockReq.rawBody = undefined;

      verifySignature(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unable to verify signature',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('generateSignature helper', () => {
    it('should generate valid signature', () => {
      const payload = { test: 'data', nested: { value: 123 } };
      const result = generateSignature(payload);

      expect(result.signature).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.headers['x-archon-signature']).toMatch(/^sha256=.+/);
      expect(result.headers['x-archon-timestamp']).toBeDefined();
    });

    it('should generate different signatures for different payloads', () => {
      const payload1 = { test: 'data1' };
      const payload2 = { test: 'data2' };

      const result1 = generateSignature(payload1);
      const result2 = generateSignature(payload2);

      expect(result1.signature).not.toBe(result2.signature);
    });

    it('should use provided timestamp', () => {
      const payload = { test: 'data' };
      const timestamp = 1234567890;

      const result = generateSignature(payload, timestamp);

      expect(result.timestamp).toBe(timestamp);
      expect(result.headers['x-archon-timestamp']).toBe('1234567890');
    });

    it('should handle string payloads', () => {
      const payload = 'string payload';
      const result = generateSignature(payload);

      expect(result.signature).toBeDefined();
      expect(result.headers['x-archon-signature']).toMatch(/^sha256=.+/);
    });
  });
});
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lutService } from '../src/services/lutService';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('LUT Service', () => {
  const testLUTDir = join(process.cwd(), 'test-luts');

  beforeEach(async () => {
    // Create test directory
    if (!existsSync(testLUTDir)) {
      mkdirSync(testLUTDir, { recursive: true });
    }
    
    // Set test LUT directory
    vi.stubEnv('TMP_DIR', testLUTDir);
    
    // Initialize service
    await lutService.initialize();
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testLUTDir)) {
      rmSync(testLUTDir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  describe('validateLUT', () => {
    it('should validate a correct CUBE file', async () => {
      const validCube = `TITLE "Test LUT"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

      const result = await lutService.validateLUT(Buffer.from(validCube));

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
      expect(result.details?.type).toBe('3D');
      expect(result.details?.size).toBe(2);
    });

    it('should reject CUBE file without size declaration', async () => {
      const invalidCube = `TITLE "Test LUT"
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

0.0 0.0 0.0
1.0 0.0 0.0`;

      const result = await lutService.validateLUT(Buffer.from(invalidCube));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing LUT size declaration (LUT_3D_SIZE or LUT_1D_SIZE)');
    });

    it('should reject CUBE file with invalid size', async () => {
      const invalidCube = `TITLE "Test LUT"
LUT_3D_SIZE 300

0.0 0.0 0.0`;

      const result = await lutService.validateLUT(Buffer.from(invalidCube));

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid LUT size: 300 (must be between 2 and 256)');
    });

    it('should warn about missing TITLE field', async () => {
      const cubeWithoutTitle = `LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

      const result = await lutService.validateLUT(Buffer.from(cubeWithoutTitle));

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Missing TITLE field');
    });
  });

  describe('parseCubeLUT', () => {
    it('should parse a valid CUBE LUT', async () => {
      const cubeContent = `TITLE "Test LUT"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

      const parsed = await lutService.parseCubeLUT(cubeContent);

      expect(parsed.title).toBe('Test LUT');
      expect(parsed.type).toBe('3D');
      expect(parsed.size).toBe(2);
      expect(parsed.domainMin).toEqual([0, 0, 0]);
      expect(parsed.domainMax).toEqual([1, 1, 1]);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.data[0]).toHaveLength(2);
      expect(parsed.data[0][0]).toHaveLength(2);
    });

    it('should detect colorspace from title', async () => {
      const cubeContent = `TITLE "Rec709 to P3"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

      const parsed = await lutService.parseCubeLUT(cubeContent);

      expect(parsed.colorspace).toBe('Rec709');
    });
  });

  describe('createLUT', () => {
    it('should create a new LUT from valid CUBE file', async () => {
      const cubeContent = `TITLE "Test Create LUT"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

      const lut = await lutService.createLUT(Buffer.from(cubeContent), {
        name: 'Test LUT',
        colorspace: 'Rec709',
      });

      expect(lut.id).toBeDefined();
      expect(lut.name).toBe('Test LUT');
      expect(lut.type).toBe('3D');
      expect(lut.colorspace).toBe('Rec709');
      expect(lut.size).toBe('2x2x2');
      expect(lut.hash).toBeDefined();
      expect(lut.storageUri).toContain('.cube');
    });

    it('should reject duplicate LUTs with same hash', async () => {
      const cubeContent = `TITLE "Duplicate Test"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

      const lut1 = await lutService.createLUT(Buffer.from(cubeContent), {
        name: 'First LUT',
      });

      const lut2 = await lutService.createLUT(Buffer.from(cubeContent), {
        name: 'Second LUT',
      });

      expect(lut2.id).toBe(lut1.id);
      expect(lut2.hash).toBe(lut1.hash);
    });
  });

  describe('listLUTs', () => {
    it('should list all created LUTs', async () => {
      const cubeContent1 = `TITLE "LUT 1"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

      const cubeContent2 = `TITLE "LUT 2"
LUT_3D_SIZE 2
0.1 0.1 0.1
1.0 0.1 0.1
0.1 1.0 0.1
1.0 1.0 0.1
0.1 0.1 1.0
1.0 0.1 1.0
0.1 1.0 1.0
1.0 1.0 1.0`;

      await lutService.createLUT(Buffer.from(cubeContent1), { name: 'LUT 1' });
      await lutService.createLUT(Buffer.from(cubeContent2), { name: 'LUT 2' });

      const luts = await lutService.listLUTs();

      expect(luts).toHaveLength(2);
      expect(luts.map(l => l.name)).toContain('LUT 1');
      expect(luts.map(l => l.name)).toContain('LUT 2');
    });

    it('should filter out deleted LUTs by default', async () => {
      const cubeContent = `TITLE "To Delete"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0`;

      const lut = await lutService.createLUT(Buffer.from(cubeContent), {
        name: 'To Delete',
      });

      await lutService.deleteLUT(lut.id, false); // Soft delete

      const visibleLUTs = await lutService.listLUTs(false);
      const allLUTs = await lutService.listLUTs(true);

      expect(visibleLUTs).toHaveLength(0);
      expect(allLUTs).toHaveLength(1);
      expect(allLUTs[0].deletedAt).toBeDefined();
    });
  });
});
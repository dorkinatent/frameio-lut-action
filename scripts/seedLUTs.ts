#!/usr/bin/env tsx

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config, LUT_STORAGE_DIR } from '../src/config.js';
import { lutService } from '../src/services/lutService.js';
import { logger } from '../src/logger.js';

/**
 * Generate a simple test CUBE LUT file
 */
function generateTestCubeLUT(
  name: string,
  size: number = 33,
  type: 'warm' | 'cool' | 'contrast' | 'neutral' = 'neutral',
): string {
  let content = `# ${name}\n`;
  content += `TITLE "${name}"\n`;
  content += `LUT_3D_SIZE ${size}\n`;
  content += `DOMAIN_MIN 0.0 0.0 0.0\n`;
  content += `DOMAIN_MAX 1.0 1.0 1.0\n\n`;

  // Generate LUT data based on type
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const red = r / (size - 1);
        const green = g / (size - 1);
        const blue = b / (size - 1);

        let outR = red;
        let outG = green;
        let outB = blue;

        // Apply transformations based on type
        switch (type) {
          case 'warm':
            outR = Math.min(1.0, red * 1.1);
            outG = green * 0.95;
            outB = blue * 0.85;
            break;
          case 'cool':
            outR = red * 0.85;
            outG = green * 0.95;
            outB = Math.min(1.0, blue * 1.1);
            break;
          case 'contrast':
            // S-curve for contrast
            outR = applySCurve(red);
            outG = applySCurve(green);
            outB = applySCurve(blue);
            break;
          case 'neutral':
          default:
            // Pass through
            break;
        }

        content += `${outR.toFixed(6)} ${outG.toFixed(6)} ${outB.toFixed(6)}\n`;
      }
    }
  }

  return content;
}

/**
 * Apply S-curve for contrast enhancement
 */
function applySCurve(value: number): number {
  // Simple S-curve using smoothstep
  const t = value;
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Seed test LUTs
 */
async function seedLUTs(): Promise<void> {
  try {
    logger.info('Starting LUT seeding process...');

    // Initialize service
    await lutService.initialize();

    // Test LUTs to create
    const testLUTs = [
      { name: 'Neutral Pass-Through', type: 'neutral' as const, colorspace: 'Rec709' },
      { name: 'Warm Sunset', type: 'warm' as const, colorspace: 'Rec709' },
      { name: 'Cool Blue', type: 'cool' as const, colorspace: 'Rec709' },
      { name: 'High Contrast', type: 'contrast' as const, colorspace: 'Rec709' },
    ];

    // Create temp directory for LUT files
    const tempDir = join(process.cwd(), 'temp-luts');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    for (const lutConfig of testLUTs) {
      logger.info(`Creating LUT: ${lutConfig.name}`);

      // Generate CUBE content
      const cubeContent = generateTestCubeLUT(lutConfig.name, 33, lutConfig.type);

      // Write to temp file
      const tempPath = join(tempDir, `${lutConfig.name.replace(/\s+/g, '_')}.cube`);
      writeFileSync(tempPath, cubeContent);

      // Read file and create LUT
      const { readFileSync, unlinkSync } = await import('fs');
      const fileBuffer = readFileSync(tempPath);

      try {
        const lut = await lutService.createLUT(fileBuffer, {
          name: lutConfig.name,
          type: '3D',
          colorspace: lutConfig.colorspace as any,
          metadata: {
            generated: true,
            seedScript: true,
            type: lutConfig.type,
          },
        });

        logger.info(`✅ Created LUT: ${lut.name} (ID: ${lut.id})`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('same hash already exists')) {
          logger.info(`⏭️  LUT already exists: ${lutConfig.name}`);
        } else {
          throw error;
        }
      }

      // Clean up temp file
      unlinkSync(tempPath);
    }

    // List all LUTs
    const allLUTs = await lutService.listLUTs();
    logger.info(`\nTotal LUTs in system: ${allLUTs.length}`);
    
    console.log('\n📋 Available LUTs:');
    console.log('==================');
    for (const lut of allLUTs) {
      console.log(`- ${lut.name}`);
      console.log(`  ID: ${lut.id}`);
      console.log(`  Type: ${lut.type}`);
      console.log(`  Colorspace: ${lut.colorspace}`);
      console.log(`  Size: ${lut.size}`);
      console.log('');
    }

    logger.info('✅ LUT seeding completed successfully');
  } catch (error) {
    logger.error({ error }, '❌ Failed to seed LUTs');
    process.exit(1);
  }
}

// Run the seeding script
seedLUTs().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
#!/usr/bin/env tsx

import { readdir, readFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { lutService } from '../src/services/lutService.js';
import { logger } from '../src/logger.js';

/**
 * Import LUTs from a directory
 */
async function importLUTs(directory: string): Promise<void> {
  try {
    logger.info(`Importing LUTs from directory: ${directory}`);

    // Initialize service
    await lutService.initialize();

    // Read directory
    const files = await readdir(directory);
    const cubeFiles = files.filter((file) => extname(file).toLowerCase() === '.cube');

    logger.info(`Found ${cubeFiles.length} .cube files`);

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of cubeFiles) {
      const filePath = join(directory, file);
      const lutName = basename(file, '.cube');

      try {
        logger.info(`Processing: ${lutName}`);

        // Read file
        const fileBuffer = await readFile(filePath);

        // Try to create LUT
        const lut = await lutService.createLUT(fileBuffer, {
          name: lutName,
          metadata: {
            originalPath: filePath,
            importedAt: new Date().toISOString(),
          },
        });

        logger.info(`✅ Imported: ${lut.name} (ID: ${lut.id})`);
        imported++;
      } catch (error) {
        if (error instanceof Error && error.message.includes('same hash already exists')) {
          logger.info(`⏭️  Skipped (already exists): ${lutName}`);
          skipped++;
        } else {
          logger.error(`❌ Failed to import ${lutName}: ${error}`);
          failed++;
        }
      }
    }

    // Summary
    console.log('\n📊 Import Summary:');
    console.log('==================');
    console.log(`✅ Imported: ${imported}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📁 Total: ${cubeFiles.length}`);

    // List all LUTs
    const allLUTs = await lutService.listLUTs();
    console.log(`\n📋 Total LUTs in system: ${allLUTs.length}`);
  } catch (error) {
    logger.error({ error }, '❌ Import failed');
    process.exit(1);
  }
}

// Get directory from command line arguments
const directory = process.argv[2];

if (!directory) {
  console.error('Usage: npm run import:luts <directory>');
  console.error('Example: npm run import:luts /path/to/your/luts');
  process.exit(1);
}

// Run the import
importLUTs(directory).then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
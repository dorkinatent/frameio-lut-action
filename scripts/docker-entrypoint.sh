#!/bin/bash

# Docker entrypoint script for LUT Action service
# This script imports LUTs on container startup before starting the server

echo "Starting LUT Action service initialization..."

# Check if LUTs directory exists in the container
if [ -d "/app/luts" ] && [ "$(ls -A /app/luts/*.cube 2>/dev/null)" ]; then
    echo "Found LUT files in /app/luts, importing them..."
    
    # Count the LUT files
    LUT_COUNT=$(ls -1 /app/luts/*.cube 2>/dev/null | wc -l)
    echo "Found $LUT_COUNT LUT files to import"
    
    # Run the import script to process the LUTs
    # The import:luts script expects the directory path as an argument
    cd /app && npx tsx scripts/importLUTs.ts /app/luts
    
    if [ $? -eq 0 ]; then
        echo "Successfully imported LUTs"
    else
        echo "Warning: Failed to import some LUTs, continuing anyway..."
    fi
else
    echo "No LUTs found in /app/luts directory"
fi

echo "Starting the application server..."

# Start the Node.js application
exec npm start
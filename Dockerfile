# Single container Dockerfile
FROM node:20-alpine

# Install dependencies including FFmpeg
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg \
    curl \
    tini \
    bash \
    && rm -rf /var/cache/apk/*

# Verify FFmpeg installation
RUN ffmpeg -version && \
    ffmpeg -filters 2>/dev/null | grep -q lut3d && \
    echo "FFmpeg with lut3d filter installed successfully"

# Create app directory and set permissions
RUN mkdir -p /app /tmp/archon-lut \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 \
    && chown -R nodejs:nodejs /app /tmp/archon-lut

WORKDIR /app

# Copy package files
COPY --chown=nodejs:nodejs package*.json ./

# Install dependencies
RUN npm ci --include=dev \
    && npm cache clean --force

# Copy source code (includes luts/ directory)
COPY --chown=nodejs:nodejs . .

# Build TypeScript (postbuild imports LUTs but needs placeholder env vars)
RUN export FRAMEIO_WEBHOOK_SECRET="build-time-placeholder-min-32-chars" && \
    export FRAMEIO_CLIENT_ID="placeholder" && \
    export FRAMEIO_CLIENT_SECRET="placeholder" && \
    npm run build

# Import LUTs during build (while we still have tsx)
RUN export FRAMEIO_WEBHOOK_SECRET="build-time-placeholder-min-32-chars" && \
    export FRAMEIO_CLIENT_ID="placeholder" && \
    export FRAMEIO_CLIENT_SECRET="placeholder" && \
    echo "Importing LUTs during Docker build..." && \
    npx tsx scripts/importLUTs.ts /app/luts && \
    echo "LUTs imported successfully" && \
    ls -la /tmp/archon-lut/luts/ && \
    echo "Registry contains $(grep -c '"id"' /tmp/archon-lut/luts/registry.json) LUTs"

# Remove dev dependencies after build and LUT import
RUN npm prune --production

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Use tini as entrypoint to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application directly (LUTs already imported during build)
CMD ["npm", "start"]
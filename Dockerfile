# Base image for dependencies and build
FROM node:22-alpine AS base
WORKDIR /app

# Install all dependencies (including dev for worker)
FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Accept the Railway service variable while Next.js collects page configuration.
ARG DATABASE_PROVIDER
# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
# Keep the optional static-assets directory available for the runner COPY.
RUN mkdir -p public && npm run build

# Production image, copy all necessary files
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files for both web and worker
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# Create non-root user
USER nextjs

# Expose port for web service
EXPOSE 3000
ENV PORT=3000

# Default command can be overridden at runtime (for web: node server.js, for worker: node --import tsx worker/index.ts)
CMD ["node", "server.js"]

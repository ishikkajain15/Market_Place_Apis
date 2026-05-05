# syntax=docker/dockerfile:1.7

# ---------- Stage 1: Install production dependencies ----------
FROM node:22-alpine AS deps

WORKDIR /app

# Install only what's needed to resolve native modules (if any)
RUN apk add --no-cache libc6-compat

# Copy lockfile + manifest first for better layer caching
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Stage 2: Runtime image ----------
FROM node:22-alpine AS runner

WORKDIR /app

# Run as the built-in non-root user that ships with the node image
ENV NODE_ENV=production \
    PORT=3000

# Copy production node_modules from the deps stage
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy the rest of the application source
COPY --chown=node:node . .

# Drop root
USER node

EXPOSE 3000

# Basic healthcheck — adjust the path if you have a /health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
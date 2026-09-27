# syntax=docker/dockerfile:1

# Typecheck and build the app. npm manages the dependencies (package-lock.json), so it installs them.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Only the backend's runtime dependencies, without Vite, TypeScript and the rest of the dev tooling.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM oven/bun:1-slim
WORKDIR /app
# HTTPS-only by default: the container is meant to sit behind a TLS reverse proxy.
ENV NODE_ENV=production
COPY package.json ./
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY backend backend
USER bun
EXPOSE 3852
# /api/status answers over plain HTTP even in production, so it works from inside the container.
HEALTHCHECK CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3852}/api/status`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "backend/index.ts"]

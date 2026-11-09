FROM node:24-alpine AS deps
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /web
COPY --from=deps /web/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# API_URL is read at build time for the rewrites; Compose passes the in-network address.
ARG API_URL=http://api:8000
ENV API_URL=$API_URL
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S nexus && adduser -S nexus -G nexus
COPY --from=build --chown=nexus:nexus /web/.next/standalone ./
COPY --from=build --chown=nexus:nexus /web/.next/static ./.next/static
COPY --from=build --chown=nexus:nexus /web/public ./public
USER nexus
EXPOSE 3000
CMD ["node", "server.js"]

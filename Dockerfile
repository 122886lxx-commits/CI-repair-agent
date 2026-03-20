FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM base AS builder
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/db ./db
EXPOSE 3000
CMD ["node", "server.js"]

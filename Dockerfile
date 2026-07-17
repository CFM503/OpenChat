# OpenChat — production image (backend + static frontend)
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV OPENCHAT_PORT=3001
ENV OPENCHAT_CWD=/workspace

# Install only production deps + tsx for running server TS
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm install tsx --no-save

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/bin ./bin
COPY --from=build /app/examples ./examples
COPY --from=build /app/index.html ./index.html
COPY --from=build /app/vite.config.ts ./vite.config.ts

# Workspace mount point for tool execution
RUN mkdir -p /workspace
VOLUME ["/workspace", "/root/.openchat"]

EXPOSE 3001

# Serve API + static files: run backend; put dist behind a simple static host via vite preview or hono
# For simplicity, run backend gateway; frontend is prebuilt in dist (serve with a static server if needed)
CMD ["npx", "tsx", "server/src/index.ts"]

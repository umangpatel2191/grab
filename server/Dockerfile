FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
COPY shared ./shared
COPY server ./server
RUN cd server && npm run build
ENV NODE_ENV=production GRAB_TRUST_PROXY=1 GRAB_DEEP_CONCURRENCY=1
WORKDIR /app/server
EXPOSE 8787
CMD ["node", "dist/server.js"]

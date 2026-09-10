FROM node:24-slim

ENV MCP_TRANSPORT=http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000 \
    DB_PATH=/app/data/guidelines.db

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build && npm prune --omit=dev

EXPOSE 8000

# data/ persists the sqlite index on the host
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('net').createConnection({port:process.env.MCP_PORT,host:'127.0.0.1'}).on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)})"

ENTRYPOINT ["node", "dist/server.js"]

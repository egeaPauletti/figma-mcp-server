FROM node:24-alpine

WORKDIR /app

# Install dependencies without prepare scripts
COPY package*.json tsconfig.json rollup.config.js ./
RUN npm install --ignore-scripts

# Build application
COPY src ./src
RUN npm run build

RUN npm run bundle

# Remove dev dependencies
RUN npm prune --production

# SQLite database (users, OAuth clients, tokens, plugin pairings)
VOLUME /data

ENV TRANSPORT=streamable-http \
    PORT=38450 \
    DB_PATH=/data/figma-mcp.db \
    NODE_ENV=production

# Default start
CMD ["node","dist/index.js"]

# Expose port
EXPOSE 38450

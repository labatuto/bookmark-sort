FROM node:20-slim

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies (no Puppeteer browser download)
COPY package.json package-lock.json* ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Create data directory for SQLite
RUN mkdir -p /app/data

# Default port
ENV PORT=3001
EXPOSE 3001

CMD ["node", "--import", "tsx", "src/backend/server.ts"]

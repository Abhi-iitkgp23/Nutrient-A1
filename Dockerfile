FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# The native addon must load in this Linux image before the app is started.
RUN node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.prepare('select 1 as ok').get(); db.close();"

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/data

CMD ["npm", "run", "start"]

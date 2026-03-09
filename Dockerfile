FROM node:22-slim

# Install kubectl
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
  && install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl \
  && rm kubectl \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/monitor/package.json packages/monitor/
COPY packages/operator/package.json packages/operator/
COPY packages/mitigator/package.json packages/mitigator/
RUN npm ci --legacy-peer-deps -w @pinot-agents/shared -w @pinot-agents/monitor -w @pinot-agents/operator -w @pinot-agents/mitigator

COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/monitor/ packages/monitor/
COPY packages/operator/ packages/operator/
COPY packages/mitigator/ packages/mitigator/

EXPOSE 3000 3001 3002

CMD ["npm", "start"]

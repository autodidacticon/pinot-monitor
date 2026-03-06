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
RUN npm ci --omit=dev --legacy-peer-deps

COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 3000

CMD ["npx", "tsx", "src/index.ts"]

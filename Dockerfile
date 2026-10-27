# SkyLedger: runs with no GPU, no credentials and no network in SAMPLE_MODE (the default).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Runtime dependencies only: tsx plus the front-end libraries the server hosts locally (three, gsap, lenis, fonts).
RUN npm ci --omit=dev --no-audit --no-fund
COPY tsconfig.json run.ts ./
COPY app ./app
COPY config ./config
COPY web ./web
COPY data/sample ./data/sample
COPY vendor/world-model/reference/src ./vendor/world-model/reference/src
COPY vendor/world-model/LICENSE ./vendor/world-model/LICENSE
COPY eval ./eval
COPY input_examples ./input_examples
COPY output_examples ./output_examples
ENV SAMPLE_MODE=true PORT=8000
# Inside Docker, Nightshift and Zetaris on the host are reached at host.docker.internal (see .env.example).
EXPOSE 8000
CMD ["npx", "tsx", "run.ts"]

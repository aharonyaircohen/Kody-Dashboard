# Preview builder service.
#
# Tiny Hono server (:8080) that:
#   1. Clones a target repo at a specific ref
#   2. If the repo has no Dockerfile.preview, drops in the bundled default
#   3. Shells out to `flyctl deploy --build-only` — Fly's hosted remote
#      builder does the actual Docker build (so this container needs
#      neither a docker daemon nor BuildKit; just flyctl + git)
#   4. Returns the resulting image ref `registry.fly.io/<app>:<tag>`
#
# The image stays minimal: node + git + flyctl.

FROM node:22-alpine

RUN apk add --no-cache git ca-certificates curl bash \
    && curl -L https://fly.io/install.sh | sh \
    && cp /root/.fly/bin/flyctl /usr/local/bin/flyctl \
    && rm -rf /root/.fly

WORKDIR /app
RUN corepack enable

COPY package.json ./
RUN pnpm install --prod=false

COPY tsconfig.json ./
COPY src ./src
# Bundled default Dockerfile.preview — used when the consumer repo
# doesn't ship its own. Kept inside the image so consumer repos can
# stay zero-touch.
COPY default-Dockerfile.preview ./default-Dockerfile.preview

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["pnpm", "start"]

# One-shot CLI builder image.
#
# The dashboard spawns a Fly Machine from this image per build, passes
# REPO/REF/APP_NAME/IMAGE_TAG/FLY_API_TOKEN via env, and waits for the
# machine to exit. No HTTP server, no Hono — just node + git + flyctl.

FROM node:22-alpine

RUN apk add --no-cache git ca-certificates curl bash \
    && curl -L https://fly.io/install.sh | sh \
    && cp /root/.fly/bin/flyctl /usr/local/bin/flyctl \
    && rm -rf /root/.fly

WORKDIR /app

# Source for the CLI entrypoint, plus the bundled default Dockerfile.preview
# used when the consumer repo doesn't ship its own.
COPY package.json ./
COPY src ./src
COPY default-Dockerfile.preview ./default-Dockerfile.preview

ENV NODE_ENV=production

CMD ["node", "--experimental-strip-types", "src/builder.ts"]

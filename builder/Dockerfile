# One-shot CLI builder image.
#
# Slim node + git + flyctl. The build itself runs on Fly's per-org
# traditional remote builder (`fly-builder-<org>`), whose VM size we
# control with `flyctl scale -a fly-builder-<org>`. No dockerd, no
# buildah inside this machine — it only orchestrates.

FROM node:22-alpine

RUN apk add --no-cache git ca-certificates curl bash skopeo \
    && curl -L https://fly.io/install.sh | sh \
    && cp /root/.fly/bin/flyctl /usr/local/bin/flyctl \
    && rm -rf /root/.fly

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY default-Dockerfile.preview ./default-Dockerfile.preview

ENV NODE_ENV=production

CMD ["node", "--experimental-strip-types", "src/builder.ts"]

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

# flyctl --remote-only still tries to parse DOCKER_HOST for the
# "remote builder heartbeat" code path. The default unix:///var/run/...
# triggers a Go URL parser bug ("missing hostname") and aborts the
# build. Setting DOCKER_HOST to a valid TCP form short-circuits that
# parser; flyctl never actually connects since --remote-only sends the
# build to fly-builder-<org>.
ENV DOCKER_HOST=tcp://127.0.0.1:2375

# Pre-create an empty docker config so flyctl's credential lookup
# doesn't fall through to host-discovery paths.
RUN mkdir -p /root/.docker && echo '{}' > /root/.docker/config.json

WORKDIR /app

COPY package.json ./
COPY src ./src
# Two bundled templates: PREVIEW_BUILD_MODE picks which to copy into
# the cloned repo (defaults to "dev" — see src/builder.ts).
COPY default-Dockerfile.preview ./default-Dockerfile.preview
COPY default-Dockerfile.preview.dev ./default-Dockerfile.preview.dev
COPY default-Dockerfile.preview.prod ./default-Dockerfile.preview.prod

ENV NODE_ENV=production

CMD ["node", "--experimental-strip-types", "src/builder.ts"]

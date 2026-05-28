# One-shot CLI builder image.
#
# The dashboard spawns a Fly Machine from this image per build, passes
# REPO/REF/APP_NAME/IMAGE_TAG/FLY_API_TOKEN via env, and waits for the
# machine to exit. The build runs LOCALLY in this machine via buildah
# (rootless, daemonless OCI builder) — no Depot remote builder — so
# the VM size we spawn directly controls available build memory.

FROM node:22-alpine

# buildah builds OCI images without a docker daemon. Includes skopeo
# for registry pushes. fuse-overlayfs lets buildah use overlayfs
# storage without privileged mode.
RUN apk add --no-cache \
      git ca-certificates curl bash \
      buildah fuse-overlayfs

# Buildah rootless storage config — uses overlay+fuse-overlayfs so
# layers stack the same way docker does, without needing /dev/fuse.
RUN mkdir -p /etc/containers \
    && echo '[storage]' > /etc/containers/storage.conf \
    && echo 'driver = "overlay"' >> /etc/containers/storage.conf \
    && echo '[storage.options.overlay]' >> /etc/containers/storage.conf \
    && echo 'mount_program = "/usr/bin/fuse-overlayfs"' >> /etc/containers/storage.conf

ENV BUILDAH_ISOLATION=chroot

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY default-Dockerfile.preview ./default-Dockerfile.preview

ENV NODE_ENV=production

CMD ["node", "--experimental-strip-types", "src/builder.ts"]

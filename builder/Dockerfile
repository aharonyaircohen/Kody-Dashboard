# One-shot CLI builder image.
#
# Runs dockerd inside the Fly Machine so the build uses real kernel
# overlayfs + native SWC — same speed profile as Vercel / a local
# docker build. buildah on chroot+fuse-overlayfs was 5-10x slower.

FROM docker:27-dind

# nodejs + git + flyctl for the orchestrator CLI.
RUN apk add --no-cache git ca-certificates curl bash nodejs

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY default-Dockerfile.preview ./default-Dockerfile.preview

ENV NODE_ENV=production
# Docker CLI will dial the dockerd socket the entrypoint starts.
ENV DOCKER_HOST=unix:///var/run/docker.sock

# dockerd-entrypoint.sh boots the daemon; once it's ready we exec the
# orchestrator. The CLI itself waits for the socket before its first
# docker call, so a `sleep` here isn't needed.
ENTRYPOINT ["dockerd-entrypoint.sh"]
CMD ["node", "--experimental-strip-types", "src/builder.ts"]

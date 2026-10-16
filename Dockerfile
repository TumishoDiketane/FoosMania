# Authors:
# Lesiba Ledwaba — Student No. 2025717063
# Tumisho Diketane — Student No. 2024965994
# Purpose: Install production dependencies, copy the server/client runtime, and
# launch the Node server as the unprivileged node user.
#
# Runs the full game server (Express pages + socket.io realtime).
# Built and pushed to GHCR by .github/workflows/render-deploy.yml;
# Render pulls the image and runs it.
FROM node:22-alpine

# Links the GHCR package to this repo so the workflow's GITHUB_TOKEN can push.
LABEL org.opencontainers.image.source="https://github.com/TumishoDiketane/FoosMania"

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only the code the server needs at runtime; routes resolve views relative to
# the working directory, so the src/ layout must match the repo.
COPY src/server ./src/server
COPY src/client ./src/client

# Local default; Render overrides via $PORT (see src/server/index.js).
EXPOSE 3000

USER node
CMD ["node", "src/server/index.js"]

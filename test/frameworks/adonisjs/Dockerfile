# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=xxx
FROM node:${NODE_VERSION}-slim as base

LABEL fly_launch_runtime="AdonisJS"

# AdonisJS app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base as build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install node modules
COPY --link package.json ./
RUN npm install --include=dev

# Copy application code
COPY --link . .

# Build application
RUN npm run build


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app /app

# Entrypoint sets up the container.
ENTRYPOINT [ "/app/docker-entrypoint.js" ]

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
ENV CACHE_VIEWS="true" \
    DB_CONNECTION="pg" \
    DRIVE_DISK="local" \
    HOST="0.0.0.0" \
    PORT="3000" \
    SESSION_DRIVER="cookie"
CMD [ "node", "/app/build/server.js" ]

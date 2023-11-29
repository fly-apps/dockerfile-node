# syntax = docker/dockerfile:1

# Adjust BUN_VERSION as desired
ARG BUN_VERSION=xxx
FROM oven/bun:${BUN_VERSION}-slim as base

LABEL fly_launch_runtime="Bun"

# Bun app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base as build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install -y build-essential pkg-config python-is-python3

# Install node modules
COPY --link bun.lockb package.json ./
RUN --mount=type=cache,id=bun,target=/root/.bun \
    bun install

# Copy application code
COPY --link . .

# Build application
RUN bun run build

# Remove development dependencies
RUN --mount=type=cache,id=bun,target=/root/.bun \
    rm -rf node_modules && \
    bun install --ci


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "bun", "run", "start" ]

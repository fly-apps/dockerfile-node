# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=xxx
FROM node:${NODE_VERSION}-slim as base

LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base as build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install -y build-essential pkg-config python-is-python3

# Install node modules
COPY --link package.json yarn.lock ./
RUN --mount=type=cache,id=yarn,target=/usr/local/share/.cache/yarn/ \
    yarn install --frozen-lockfile --production=false

# Copy application code
COPY --link . .

# Build application
RUN yarn run build

# Remove development dependencies
RUN --mount=type=cache,id=yarn,target=/usr/local/share/.cache/yarn/ \
    yarn install --production=true


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "yarn", "run", "start" ]

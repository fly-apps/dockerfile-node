# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=xxx
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Astro"

# Astro app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install node modules
COPY package-lock.json package.json ./
RUN npm ci

# Copy application code
COPY . .

# Build application
RUN npm run build


# Final stage for app image
FROM caddy:2-alpine

# Copy built application
COPY --from=build /app/dist /srv

# Serve the site, with its own 404 page
COPY <<-"EOF" /etc/caddy/Caddyfile
:80 {
  root * /srv
  file_server
  handle_errors 404 {
    rewrite * /404.html
    file_server
  }
}
EOF

# Start the server by default, this can be overwritten at runtime
EXPOSE 80
CMD [ "caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile" ]
